import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SUPPLIER_7745_DEFAULT_EXCLUDE_REGEX,
  SUPPLIER_7745_DEFAULT_INCLUDE_REGEX,
  TH_TOOLS_DEFAULT_EXCLUDE_REGEX,
  TOOLS_BY_DEFAULT_EXCLUDE_REGEX,
} from './parser-defaults';

/** Code-level fallbacks, used when neither a DB row nor an env var is set. */
const DEFAULT_CATEGORY_FILTERS: Record<
  string,
  { include: string; exclude: string }
> = {
  'th-tools': { include: '', exclude: TH_TOOLS_DEFAULT_EXCLUDE_REGEX },
  'tools-by': { include: '', exclude: TOOLS_BY_DEFAULT_EXCLUDE_REGEX },
  dukon: { include: '', exclude: '' },
  '7745': {
    include: SUPPLIER_7745_DEFAULT_INCLUDE_REGEX,
    exclude: SUPPLIER_7745_DEFAULT_EXCLUDE_REGEX,
  },
};

/**
 * The sources an admin can drive from the UI. `envFlag` keeps the pre-existing
 * deploy-time switch working: a source with no `ParserSetting` row behaves
 * exactly as it did before this module existed.
 */
export const PARSER_SOURCES = [
  {
    code: 'th-tools',
    name: 'TH-Tools (th-tool.by)',
    envFlag: 'TH_TOOLS_CRON_ENABLED',
    envBatchLimit: 'TH_TOOLS_CRON_BATCH_LIMIT',
    envRequestDelay: 'TH_TOOLS_REQUEST_DELAY_MS',
    envCategoryInclude: 'TH_TOOLS_CATEGORY_INCLUDE_REGEX',
    envCategoryExclude: 'TH_TOOLS_CATEGORY_EXCLUDE_REGEX',
    envMaxPages: 'TH_TOOLS_CATEGORY_MAX_PAGES',
    defaultRequestDelayMs: 1500,
    defaultMaxPages: 100,
    /** Sources without a category crawler only show the products queue. */
    hasCategoryQueue: true,
    defaultEnabled: true,
  },
  {
    code: 'tools-by',
    name: 'Tools.by',
    envFlag: 'TOOLS_BY_CRON_ENABLED',
    envBatchLimit: 'TOOLS_BY_CRON_BATCH_LIMIT',
    envRequestDelay: 'TOOLS_BY_REQUEST_DELAY_MS',
    envCategoryInclude: 'TOOLS_BY_CATEGORY_INCLUDE_REGEX',
    envCategoryExclude: 'TOOLS_BY_CATEGORY_EXCLUDE_REGEX',
    envMaxPages: 'TOOLS_BY_DISCOVERY_MAX_PAGES',
    defaultRequestDelayMs: 2000,
    defaultMaxPages: 2000,
    defaultBatchLimit: 300,
    hasCategoryQueue: false,
    defaultEnabled: true,
  },
  {
    code: 'dukon',
    name: 'Dukon (dukon.by)',
    envFlag: 'DUKON_CRON_ENABLED',
    envBatchLimit: 'DUKON_CRON_BATCH_LIMIT',
    envRequestDelay: 'DUKON_REQUEST_DELAY_MS',
    envCategoryInclude: 'DUKON_CATEGORY_INCLUDE_REGEX',
    envCategoryExclude: 'DUKON_CATEGORY_EXCLUDE_REGEX',
    envMaxPages: 'DUKON_DISCOVERY_MAX_PAGES',
    defaultRequestDelayMs: 3000,
    defaultMaxPages: 5000,
    hasCategoryQueue: false,
    defaultEnabled: true,
  },
  {
    code: '7745',
    name: '7745.by (пример, не поставщик)',
    envFlag: 'SUPPLIER_7745_CRON_ENABLED',
    envBatchLimit: 'SUPPLIER_7745_CRON_BATCH_LIMIT',
    envRequestDelay: 'SUPPLIER_7745_REQUEST_DELAY_MS',
    envCategoryInclude: 'SUPPLIER_7745_CATEGORY_INCLUDE_REGEX',
    envCategoryExclude: 'SUPPLIER_7745_CATEGORY_EXCLUDE_REGEX',
    envMaxPages: 'SUPPLIER_7745_DISCOVERY_MAX_PAGES',
    defaultRequestDelayMs: 1500,
    defaultMaxPages: 500,
    hasCategoryQueue: false,
    /** 7745 is a sample site, not a supplier — its default stays off. */
    defaultEnabled: false,
  },
] as const;

export type ParserSourceCode = (typeof PARSER_SOURCES)[number]['code'];

export function getParserSource(code: string) {
  return PARSER_SOURCES.find((source) => source.code === code);
}

const GLOBAL_ENABLED_KEY = 'cron.enabled';
const sourceEnabledKey = (code: string) => `cron.${code}.enabled`;
const sourceBatchLimitKey = (code: string) => `cron.${code}.batchLimit`;
const sourceDelayKey = (code: string) => `parser.${code}.requestDelayMs`;
const sourceIncludeKey = (code: string) => `parser.${code}.categoryInclude`;
const sourceExcludeKey = (code: string) => `parser.${code}.categoryExclude`;
const sourceMaxPagesKey = (code: string) => `parser.${code}.maxPages`;

