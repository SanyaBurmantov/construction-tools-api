import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { ToolsByCron } from './tools-by.cron';

describe('ToolsByCron revalidation', () => {
  it('requeues existing products through the shared job runner when enabled', async () => {
    const isSourceCronEnabled = jest.fn().mockResolvedValue(true);
    const runFromCron = jest.fn();
    const cron = new ToolsByCron(
      { isSourceCronEnabled } as never,
      { runFromCron } as never,
    );
    await cron.revalidateMonthly();
    expect(isSourceCronEnabled).toHaveBeenCalledWith('tools-by');
    expect(runFromCron).toHaveBeenCalledWith('tools-by', 'revalidate');
    const method = Object.getOwnPropertyDescriptor(
      ToolsByCron.prototype,
      'revalidateMonthly',
    ) as { value: () => Promise<void> };
    expect(
      Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, method.value),
    ).toMatchObject({
      cronTime: '0 30 12 1 * *',
    });
  });

  it('respects the global and source cron gate', async () => {
    const runFromCron = jest.fn();
    const cron = new ToolsByCron(
      { isSourceCronEnabled: jest.fn().mockResolvedValue(false) } as never,
      { runFromCron } as never,
    );
    await cron.revalidateMonthly();
    expect(runFromCron).not.toHaveBeenCalled();
  });
});
