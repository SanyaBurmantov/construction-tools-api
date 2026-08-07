import { Prisma } from '@prisma/client';
import { upsertTolerantly } from './upsert-tolerantly';

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target: ['slug'] },
  });

describe('upsertTolerantly', () => {
  it('returns the value when nothing goes wrong', async () => {
    await expect(upsertTolerantly(() => Promise.resolve('ok'))).resolves.toBe(
      'ok',
    );
  });

  it('repeats an upsert that lost the insert race', async () => {
    // Second call succeeds because the winner's row now exists, so the upsert
    // takes its update path — this is the whole point of retrying.
    const operation = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(p2002())
      .mockResolvedValueOnce('created-by-the-other-worker');

    await expect(upsertTolerantly(operation)).resolves.toBe(
      'created-by-the-other-worker',
    );
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('gives up rather than looping when the conflict is permanent', async () => {
    const operation = jest.fn<Promise<string>, []>().mockRejectedValue(p2002());

    await expect(upsertTolerantly(operation)).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('never retries an error that is not a unique violation', async () => {
    const operation = jest
      .fn<Promise<string>, []>()
      .mockRejectedValue(new Error('connection reset'));

    await expect(upsertTolerantly(operation)).rejects.toThrow(
      'connection reset',
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
