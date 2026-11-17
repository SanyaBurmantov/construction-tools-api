import 'reflect-metadata';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { B2bitCron } from './b2bit.cron';

const cronTime = (method: keyof B2bitCron) =>
  (
    Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, B2bitCron.prototype[method]) as {
      cronTime: string;
    }
  ).cronTime;

describe('B2bitCron', () => {
  it('runs every job through the shared job runner', async () => {
    const runFromCron = jest.fn();
    const isSourceCronEnabled = jest.fn().mockResolvedValue(true);
    const cron = new B2bitCron(
      { isSourceCronEnabled } as never,
      { runFromCron } as never,
    );
    await cron.processPendingQueue();
    await cron.refreshCatalog();
    await cron.revalidateMonthly();
    expect(isSourceCronEnabled).toHaveBeenCalledWith('b2bit');
    expect(runFromCron.mock.calls).toEqual([
      ['b2bit', 'process'],
      ['b2bit', 'refresh', { waitForLock: true }],
      ['b2bit', 'revalidate'],
    ]);
  });

  it('keeps off the other suppliers’ slots', () => {
    expect(cronTime('processPendingQueue')).toBe('0 15,45 * * * *');
    expect(cronTime('refreshCatalog')).toBe('0 40 5 * * *');
    expect(cronTime('revalidateMonthly')).toBe('0 45 12 1 * *');
  });

  it('does not launch while the source is off', async () => {
    const runFromCron = jest.fn();
    const cron = new B2bitCron(
      { isSourceCronEnabled: jest.fn().mockResolvedValue(false) } as never,
      { runFromCron } as never,
    );
    await cron.processPendingQueue();
    await cron.refreshCatalog();
    expect(runFromCron).not.toHaveBeenCalled();
  });
});
