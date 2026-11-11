import { BLOCKED_AFTER_FAILURES } from './supplier-connection';
import {
  SupplierBlockedError,
  SupplierConnectionService,
  SupplierUnreachableError,
} from './supplier-connection.service';

/** Just the two tables the service touches, in memory. */
function fakePrisma() {
  const settings = new Map<string, string>();
  const rows = new Map<string, Record<string, unknown>>();
  return {
    settings,
    rows,
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
    },
    supplierConnection: {
      findMany: jest.fn(() => Promise.resolve([...rows.values()])),
      deleteMany: jest.fn(({ where }: { where: { route: string } }) => {
        for (const [key, row] of rows)
          if (row.route === where.route) rows.delete(key);
        return Promise.resolve();
      }),
      upsert: jest.fn(
        ({
          create,
        }: {
          create: Record<string, unknown> & {
            sourceCode: string;
            route: string;
          };
        }) => {
          rows.set(`${create.sourceCode}:${create.route}`, {
            ...create,
            updatedAt: new Date(),
          });
          return Promise.resolve();
        },
      ),
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
const noRetry = { retries: 0, retryBaseMs: 0 };

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
    const blocked = connection.assertUsable('dukon');
    await expect(blocked).rejects.toBeInstanceOf(SupplierBlockedError);
    await expect(connection.assertUsable('dukon')).rejects.toThrow(
      /dukon\.by напрямую не устанавливает соединение.*прокси не настроен/,
    );
    // Other suppliers are not affected.
    await expect(connection.assertUsable('tools-by')).resolves.toMatchObject({
      usable: true,
    });
  });

  it('in auto mode moves a blocked source to the proxy, and back after a good probe', async () => {
    const { connection } = service();
    await connection.setProxyUrl('http://user:secret@10.0.0.1:8000');
    await failUntilBlocked(connection);

    await expect(connection.routeFor('dukon')).resolves.toMatchObject({
      route: 'PROXY',
      usable: true,
    });
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('ok', { status: 200 })),
    );
    await connection.fetch('https://dukon.by/p/2', {}, noRetry);
    const init = fetchMock.mock.calls.at(-1)?.[1] as { dispatcher?: unknown };
    expect(init.dispatcher).toBeDefined();

    // The probe tries direct as well; once it answers, direct again.
    await connection.probe('dukon');
    await expect(connection.routeFor('dukon')).resolves.toMatchObject({
      route: 'DIRECT',
      usable: true,
    });
  });

  it('a blocked proxy leaves nowhere to go', async () => {
    const { connection } = service();
    await connection.setProxyUrl('http://10.0.0.1:8000');
    await connection.setProxyMode('dukon', 'always');
    await failUntilBlocked(connection);
    await expect(connection.assertUsable('dukon')).rejects.toThrow(
      /через прокси.*прокси тоже не помогает/,
    );
  });

  it('photos stay direct unless allowed through the proxy', async () => {
    const { connection } = service();
    await connection.setProxyUrl('http://10.0.0.1:8000');
    await connection.setProxyMode('dukon', 'always');
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('x', { status: 200 })),
    );

    await connection.fetch('https://dukon.by/img/a.jpg', {}, noRetry, 'image');
    expect(
      (fetchMock.mock.calls[0][1] as { dispatcher?: unknown }).dispatcher,
    ).toBeUndefined();

    await connection.setProxyImages(true);
    await connection.fetch('https://dukon.by/img/a.jpg', {}, noRetry, 'image');
    expect(
      (fetchMock.mock.calls[1][1] as { dispatcher?: unknown }).dispatcher,
    ).toBeDefined();
  });

  it('does not count hosts that are no supplier', async () => {
    const { connection, prisma } = service();
    fetchMock.mockImplementation(refused);
    await expect(
      connection.fetch('https://api.telegram.org/x', {}, noRetry),
    ).rejects.not.toBeInstanceOf(SupplierUnreachableError);
    expect(prisma.rows.size).toBe(0);
  });

  it('keeps the proxy password off the screen and refuses SOCKS', async () => {
    const { connection } = service();
    await expect(
      connection.setProxyUrl('socks5://1.2.3.4:1080'),
    ).rejects.toThrow(/HTTP/);
    await connection.setProxyUrl('http://user:secret@10.0.0.1:8000');
    const overview = await connection.overview();
    expect(JSON.stringify(overview)).not.toContain('secret');
    expect(overview.proxy).toMatchObject({
      configured: true,
      url: 'http://user:***@10.0.0.1:8000',
      from: 'admin',
    });
  });

  it('a new proxy starts with a clean record', async () => {
    const { connection, prisma } = service();
    await connection.setProxyUrl('http://10.0.0.1:8000');
    await connection.setProxyMode('dukon', 'always');
    await failUntilBlocked(connection);
    expect(prisma.rows.get('dukon:PROXY')?.state).toBe('BLOCKED');
    await connection.setProxyUrl('http://10.0.0.2:8000');
    expect(prisma.rows.has('dukon:PROXY')).toBe(false);
    await expect(connection.assertUsable('dukon')).resolves.toMatchObject({
      route: 'PROXY',
    });
  });
});
