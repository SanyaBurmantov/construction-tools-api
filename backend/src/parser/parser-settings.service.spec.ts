import { ParserSettingsService } from './parser-settings.service';
import { PrismaService } from '../prisma/prisma.service';

type Row = { key: string; value: string };

function createService(rows: Row[] = []) {
  const store = new Map(rows.map((row) => [row.key, row.value]));
  const prisma = {
    parserSetting: {
      findMany: jest.fn(() =>
        Promise.resolve(
          [...store].map(([key, value]) => ({ key, value })) as Row[],
        ),
      ),
      upsert: jest.fn(({ where, create }: { where: Row; create: Row }) => {
        store.set(where.key, create.value);
        return Promise.resolve(create);
      }),
    },
  } as unknown as PrismaService;

  return { service: new ParserSettingsService(prisma), prisma, store };
}

describe('ParserSettingsService', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('falls back to the env flag when nothing is stored', async () => {
    process.env.PARSER_CRON_ENABLED = 'true';
    const { service } = createService();

    await expect(service.isCronEnabled()).resolves.toBe(true);
  });

  it('treats a missing env flag as disabled', async () => {
    delete process.env.PARSER_CRON_ENABLED;
    const { service } = createService();

    await expect(service.isCronEnabled()).resolves.toBe(false);
  });

  it('lets a stored value override the env flag in both directions', async () => {
    process.env.PARSER_CRON_ENABLED = 'true';
    const off = createService([{ key: 'cron.enabled', value: 'false' }]);
    await expect(off.service.isCronEnabled()).resolves.toBe(false);

    delete process.env.PARSER_CRON_ENABLED;
    const on = createService([{ key: 'cron.enabled', value: 'true' }]);
    await expect(on.service.isCronEnabled()).resolves.toBe(true);
  });

  it('requires both the global and the per-source switch', async () => {
    process.env.PARSER_CRON_ENABLED = 'true';
    const { service } = createService([
      { key: 'cron.th-tools.enabled', value: 'false' },
    ]);

    await expect(service.isSourceCronEnabled('th-tools')).resolves.toBe(false);
  });

  it('keeps 7745 off by default — it is a sample site, not a supplier', async () => {
    process.env.PARSER_CRON_ENABLED = 'true';
    delete process.env.SUPPLIER_7745_CRON_ENABLED;
    const { service } = createService();

    await expect(service.isSourceCronEnabled('7745')).resolves.toBe(false);
    await expect(service.isSourceCronEnabled('th-tools')).resolves.toBe(true);
  });

  it('clamps the batch limit and prefers the stored value over env', async () => {
    process.env.TH_TOOLS_CRON_BATCH_LIMIT = '30';
    const { service } = createService([
      { key: 'cron.th-tools.batchLimit', value: '400' },
    ]);

    await expect(service.getBatchLimit('th-tools')).resolves.toBe(400);

    await service.setBatchLimit('th-tools', 99999);
    await expect(service.getBatchLimit('th-tools')).resolves.toBe(2000);
  });

  it('reflects a write immediately instead of serving the cached snapshot', async () => {
    process.env.PARSER_CRON_ENABLED = 'false';
    const { service } = createService();

    await expect(service.isCronEnabled()).resolves.toBe(false);
    await service.setCronEnabled(true);
    await expect(service.isCronEnabled()).resolves.toBe(true);
  });

  it('falls back to env when the settings table is unreachable', async () => {
    process.env.PARSER_CRON_ENABLED = 'true';
    const prisma = {
      parserSetting: {
        findMany: jest.fn(() =>
          Promise.reject(new Error('relation "ParserSetting" does not exist')),
        ),
      },
    } as unknown as PrismaService;
    const service = new ParserSettingsService(prisma);

    // Must resolve, not reject: the crons gate on this call outside their
    // try/catch, so a throw here would crash the process.
    await expect(service.isCronEnabled()).resolves.toBe(true);
    await expect(service.getBatchLimit('th-tools')).resolves.toBeGreaterThan(0);
  });

  it('rejects unknown sources rather than silently storing a typo', async () => {
    const { service } = createService();

    await expect(
      service.setSourceCronEnabled('th-tolls', true),
    ).rejects.toThrow(/Unknown parser source/);
  });
});