const MIN_REQUEST_DELAY_MS = 200;
const MAX_REQUEST_DELAY_MS = 60_000;
const MAX_PAGES_CEILING = 100_000;

const DEFAULT_BATCH_LIMIT = 30;
const MAX_BATCH_LIMIT = 2000;

/**
 * Settings are read on every cron tick and on every admin request, so they are
 * cached briefly. The TTL is short enough that flipping a switch in the admin
 * takes effect on the next tick, and long enough that a batch of 500 products
 * does not mean 500 round-trips.
 */
const CACHE_TTL_MS = 5000;

@Injectable()
export class ParserSettingsService {
  private readonly logger = new Logger(ParserSettingsService.name);
  private cache: { values: Map<string, string>; expiresAt: number } | null =
    null;

  constructor(private readonly prisma: PrismaService) {}

  /* --------------------------------------------------------- reading ---- */

  /** Global kill switch. DB row wins; otherwise `PARSER_CRON_ENABLED`. */
  async isCronEnabled() {
    return this.readBoolean(
      GLOBAL_ENABLED_KEY,
      process.env.PARSER_CRON_ENABLED === 'true',
    );
  }

  /**
   * A source runs only when the global switch AND its own switch are on —
   * same two-key gate the env flags always had.
   */
  async isSourceCronEnabled(code: string) {
    if (!(await this.isCronEnabled())) return false;
    return this.isSourceFlagEnabled(code);
  }

  async getBatchLimit(code: string) {
    const source = getParserSource(code);
    const envValue = source ? Number(process.env[source.envBatchLimit]) : NaN;
    const fallback =
      Number.isFinite(envValue) && envValue > 0
        ? envValue
        : source && 'defaultBatchLimit' in source
          ? source.defaultBatchLimit
          : DEFAULT_BATCH_LIMIT;
    const stored = Number(await this.read(sourceBatchLimitKey(code)));

    return this.clampBatchLimit(
      Number.isFinite(stored) && stored > 0 ? stored : fallback,
    );
  }

  /**
   * Pause between HTTP requests to the supplier. Politeness knob: parsers used
   * to read this from a module-level env const, which meant a restart to change
   * it and no way to slow a parser down while it was hammering a supplier.
   */
  async getRequestDelayMs(code: string) {
    const source = getParserSource(code);
    const fallback = this.envNumber(
      source?.envRequestDelay,
      source?.defaultRequestDelayMs ?? 1500,
    );
    const stored = Number(await this.read(sourceDelayKey(code)));
    const value = Number.isFinite(stored) && stored > 0 ? stored : fallback;

    return Math.min(
      Math.max(Math.round(value), MIN_REQUEST_DELAY_MS),
      MAX_REQUEST_DELAY_MS,
    );
  }

  /** Page cap for a catalog crawl (or a category's pagination). */
  async getMaxPages(code: string) {
    const source = getParserSource(code);
    const fallback = this.envNumber(
      source?.envMaxPages,
      source?.defaultMaxPages ?? 500,
    );
    const stored = Number(await this.read(sourceMaxPagesKey(code)));
    const value = Number.isFinite(stored) && stored > 0 ? stored : fallback;

    return Math.min(Math.max(Math.round(value), 1), MAX_PAGES_CEILING);
  }

  /**
   * Category filters as raw regex source. An empty string is a real value
   * ("no filter"), which is why a stored empty row still wins over the env var.
   */
  async getCategoryFilters(code: string) {
    const source = getParserSource(code);
    const defaults = DEFAULT_CATEGORY_FILTERS[code] ?? {
      include: '',
      exclude: '',
    };

    const storedInclude = await this.read(sourceIncludeKey(code));
    const storedExclude = await this.read(sourceExcludeKey(code));

    return {
      include:
        storedInclude ??
        this.envString(source?.envCategoryInclude) ??
        defaults.include,
      exclude:
        storedExclude ??
        this.envString(source?.envCategoryExclude) ??
        defaults.exclude,
    };
  }

  /** Everything the admin overview needs, in one round-trip per source. */
  async getOverview() {
    const globalEnabled = await this.isCronEnabled();

    const sources = await Promise.all(
      PARSER_SOURCES.map(async (source) => {
        const sourceEnabled = await this.isSourceFlagEnabled(source.code);
        return {
          code: source.code,
          name: source.name,
          hasCategoryQueue: source.hasCategoryQueue,
          cronEnabled: sourceEnabled,
          /** What actually decides whether the cron does anything. */
          effectiveEnabled: globalEnabled && sourceEnabled,
          batchLimit: await this.getBatchLimit(source.code),
          requestDelayMs: await this.getRequestDelayMs(source.code),
          maxPages: await this.getMaxPages(source.code),
          categoryFilters: await this.getCategoryFilters(source.code),
          envFlag: source.envFlag,
          envFlagValue: process.env[source.envFlag] ?? null,
          overriddenInDb: {
            cronEnabled:
              (await this.read(sourceEnabledKey(source.code))) !== undefined,
            batchLimit:
              (await this.read(sourceBatchLimitKey(source.code))) !== undefined,
          },
        };
      }),
    );

    return {
      cronEnabled: globalEnabled,
      envCronEnabled: process.env.PARSER_CRON_ENABLED ?? null,
      globalOverriddenInDb: (await this.read(GLOBAL_ENABLED_KEY)) !== undefined,
      sources,
    };
  }

