import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ProxyAgent } from 'undici';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FetchWithTimeoutOptions,
  ResponseTooLargeError,
  fetchWithTimeout,
} from '../../common/utils/fetch-with-timeout';
import { PARSER_SOURCES, getParserSource } from '../parser-settings.service';
import {
  CONNECTION_ROUTES,
  ConnectionOutcome,
  ConnectionRoute,
  DEFAULT_PROXY_MODE,
  PROXY_MODES,
  ProxyMode,
  RouteSnapshot,
  applyOutcome,
  chooseRoute,
  classifyStatus,
  emptySnapshot,
  isUsable,
  maskProxyUrl,
  normalizeProxyUrl,
  sourceForUrl,
} from './supplier-connection';

const PROXY_IMAGES_KEY = 'parser.proxyImages';
const proxyModeKey = (code: string) => `parser.${code}.proxyMode`;
const proxyIdKey = (code: string) => `parser.${code}.proxyId`;
/** The proxy from `PARSER_PROXY_URL`: listed last, not editable from the admin. */
const ENV_PROXY_ID = 'env';

/** Settings and states are re-read this often — both processes write them. */
const CACHE_TTL_MS = 5000;
/** A healthy route's row is rewritten at most this often (only `lastOkAt` moves). */
const OK_FLUSH_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS = 15_000;
const PROBE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** What a request to a supplier is for: photos go through the proxy only when allowed. */
export type SupplierRequestPurpose = 'page' | 'image';

/** The supplier did not answer at all — no connection, timeout, reset. */
export class SupplierUnreachableError extends Error {
  constructor(
    message: string,
    readonly sourceCode: string,
    readonly route: ConnectionRoute,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SupplierUnreachableError';
  }
}

/** The source's route is known to be blocked: a batch is not started at all. */
export class SupplierBlockedError extends Error {
  constructor(
    message: string,
    readonly sourceCode: string,
  ) {
    super(message);
    this.name = 'SupplierBlockedError';
  }
}

/** A proxy as the service uses it; `url` never leaves the server unmasked. */
export type ProxyEntry = {
  id: string;
  name: string;
  url: string;
  from: 'admin' | 'env';
};

type StoredRoute = {
  snapshot: RouteSnapshot;
  touchedAt: number;
  flushedAt: number;
};

/**
 * Every request to a supplier goes through here (`fetch`): it picks the route
 * — direct or through the proxy — counts how the supplier answered, and keeps
 * the state in `SupplierConnection` so the API can show it and the worker can
 * act on it. Lives in both processes; the database row is the shared truth.
 *
 * Rules (pure, tested) are in `supplier-connection.ts`. Proxies are a list
 * (`ParserProxy`, plus `PARSER_PROXY_URL` from env as a read-only entry);
 * each source picks one (`parser.<code>.proxyId`, the first by default) and a
 * mode (`parser.<code>.proxyMode`). The PROXY route's state is per source —
 * it is about that source through its proxy, and is reset when the source
 * gets another proxy or its proxy's address changes.
 */
@Injectable()
export class SupplierConnectionService {
  private readonly logger = new Logger(SupplierConnectionService.name);
  private settingsCache: {
    values: Map<string, string>;
    expiresAt: number;
  } | null = null;
  private routes = new Map<string, StoredRoute>();
  private routesExpireAt = 0;
  private proxiesCache: { list: ProxyEntry[]; expiresAt: number } | null = null;
  private agents = new Map<string, ProxyAgent>();
  private warnedBadEnvProxy = false;

  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------- request ---- */

  /**
   * `fetchWithTimeout` for a supplier URL. A URL of no known supplier goes out
   * unchanged and is not counted. Network failures are rethrown as
   * `SupplierUnreachableError` with the same message.
   */
  async fetch(
    url: string,
    init: RequestInit = {},
    options: FetchWithTimeoutOptions = {},
    purpose: SupplierRequestPurpose = 'page',
  ): Promise<Response> {
    const source = sourceForUrl(url, PARSER_SOURCES);
    if (!source) return fetchWithTimeout(url, init, options);

    const decision = await this.routeFor(source.code);
    const route: ConnectionRoute =
      purpose === 'image' && !(await this.proxyImages())
        ? 'DIRECT'
        : decision.route;
    return this.request(
      source.code,
      route,
      url,
      init,
      options,
      decision.proxyEntry,
    );
  }

