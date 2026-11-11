import { BLOCKED_AFTER_FAILURES } from './supplier-connection';
import {
  SupplierBlockedError,
  SupplierConnectionService,
  SupplierUnreachableError,
} from './supplier-connection.service';

type Row = Record<string, unknown> & { sourceCode: string; route: string };
type ProxyRow = { id: string; name: string; url: string; createdAt: Date };

/** Just the tables the service touches, in memory. */
function fakePrisma() {
  const settings = new Map<string, string>();
  const rows = new Map<string, Row>();
  const proxies: ProxyRow[] = [];
  let nextId = 1;
  return {
    settings,
    rows,
    proxies,
    parserSetting: {
      findMany: jest.fn(() =>
        Promise.resolve([...settings].map(([key, value]) => ({ key, value }))),
      ),
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: { key: string };
          create: { value: string };
        }) => {
          settings.set(where.key, create.value);
          return Promise.resolve();
        },
      ),
      deleteMany: jest.fn(({ where }: { where: { value: string } }) => {
        for (const [key, value] of settings) {
          if (key.endsWith('.proxyId') && value === where.value)
            settings.delete(key);
        }
        return Promise.resolve();
      }),
    },
    parserProxy: {
      findMany: jest.fn(() => Promise.resolve(proxies.map((p) => ({ ...p })))),
      count: jest.fn(() => Promise.resolve(proxies.length)),
      findUnique: jest.fn(({ where }: { where: { id: string } }) => {
        const found = proxies.find((p) => p.id === where.id);
        // A copy, as Prisma returns: later updates must not change it.
        return Promise.resolve(found ? { ...found } : null);
      }),
      create: jest.fn(({ data }: { data: { name: string; url: string } }) => {
        const row = { id: `p${nextId++}`, createdAt: new Date(), ...data };
        proxies.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<ProxyRow>;
        }) => {
          Object.assign(proxies.find((p) => p.id === where.id)!, data);
          return Promise.resolve();
        },
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        proxies.splice(
          proxies.findIndex((p) => p.id === where.id),
          1,
        );
        return Promise.resolve();
      }),
    },
    supplierConnection: {
      findMany: jest.fn(() => Promise.resolve([...rows.values()])),
      deleteMany: jest.fn(
        ({
          where,
        }: {
          where: { route: string; sourceCode?: { in: string[] } };
        }) => {
          for (const [key, row] of rows) {
            if (
              row.route === where.route &&
              (!where.sourceCode ||
                where.sourceCode.in.includes(row.sourceCode))
            ) {
              rows.delete(key);
            }
          }
          return Promise.resolve();
        },
      ),
      upsert: jest.fn(({ create }: { create: Row }) => {
        rows.set(`${create.sourceCode}:${create.route}`, {
          ...create,
          updatedAt: new Date(),
        });
        return Promise.resolve();
      }),
    },
  };
}

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});
beforeEach(() => fetchMock.mockReset());

function service() {
  const prisma = fakePrisma();
  return { prisma, connection: new SupplierConnectionService(prisma as never) };
}

const refused = () => Promise.reject(new TypeError('fetch failed'));
const answered = () => Promise.resolve(new Response('ok', { status: 200 }));
const noRetry = { retries: 0, retryBaseMs: 0 };
const dispatcherOf = (call: number) =>
  (fetchMock.mock.calls[call][1] as { dispatcher?: object }).dispatcher;

async function failUntilBlocked(
  connection: SupplierConnectionService,
  url = 'https://dukon.by/p/1',
) {
  fetchMock.mockImplementation(refused);
  for (let i = 0; i < BLOCKED_AFTER_FAILURES; i++) {
    await expect(connection.fetch(url, {}, noRetry)).rejects.toBeInstanceOf(
      SupplierUnreachableError,
    );
  }
}