describe('ParserSettingsService — runtime knobs', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('clamps the request delay so a parser can never be told to hammer', async () => {
    const { service } = createService([
      { key: 'parser.th-tools.requestDelayMs', value: '1' },
    ]);

    await expect(service.getRequestDelayMs('th-tools')).resolves.toBe(200);
  });

  it('prefers a stored delay over the env var', async () => {
    process.env.TH_TOOLS_REQUEST_DELAY_MS = '1500';
    const { service } = createService([
      { key: 'parser.th-tools.requestDelayMs', value: '4000' },
    ]);

    await expect(service.getRequestDelayMs('th-tools')).resolves.toBe(4000);
  });

  it('treats a stored empty filter as "no filter", not as "unset"', async () => {
    // Otherwise an admin could never clear the default EXCLUDE from the UI.
    const { service } = createService([
      { key: 'parser.th-tools.categoryExclude', value: '' },
    ]);

    await expect(service.getCategoryFilters('th-tools')).resolves.toEqual({
      include: '',
      exclude: '',
    });
  });

  it('falls back to the code default when nothing is stored or in env', async () => {
    delete process.env.TH_TOOLS_CATEGORY_EXCLUDE_REGEX;
    const { service } = createService();

    const filters = await service.getCategoryFilters('th-tools');
    expect(filters.exclude).toContain('косметика');
  });

  it('refuses a regex that would throw on every product', async () => {
    const { service } = createService();

    await expect(
      service.setCategoryFilters('th-tools', { exclude: '[unclosed' }),
    ).rejects.toThrow(/регулярное выражение/);
  });

  it('accepts an empty regex — that is how a filter is cleared', async () => {
    const { service } = createService();

    await expect(
      service.setCategoryFilters('th-tools', { include: '' }),
    ).resolves.toBeDefined();
  });
  it('uses a larger tools.by crawl and product batch without changing other sources', async () => {
    delete process.env.TOOLS_BY_CRON_BATCH_LIMIT;
    delete process.env.TOOLS_BY_DISCOVERY_MAX_PAGES;
    delete process.env.TH_TOOLS_CRON_BATCH_LIMIT;
    const { service } = createService();
    await expect(service.getBatchLimit('tools-by')).resolves.toBe(300);
    await expect(service.getMaxPages('tools-by')).resolves.toBe(2000);
    await expect(service.getBatchLimit('th-tools')).resolves.toBe(30);
  });

  it('preserves env and stored overrides over the new tools.by defaults', async () => {
    process.env.TOOLS_BY_CRON_BATCH_LIMIT = '100';
    process.env.TOOLS_BY_DISCOVERY_MAX_PAGES = '500';
    const { service } = createService();
    await expect(service.getBatchLimit('tools-by')).resolves.toBe(100);
    await expect(service.getMaxPages('tools-by')).resolves.toBe(500);
    await service.setBatchLimit('tools-by', 600);
    await service.setMaxPages('tools-by', 4000);
    await expect(service.getBatchLimit('tools-by')).resolves.toBe(600);
    await expect(service.getMaxPages('tools-by')).resolves.toBe(4000);
  });

  describe('category batch limit', () => {
    it('falls back to the code default', async () => {
      delete process.env.TH_TOOLS_CATEGORY_BATCH_LIMIT;
      const { service } = createService();

      await expect(service.getCategoryBatchLimit('th-tools')).resolves.toBe(20);
    });

    it('prefers the env var over the code default', async () => {
      process.env.TH_TOOLS_CATEGORY_BATCH_LIMIT = '40';
      const { service } = createService();

      await expect(service.getCategoryBatchLimit('th-tools')).resolves.toBe(40);
    });

    it('prefers a stored row over the env var', async () => {
      process.env.TH_TOOLS_CATEGORY_BATCH_LIMIT = '40';
      const { service } = createService([
        { key: 'cron.th-tools.categoryBatchLimit', value: '7' },
      ]);

      await expect(service.getCategoryBatchLimit('th-tools')).resolves.toBe(7);
    });

    it('clamps what an admin can store', async () => {
      const { service, store } = createService();

      await service.setCategoryBatchLimit('th-tools', 10_000);
      expect(store.get('cron.th-tools.categoryBatchLimit')).toBe('200');

      await service.setCategoryBatchLimit('th-tools', 0);
      expect(store.get('cron.th-tools.categoryBatchLimit')).toBe('1');
    });

    it('is reported only for a source that crawls categories', async () => {
      const { service } = createService();
      const overview = await service.getOverview();

      const thTools = overview.sources.find((s) => s.code === 'th-tools');
      const dukon = overview.sources.find((s) => s.code === 'dukon');

      expect(thTools).toHaveProperty('categoryBatchLimit');
      expect(dukon).not.toHaveProperty('categoryBatchLimit');
    });
  });
});