  private async request(
    code: string,
    route: ConnectionRoute,
    url: string,
    init: RequestInit,
    options: FetchWithTimeoutOptions,
    proxy: ProxyEntry | null,
  ): Promise<Response> {
    const dispatcher =
      route === 'PROXY' && proxy ? this.dispatcher(proxy.url) : undefined;
    if (route === 'PROXY' && !dispatcher) {
      throw new SupplierUnreachableError(
        'Прокси выбран, но не настроен',
        code,
        route,
      );
    }
    const started = Date.now();
    try {
      const res = await fetchWithTimeout(
        url,
        (dispatcher ? { ...init, dispatcher } : init) as RequestInit,
        options,
      );
      const ms = Date.now() - started;
      await this.record(code, route, {
        kind: classifyStatus(res.status),
        status: res.status,
        ms,
      });
      return res;
    } catch (error) {
      if (error instanceof ResponseTooLargeError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      await this.record(code, route, {
        kind: 'unreachable',
        error: message,
        ms: Date.now() - started,
      });
      throw new SupplierUnreachableError(
        route === 'PROXY'
          ? `${message} (через прокси «${proxy?.name}»)`
          : message,
        code,
        route,
        { cause: error },
      );
    }
  }

  /* --------------------------------------------------------- decision ---- */

  /** The route this source's requests take now and whether it is worth trying. */
  async routeFor(code: string) {
    const [mode, proxy] = await Promise.all([
      this.proxyMode(code),
      this.proxyFor(code),
    ]);
    const direct = await this.snapshot(code, 'DIRECT');
    const route = chooseRoute(mode, Boolean(proxy), direct);
    const current =
      route === 'DIRECT' ? direct : await this.snapshot(code, 'PROXY');
    return {
      mode,
      route,
      proxyConfigured: Boolean(proxy),
      /** The proxy this source would use; also the one it uses when route is PROXY. */
      proxy: proxy ? { id: proxy.id, name: proxy.name } : null,
      proxyEntry: proxy,
      usable: isUsable(current),
      snapshot: current,
    };
  }

  /**
   * Called before a batch: a source whose route is blocked would burn every
   * URL's retries (90 minutes for one dukon batch) and fail them all.
   */
  async assertUsable(code: string) {
    const decision = await this.routeFor(code);
    if (decision.usable) return decision;
    throw new SupplierBlockedError(this.describeBlock(code, decision), code);
  }

  describeBlock(
    code: string,
    decision: Awaited<ReturnType<SupplierConnectionService['routeFor']>>,
  ) {
    const host = getParserSource(code)?.host ?? code;
    const s = decision.snapshot;
    const why =
      s.failureKind === 'DENIED'
        ? `отвечает ${s.lastError ?? '403/429'}`
        : 'не устанавливает соединение';
    const since = s.blockedSince ? ` с ${formatMinsk(s.blockedSince)}` : '';
    const via =
      decision.route === 'PROXY'
        ? `через прокси «${decision.proxy?.name}»`
        : 'напрямую';
    const hint =
      decision.route === 'PROXY'
        ? 'прокси тоже не помогает — выберите другой'
        : decision.proxyConfigured
          ? `режим прокси «${decision.mode}» — включите «авто» или «всегда»`
          : 'прокси не настроен';
    return `${host} ${via} ${why}${since} (${s.consecutiveFailures} ошибок подряд); ${hint}. Пачка не запускалась.`;
  }

  /* ------------------------------------------------------------ probe ---- */

  /**
   * One request to the supplier's home page on every route there is. Run by
   * the worker every 10 minutes — it is what notices a lifted ban while no
   * batch is running — and by the admin's «Проверить» button.
   */
  async probe(code: string) {
    const source = getParserSource(code);
    if (!source)
      throw new BadRequestException(`Unknown parser source: ${code}`);
    const proxy = await this.proxyFor(code);
    const routes: ConnectionRoute[] = proxy ? ['DIRECT', 'PROXY'] : ['DIRECT'];
    const results = [];
    for (const route of routes) {
      const started = Date.now();
      try {
        const res = await this.request(
          code,
          route,
          `https://${source.host}/`,
          { headers: { 'user-agent': PROBE_USER_AGENT } },
          {
            timeoutMs: PROBE_TIMEOUT_MS,
            retries: 0,
            maxBytes: 5 * 1024 * 1024,
          },
          proxy,
        );
        results.push({
          route,
          ok: classifyStatus(res.status) === 'ok',
          status: res.status,
          ms: Date.now() - started,
        });
      } catch (error) {
        results.push({
          route,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          ms: Date.now() - started,
        });
      }
    }
    await this.flush(code, true);
    return results;
  }

  async probeAll() {
    for (const source of PARSER_SOURCES) {
      await this.probe(source.code).catch((error) =>
        this.logger.warn(`Probe of ${source.code} failed: ${String(error)}`),
      );
    }
  }

  /* --------------------------------------------------------- overview ---- */

  async overview() {
    const proxies = await this.proxies();
    const sources: Record<string, unknown> = {};
    const usedBy = new Map<string, string[]>();
    for (const source of PARSER_SOURCES) {
      const decision = await this.routeFor(source.code);
      if (decision.proxy) {
        usedBy.set(decision.proxy.id, [
          ...(usedBy.get(decision.proxy.id) ?? []),
          source.code,
        ]);
      }
      sources[source.code] = {
        mode: decision.mode,
        route: decision.route,
        usable: decision.usable,
        /** The proxy this source uses (picked, or the first in the list). */
        proxy: decision.proxy,
        /** Picked by an admin; null = the first in the list. */
        proxyIdPicked:
          (await this.settings()).get(proxyIdKey(source.code)) || null,
        direct: await this.snapshot(source.code, 'DIRECT'),
        proxyState: decision.proxy
          ? await this.snapshot(source.code, 'PROXY')
          : null,
      };
    }
    return {
      proxies: proxies.map((proxy) => ({
        id: proxy.id,
        name: proxy.name,
        url: maskProxyUrl(proxy.url),
        from: proxy.from,
        usedBy: usedBy.get(proxy.id) ?? [],
      })),
      images: await this.proxyImages(),
      modes: PROXY_MODES,
      sources,
    };
  }

  /* --------------------------------------------------------- settings ---- */

  async addProxy(name: string | undefined, rawUrl: string) {
    const url = this.validProxyUrl(rawUrl);
    const count = await this.prisma.parserProxy.count();
    const proxy = await this.prisma.parserProxy.create({
      data: { name: name?.trim() || `Прокси ${count + 1}`, url },
    });
    this.proxiesCache = null;
    this.logger.log(
      `Parser proxy «${proxy.name}» added (${maskProxyUrl(url)})`,
    );
    return proxy.id;
  }

  /** A new address is a different proxy: its sources' PROXY record starts over. */
  async updateProxy(id: string, change: { name?: string; url?: string }) {
    const existing = await this.editableProxy(id);
    const url =
      change.url !== undefined && change.url.trim()
        ? this.validProxyUrl(change.url)
        : undefined;
    await this.prisma.parserProxy.update({
      where: { id },
      data: {
        ...(change.name?.trim() ? { name: change.name.trim() } : {}),
        ...(url ? { url } : {}),
      },
    });
    this.proxiesCache = null;
    if (url && url !== existing.url) await this.resetProxyState(id);
  }

  /** Its sources fall back to the first proxy left (or go direct). */
  async deleteProxy(id: string) {
    await this.editableProxy(id);
    await this.resetProxyState(id);
    await this.prisma.parserProxy.delete({ where: { id } });
    await this.prisma.parserSetting.deleteMany({
      where: { key: { endsWith: '.proxyId' }, value: id },
    });
    this.settingsCache = null;
    this.proxiesCache = null;
  }

  /** `null` or '' = the first proxy in the list. */
  async setProxyChoice(code: string, proxyId: string | null) {
    if (!getParserSource(code))
      throw new BadRequestException(`Unknown parser source: ${code}`);
    if (proxyId && !(await this.proxies()).some((p) => p.id === proxyId)) {
      throw new BadRequestException('Такого прокси нет в списке');
    }
    const before = await this.proxyFor(code);
    await this.writeSetting(proxyIdKey(code), proxyId ?? '');
    const after = await this.proxyFor(code);
    if (before?.id !== after?.id) await this.resetProxyState(null, [code]);
  }

  async setProxyMode(code: string, mode: string) {
    if (!getParserSource(code))
      throw new BadRequestException(`Unknown parser source: ${code}`);
    if (!(PROXY_MODES as readonly string[]).includes(mode)) {
      throw new BadRequestException(`Режим прокси: ${PROXY_MODES.join(' | ')}`);
    }
    await this.writeSetting(proxyModeKey(code), mode);
  }

  async setProxyImages(enabled: boolean) {
    await this.writeSetting(PROXY_IMAGES_KEY, String(enabled));
  }

  private async proxyMode(code: string): Promise<ProxyMode> {
    const stored = (await this.settings()).get(proxyModeKey(code));
    return (PROXY_MODES as readonly string[]).includes(stored ?? '')
      ? (stored as ProxyMode)
      : DEFAULT_PROXY_MODE;
  }

  private async proxyImages() {
    return (await this.settings()).get(PROXY_IMAGES_KEY) === 'true';
  }

  /** The proxy a source uses: the one picked, else the first in the list. */
  private async proxyFor(code: string): Promise<ProxyEntry | null> {
    const list = await this.proxies();
    const picked = (await this.settings()).get(proxyIdKey(code));
    return list.find((proxy) => proxy.id === picked) ?? list[0] ?? null;
  }

  /** Admin's proxies in the order they were added, then the env one. */
  async proxies(): Promise<ProxyEntry[]> {
    const now = Date.now();
    if (this.proxiesCache && this.proxiesCache.expiresAt > now) {
      return this.proxiesCache.list;
    }
    let list: ProxyEntry[] = [];
    try {
      const rows = await this.prisma.parserProxy.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      list = rows.map((row) => ({
        id: row.id,
        name: row.name,
        url: row.url,
        from: 'admin' as const,
      }));
    } catch (error) {
      this.logger.warn(`Parser proxies unavailable: ${String(error)}`);
    }
    const env = this.envProxy();
    if (env) list.push(env);
    this.proxiesCache = { list, expiresAt: now + CACHE_TTL_MS };
    // An agent for an address no longer listed holds sockets for nothing.
    for (const [url, agent] of this.agents) {
      if (!list.some((proxy) => proxy.url === url)) {
        this.agents.delete(url);
        void agent.close().catch(() => undefined);
      }
    }
    return list;
  }

  private envProxy(): ProxyEntry | null {
    const env = process.env.PARSER_PROXY_URL?.trim();
    if (!env) return null;
    try {
      return {
        id: ENV_PROXY_ID,
        name: 'PARSER_PROXY_URL',
        url: normalizeProxyUrl(env),
        from: 'env',
      };
    } catch (error) {
      if (!this.warnedBadEnvProxy) {
        this.logger.warn(`PARSER_PROXY_URL ignored: ${String(error)}`);
        this.warnedBadEnvProxy = true;
      }
      return null;
    }
  }

  private dispatcher(url: string) {
    let agent = this.agents.get(url);
    if (!agent) {
      agent = new ProxyAgent(url);
      this.agents.set(url, agent);
    }
    return agent;
  }

  private validProxyUrl(raw: string) {
    try {
      return normalizeProxyUrl(raw);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async editableProxy(id: string) {
    if (id === ENV_PROXY_ID) {
      throw new BadRequestException(
        'Этот прокси задан переменной PARSER_PROXY_URL — меняется в .env.prod',
      );
    }
    const proxy = await this.prisma.parserProxy.findUnique({ where: { id } });
    if (!proxy) throw new BadRequestException('Такого прокси нет в списке');
    return proxy;
  }

  /**
   * Forgets the PROXY record of the given sources, or of every source that
   * uses proxy `proxyId` now: its failures belonged to another address.
   */
  private async resetProxyState(proxyId: string | null, codes?: string[]) {
    const affected =
      codes ??
      (
        await Promise.all(
          PARSER_SOURCES.map(async (source) =>
            (await this.proxyFor(source.code))?.id === proxyId
              ? (source.code as string)
              : null,
          ),
        )
      ).filter((code): code is string => code !== null);
    if (!affected.length) return;
    await this.prisma.supplierConnection.deleteMany({
      where: { route: 'PROXY', sourceCode: { in: affected } },
    });
    for (const code of affected) this.routes.delete(`${code}:PROXY`);
  }

  private async settings() {
    const now = Date.now();
    if (this.settingsCache && this.settingsCache.expiresAt > now) {
      return this.settingsCache.values;
    }
    try {
      const rows = await this.prisma.parserSetting.findMany({
        where: { key: { startsWith: 'parser.' } },
      });
      const values = new Map(rows.map((row) => [row.key, row.value]));
      this.settingsCache = { values, expiresAt: now + CACHE_TTL_MS };
      return values;
    } catch (error) {
      // A request must not fail because the settings table is unreachable.
      this.logger.warn(`Connection settings unavailable: ${String(error)}`);
      return new Map<string, string>();
    }
  }

  private async writeSetting(key: string, value: string) {
    await this.prisma.parserSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    this.settingsCache = null;
  }

  /* ------------------------------------------------------------ state ---- */

  private async snapshot(code: string, route: ConnectionRoute) {
    await this.loadRoutes();
    return this.routes.get(`${code}:${route}`)?.snapshot ?? emptySnapshot();
  }

  private async record(
    code: string,
    route: ConnectionRoute,
    outcome: ConnectionOutcome,
  ) {
    await this.loadRoutes();
    const key = `${code}:${route}`;
    const stored = this.routes.get(key);
    const previous = stored?.snapshot ?? emptySnapshot();
    const next = applyOutcome(previous, outcome, new Date());
    const now = Date.now();
    this.routes.set(key, {
      snapshot: next,
      touchedAt: now,
      flushedAt: stored?.flushedAt ?? 0,
    });

    if (next.state !== previous.state && next.state === 'BLOCKED') {
      this.logger.warn(`${code} ${route}: BLOCKED (${next.lastError})`);
    } else if (previous.state === 'BLOCKED' && next.state === 'OK') {
      this.logger.log(`${code} ${route}: answers again`);
    }
    const changed =
      next.state !== previous.state ||
      next.consecutiveFailures !== previous.consecutiveFailures;
    if (changed || now - (stored?.flushedAt ?? 0) > OK_FLUSH_INTERVAL_MS) {
      await this.flushRoute(code, route);
    }
  }

  private async flush(code: string, force: boolean) {
    for (const route of CONNECTION_ROUTES) {
      const stored = this.routes.get(`${code}:${route}`);
      if (stored && (force || stored.touchedAt > stored.flushedAt)) {
        await this.flushRoute(code, route);
      }
    }
  }

  private async flushRoute(code: string, route: ConnectionRoute) {
    const stored = this.routes.get(`${code}:${route}`);
    if (!stored) return;
    const data = stored.snapshot;
    try {
      await this.prisma.supplierConnection.upsert({
        where: { sourceCode_route: { sourceCode: code, route } },
        create: { sourceCode: code, route, ...data },
        update: data,
      });
      stored.flushedAt = Date.now();
    } catch (error) {
      // Bookkeeping must never fail the request it describes.
      this.logger.warn(
        `Could not store ${code} ${route} state: ${String(error)}`,
      );
    }
  }

  /**
   * Re-reads the rows the other process may have written. A row this process
   * changed after the database's copy was written keeps the local version.
   */
  private async loadRoutes() {
    const now = Date.now();
    if (now < this.routesExpireAt) return;
    this.routesExpireAt = now + CACHE_TTL_MS;
    try {
      const rows = await this.prisma.supplierConnection.findMany();
      // A row the other process deleted (a proxy reset) is gone here too,
      // unless this process has a newer, not yet stored version of it.
      const present = new Set(rows.map((r) => `${r.sourceCode}:${r.route}`));
      for (const [key, local] of this.routes) {
        if (!present.has(key) && local.flushedAt >= local.touchedAt) {
          this.routes.delete(key);
        }
      }
      for (const row of rows) {
        const key = `${row.sourceCode}:${row.route}`;
        const local = this.routes.get(key);
        if (local && local.touchedAt > row.updatedAt.getTime()) continue;
        this.routes.set(key, {
          snapshot: {
            state: row.state as RouteSnapshot['state'],
            failureKind: row.failureKind as RouteSnapshot['failureKind'],
            consecutiveFailures: row.consecutiveFailures,
            lastOkAt: row.lastOkAt,
            lastFailAt: row.lastFailAt,
            lastError: row.lastError,
            lastStatus: row.lastStatus,
            lastMs: row.lastMs,
            blockedSince: row.blockedSince,
          },
          touchedAt: row.updatedAt.getTime(),
          flushedAt: row.updatedAt.getTime(),
        });
      }
    } catch (error) {
      this.logger.warn(`Connection states unavailable: ${String(error)}`);
    }
  }
}

function formatMinsk(date: Date) {
  return new Intl.DateTimeFormat('ru-BY', {
    timeZone: 'Europe/Minsk',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
