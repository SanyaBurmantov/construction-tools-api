import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ParserLogEntry = {
  url: string;
  message: string;
  createdAt: string;
};

@Injectable()
export class ParserLogService {
  constructor(private readonly prisma: PrismaService) {}

  async addError(url: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.parserError.create({
      data: {
        url,
        message,
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    const staleErrors = await this.prisma.parserError.findMany({
      orderBy: { createdAt: 'desc' },
      skip: 200,
      select: { id: true },
    });
    if (staleErrors.length) {
      await this.prisma.parserError.deleteMany({
        where: { id: { in: staleErrors.map((entry) => entry.id) } },
      });
    }
  }

  async getErrors(): Promise<ParserLogEntry[]> {
    const errors = await this.prisma.parserError.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { url: true, message: true, createdAt: true },
    });

    return errors.map((entry) => ({
      url: entry.url,
      message: entry.message,
      createdAt: entry.createdAt.toISOString(),
    }));
  }

  async clearErrors() {
    await this.prisma.parserError.deleteMany();
    return { ok: true };
  }
}
