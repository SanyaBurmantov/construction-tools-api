import { Injectable } from '@nestjs/common';

export type ParserLogEntry = {
  url: string;
  message: string;
  createdAt: string;
};

@Injectable()
export class ParserLogService {
  private static readonly errors: ParserLogEntry[] = [];

  addError(url: string, error: unknown) {
    ParserLogService.errors.unshift({
      url,
      message: error instanceof Error ? error.message : String(error),
      createdAt: new Date().toISOString(),
    });

    ParserLogService.errors.splice(200);
  }

  getErrors() {
    return ParserLogService.errors;
  }

  clearErrors() {
    ParserLogService.errors.length = 0;
    return { ok: true };
  }
}
