import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

/**
 * Boots the dependency graph without touching the database.
 *
 * `compile()` resolves every provider but does not run lifecycle hooks, so no
 * connection is opened. This catches the one class of bug the type-checker
 * cannot see: a service that gains a constructor dependency which some *other*
 * module providing that same service was never told about. That failure only
 * ever surfaced as `Nest can't resolve dependencies of …` at container start —
 * i.e. in production, after a deploy.
 */
describe('AppModule', () => {
  it('resolves every provider in every module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Prisma is the only provider that would reach outside the process.
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        $on: jest.fn(),
      })
      .compile();

    expect(moduleRef).toBeDefined();
  });
});