  /* --------------------------------------------------------- writing ---- */

  async setCronEnabled(enabled: boolean) {
    await this.write(GLOBAL_ENABLED_KEY, String(enabled));
    this.logger.log(`Parser cron globally ${enabled ? 'enabled' : 'disabled'}`);
    return this.getOverview();
  }

  async setSourceCronEnabled(code: string, enabled: boolean) {
    this.ensureKnownSource(code);
    await this.write(sourceEnabledKey(code), String(enabled));
    this.logger.log(`Parser cron for ${code} ${enabled ? 'on' : 'off'}`);
    return this.getOverview();
  }

  async setBatchLimit(code: string, limit: number) {
    this.ensureKnownSource(code);
    await this.write(
      sourceBatchLimitKey(code),
      String(this.clampBatchLimit(limit)),
    );
    return this.getOverview();
  }

  async setRequestDelayMs(code: string, delayMs: number) {
    this.ensureKnownSource(code);
    await this.write(sourceDelayKey(code), String(Math.round(delayMs)));
    return this.getOverview();
  }

  async setMaxPages(code: string, maxPages: number) {
    this.ensureKnownSource(code);
    await this.write(sourceMaxPagesKey(code), String(Math.round(maxPages)));
    return this.getOverview();
  }

  /**
   * A broken regex here would throw inside the parser on every single product,
   * so it is rejected at write time — while the admin is still looking at the
   * form and can fix it, rather than hours later in the error log.
   */
  async setCategoryFilters(
    code: string,
    filters: { include?: string; exclude?: string },
  ) {
    this.ensureKnownSource(code);

    if (filters.include !== undefined) {
      this.ensureValidRegex(filters.include, 'INCLUDE');
      await this.write(sourceIncludeKey(code), filters.include);
    }
    if (filters.exclude !== undefined) {
      this.ensureValidRegex(filters.exclude, 'EXCLUDE');
      await this.write(sourceExcludeKey(code), filters.exclude);
    }

    return this.getOverview();
  }

  private ensureValidRegex(pattern: string, label: string) {
    if (!pattern.trim()) return;
    try {
      new RegExp(pattern, 'i');
    } catch (error) {
      throw new BadRequestException(
        `${label}: некорректное регулярное выражение — ${this.message(error)}`,
      );
    }
  }

  /* ----------------------------------------------------------- store ---- */

  private async isSourceFlagEnabled(code: string) {
    const source = getParserSource(code);
    const envValue = source ? process.env[source.envFlag] : undefined;
    const fallback =
      envValue === undefined
        ? (source?.defaultEnabled ?? false)
        : envValue === 'true';

    return this.readBoolean(sourceEnabledKey(code), fallback);
  }

  private envNumber(name: string | undefined, fallback: number) {
    const value = name ? Number(process.env[name]) : NaN;
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  /** Empty env var is a real value ("no filter"); unset falls through. */
  private envString(name: string | undefined) {
    if (!name) return undefined;
    return process.env[name];
  }

  private async readBoolean(key: string, fallback: boolean) {
    const value = await this.read(key);
    return value === undefined ? fallback : value === 'true';
  }

  private async read(key: string) {
    const values = await this.load();
    return values.get(key);
  }

  private async load() {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) return this.cache.values;

    try {
      const rows = await this.prisma.parserSetting.findMany();
      const values = new Map(rows.map((row) => [row.key, row.value]));
      this.cache = { values, expiresAt: now + CACHE_TTL_MS };
      return values;
    } catch (error) {
      // The crons gate on this read, and a cron handler that throws becomes an
      // unhandled rejection. An unreachable or un-migrated database must
      // therefore degrade to the env defaults, never propagate. Not cached:
      // the next call should retry rather than stay blind for the whole TTL.
      this.logger.warn(
        `Falling back to env parser settings: ${this.message(error)}`,
      );
      return new Map<string, string>();
    }
  }

  private async write(key: string, value: string) {
    await this.prisma.parserSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    // Drop the cache so the very next read (usually the response we are about
    // to build) reflects the change instead of the pre-write snapshot.
    this.cache = null;
  }

  private clampBatchLimit(limit: number) {
    return Math.min(Math.max(Math.round(limit), 1), MAX_BATCH_LIMIT);
  }

  private ensureKnownSource(code: string) {
    if (!getParserSource(code)) {
      throw new Error(`Unknown parser source: ${code}`);
    }
  }

  private message(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
