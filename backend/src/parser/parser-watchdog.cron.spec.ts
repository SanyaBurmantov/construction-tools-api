import { ParserWatchdogCron } from './parser-watchdog.cron';

function setup() {
  const freshness = {
    sourceCode: 'tools-by',
    total: 5303,
    stale: 5303,
    stalePercent: 100,
    oldestSync: new Date('2026-10-01'),
    newestSync: new Date('2026-10-01'),
    health: 'STALE',
  };
  const health = {
    jobs: [] as unknown[],
    priceFreshness: [freshness],
    priceMaxAgeHours: 48,
  };
  const notifyParserProblem = jest.fn().mockResolvedValue(true);
  const isSourceCronEnabled = jest.fn().mockResolvedValue(true);
  const cron = new ParserWatchdogCron(
    { getHealth: jest.fn(() => Promise.resolve(health)) } as never,
    {
      isCronEnabled: jest.fn().mockResolvedValue(true),
      isSourceCronEnabled,
    } as never,
    { requeueRecoverable: jest.fn().mockResolvedValue({ total: 0 }) } as never,
    { notifyParserProblem } as never,
  );
  return { cron, health, freshness, notifyParserProblem, isSourceCronEnabled };
}

describe('ParserWatchdogCron price freshness', () => {
  it('alerts once on stale prices and alerts again after recovery and a new incident', async () => {
    const { cron, health, freshness, notifyParserProblem } = setup();
    await cron.watch();
    await cron.watch();
    expect(notifyParserProblem).toHaveBeenCalledTimes(1);
    expect(notifyParserProblem).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'tools-by-price-freshness',
        reason: expect.stringContaining('5303 из 5303') as unknown as string,
      }),
    );
    health.priceFreshness = [{ ...freshness, health: 'OK', stale: 0 }];
    await cron.watch();
    health.priceFreshness = [freshness];
    await cron.watch();
    expect(notifyParserProblem).toHaveBeenCalledTimes(2);
  });

  it('retries notification after a delivery failure instead of suppressing it forever', async () => {
    const { cron, notifyParserProblem } = setup();
    notifyParserProblem.mockRejectedValueOnce(new Error('delivery failed'));
    await cron.watch();
    await cron.watch();
    expect(notifyParserProblem).toHaveBeenCalledTimes(2);
  });

  it('retries when Telegram reports an unsuccessful delivery without throwing', async () => {
    const { cron, notifyParserProblem } = setup();
    notifyParserProblem.mockResolvedValueOnce(false);
    await cron.watch();
    await cron.watch();
    await cron.watch();
    expect(notifyParserProblem).toHaveBeenCalledTimes(2);
  });

  it('alerts about missed process runs while respecting a disabled source', async () => {
    const { cron, health, notifyParserProblem, isSourceCronEnabled } = setup();
    health.priceFreshness = [];
    health.jobs = [
      {
        key: 'dukon-process',
        label: 'Dukon',
        health: 'STALE',
        maxAgeHours: 2,
        lastError: null,
      },
    ];
    isSourceCronEnabled.mockResolvedValueOnce(false);
    await cron.watch();
    expect(notifyParserProblem).not.toHaveBeenCalled();
    await cron.watch();
    expect(notifyParserProblem).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'dukon-process',
        reason: 'Успешного запуска не было более 2 ч',
      }),
    );
  });
});