describe('SupplierConnectionService', () => {
  it('blocks a source that stopped answering and says why before a batch', async () => {
    const { connection, prisma } = service();
    await failUntilBlocked(connection);

    expect(prisma.rows.get('dukon:DIRECT')).toMatchObject({
      state: 'BLOCKED',
      failureKind: 'UNREACHABLE',
      consecutiveFailures: BLOCKED_AFTER_FAILURES,
    });
    await expect(connection.assertUsable('dukon')).rejects.toBeInstanceOf(
      SupplierBlockedError,
    );
    await expect(connection.assertUsable('dukon')).rejects.toThrow(
      /dukon\.by напрямую не устанавливает соединение.*прокси не настроен/,
    );
    // Other suppliers are not affected.
    await expect(connection.assertUsable('tools-by')).resolves.toMatchObject({
      usable: true,
    });
  });

  it('in auto mode moves a blocked source to its proxy, and back after a good probe', async () => {
    const { connection } = service();
    await connection.addProxy('Минск', 'http://user:secret@10.0.0.1:8000');
    await failUntilBlocked(connection);

    await expect(connection.routeFor('dukon')).resolves.toMatchObject({
      route: 'PROXY',
      usable: true,
      proxy: { name: 'Минск' },
    });
    fetchMock.mockImplementation(answered);
    await connection.fetch('https://dukon.by/p/2', {}, noRetry);
    expect(dispatcherOf(fetchMock.mock.calls.length - 1)).toBeDefined();

    // The probe tries direct as well; once it answers, direct again.
    await connection.probe('dukon');
    await expect(connection.routeFor('dukon')).resolves.toMatchObject({
      route: 'DIRECT',
      usable: true,
    });
  });

  it('each source goes through the proxy picked for it, the first one by default', async () => {
    const { connection } = service();
    const first = await connection.addProxy(undefined, 'http://10.0.0.1:8000');
    const second = await connection.addProxy('Второй', 'http://10.0.0.2:8000');
    await connection.setProxyMode('dukon', 'always');
    await connection.setProxyMode('tools-by', 'always');
    await connection.setProxyChoice('tools-by', second);
    fetchMock.mockImplementation(answered);

    await connection.fetch('https://dukon.by/', {}, noRetry);
    await connection.fetch('https://tools.by/', {}, noRetry);
    expect(dispatcherOf(0)).not.toBe(dispatcherOf(1));
    await expect(connection.routeFor('dukon')).resolves.toMatchObject({
      proxy: { id: first, name: 'Прокси 1' },
    });

    const overview = await connection.overview();
    expect(overview.proxies.map((p) => [p.name, p.usedBy])).toEqual([
      ['Прокси 1', ['th-tools', 'dukon']],
      ['Второй', ['tools-by']],
    ]);
    await expect(
      connection.setProxyChoice('dukon', 'no-such-proxy'),
    ).rejects.toThrow(/нет в списке/);
  });

  it('a blocked proxy leaves nowhere to go and says which one', async () => {
    const { connection } = service();
    await connection.addProxy('Минск', 'http://10.0.0.1:8000');
    await connection.setProxyMode('dukon', 'always');
    await failUntilBlocked(connection);
    await expect(connection.assertUsable('dukon')).rejects.toThrow(
      /через прокси «Минск».*выберите другой/,
    );
  });

  it('another proxy for a source, or a new address, starts its record over', async () => {
    const { connection, prisma } = service();
    await connection.addProxy('A', 'http://10.0.0.1:8000');
    const second = await connection.addProxy('B', 'http://10.0.0.2:8000');
    await connection.setProxyMode('dukon', 'always');
    await failUntilBlocked(connection);
    expect(prisma.rows.get('dukon:PROXY')?.state).toBe('BLOCKED');

    await connection.setProxyChoice('dukon', second);
    expect(prisma.rows.has('dukon:PROXY')).toBe(false);
    await expect(connection.assertUsable('dukon')).resolves.toMatchObject({
      route: 'PROXY',
      proxy: { name: 'B' },
    });

    await failUntilBlocked(connection);
    await connection.updateProxy(second, { url: 'http://10.0.0.3:8000' });
    expect(prisma.rows.has('dukon:PROXY')).toBe(false);
    // Renaming alone keeps the record.
    await failUntilBlocked(connection);
    await connection.updateProxy(second, { name: 'B2' });
    expect(prisma.rows.get('dukon:PROXY')?.state).toBe('BLOCKED');
  });

  it('deleting a proxy moves its sources to the first one left', async () => {
    const { connection, prisma } = service();
    await connection.addProxy('A', 'http://10.0.0.1:8000');
    const b = await connection.addProxy('B', 'http://10.0.0.2:8000');
    await connection.setProxyChoice('dukon', b);
    await connection.deleteProxy(b);
    expect(prisma.settings.has('parser.dukon.proxyId')).toBe(false);
    await expect(connection.routeFor('dukon')).resolves.toMatchObject({
      proxy: { name: 'A' },
    });
  });

  it('photos stay direct unless allowed through the proxy', async () => {
    const { connection } = service();
    await connection.addProxy(undefined, 'http://10.0.0.1:8000');
    await connection.setProxyMode('dukon', 'always');
    fetchMock.mockImplementation(answered);

    await connection.fetch('https://dukon.by/img/a.jpg', {}, noRetry, 'image');
    expect(dispatcherOf(0)).toBeUndefined();

    await connection.setProxyImages(true);
    await connection.fetch('https://dukon.by/img/a.jpg', {}, noRetry, 'image');
    expect(dispatcherOf(1)).toBeDefined();
  });

  it('does not count hosts that are no supplier', async () => {
    const { connection, prisma } = service();
    fetchMock.mockImplementation(refused);
    await expect(
      connection.fetch('https://api.telegram.org/x', {}, noRetry),
    ).rejects.not.toBeInstanceOf(SupplierUnreachableError);
    expect(prisma.rows.size).toBe(0);
  });

  it('keeps proxy passwords off the screen and refuses SOCKS', async () => {
    const { connection } = service();
    await expect(
      connection.addProxy(undefined, 'socks5://1.2.3.4:1080'),
    ).rejects.toThrow(/HTTP/);
    await connection.addProxy('A', 'http://user:secret@10.0.0.1:8000');
    const overview = await connection.overview();
    expect(JSON.stringify(overview)).not.toContain('secret');
    expect(overview.proxies[0]).toMatchObject({
      name: 'A',
      url: 'http://user:***@10.0.0.1:8000',
      from: 'admin',
    });
  });

  it('lists the env proxy last and keeps it out of reach of the admin', async () => {
    process.env.PARSER_PROXY_URL = 'http://10.9.9.9:3128';
    try {
      const { connection } = service();
      await connection.addProxy('A', 'http://10.0.0.1:8000');
      const overview = await connection.overview();
      expect(overview.proxies.map((p) => [p.name, p.from])).toEqual([
        ['A', 'admin'],
        ['PARSER_PROXY_URL', 'env'],
      ]);
      await expect(connection.deleteProxy('env')).rejects.toThrow(
        /\.env\.prod/,
      );
    } finally {
      delete process.env.PARSER_PROXY_URL;
    }
  });
});
