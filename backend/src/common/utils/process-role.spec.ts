import { processRole, runsBackgroundJobs, servesHttp } from './process-role';

describe('process role', () => {
  const original = process.env.PROCESS_ROLE;
  afterEach(() => {
    if (original === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = original;
  });

  it('runs everything in one process when unset (dev, tests)', () => {
    delete process.env.PROCESS_ROLE;
    expect(processRole()).toBe('all');
    expect(runsBackgroundJobs()).toBe(true);
    expect(servesHttp()).toBe(true);
  });

  it('keeps background work out of the API', () => {
    process.env.PROCESS_ROLE = 'api';
    expect(runsBackgroundJobs()).toBe(false);
    expect(servesHttp()).toBe(true);
  });

  it('keeps HTTP-only duties out of the worker', () => {
    process.env.PROCESS_ROLE = ' Worker ';
    expect(processRole()).toBe('worker');
    expect(runsBackgroundJobs()).toBe(true);
    expect(servesHttp()).toBe(false);
  });

  it('treats an unknown value as a single process rather than as neither', () => {
    process.env.PROCESS_ROLE = 'scheduler';
    expect(processRole()).toBe('all');
  });
});
