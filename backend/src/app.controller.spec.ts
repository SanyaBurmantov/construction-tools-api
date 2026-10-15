import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { PrismaService } from './prisma/prisma.service';
import { ParserRuntimeStatusService } from './parser/parser-runtime-status.service';
import { AuthService } from './auth/auth.service';

describe('AppController', () => {
  let appController: AppController;
  const prisma = { $queryRaw: jest.fn() };

  beforeEach(async () => {
    prisma.$queryRaw.mockReset();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: ParserRuntimeStatusService, useValue: {} },
        { provide: AuthService, useValue: {} },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('no longer serves the NestJS template "Hello World!" at GET /', () => {
    // It advertised the framework on a public URL (security audit, p. 10).
    expect(
      (appController as unknown as Record<string, unknown>).getHello,
    ).toBeUndefined();
  });

  it('reports liveness', () => {
    expect(appController.getHealth()).toEqual({ status: 'ok' });
  });

  it('reports readiness when the database answers', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    await expect(appController.getReadiness()).resolves.toEqual({
      status: 'ready',
    });
  });

  it('answers 503 when the database does not', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    await expect(appController.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
