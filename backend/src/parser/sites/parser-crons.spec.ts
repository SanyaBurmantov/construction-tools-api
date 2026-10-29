import 'reflect-metadata';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { DukonCron } from './dukon.cron';
import { ThToolsCron } from './th-tools.cron';

describe.each([
  { Cron: DukonCron, code: 'dukon', refresh: '0 0 6 * * *', waits: true },
  { Cron: ThToolsCron, code: 'th-tools', refresh: '0 40 6 * * *', waits: true },
])('$code scheduled imports', ({ Cron, code, refresh, waits }) => {
  it('uses the same guarded job runner as manual imports', async () => {
    const runFromCron = jest.fn();
    const cron = new Cron(
      { isSourceCronEnabled: () => Promise.resolve(true) } as never,
      { runFromCron } as never,
    );
    await cron.processPendingQueue();
    await cron.refreshSitemap();
    expect(runFromCron.mock.calls).toEqual([
      [code, 'process'],
      waits ? [code, 'refresh', { waitForLock: true }] : [code, 'refresh'],
    ]);
  });
  it('preserves the daily refresh schedule', () => {
    const options = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      Cron.prototype.refreshSitemap,
    ) as { cronTime: string };
    expect(options.cronTime).toBe(refresh);
  });
  it('does not launch disabled sources', async () => {
    const runFromCron = jest.fn();
    const cron = new Cron(
      { isSourceCronEnabled: () => Promise.resolve(false) } as never,
      { runFromCron } as never,
    );
    await cron.processPendingQueue();
    expect(runFromCron).not.toHaveBeenCalled();
  });
});
