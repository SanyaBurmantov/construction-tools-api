import type { NextFunction, Request, Response } from 'express';

/**
 * A NUL byte anywhere in a request is answered 400 before it reaches a
 * controller. PostgreSQL cannot store `\0` in text, so `?q=%00` used to become
 * a Prisma error deep in a query — a 500, an error-log row and a Telegram
 * alert per request: an anonymous way to flood the alerts topic
 * (audit 2026-10-30). Nothing legitimate sends one.
 */
const MAX_DEPTH = 8;

export function containsNulByte(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\0');
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object')
    return false;
  if (Array.isArray(value))
    return value.some((item) => containsNulByte(item, depth + 1));
  return Object.entries(value).some(
    ([key, item]) => key.includes('\0') || containsNulByte(item, depth + 1),
  );
}

function urlHasNulByte(url: string): boolean {
  if (url.includes('\0')) return true;
  return /%00/i.test(url);
}

export function rejectNulBytes(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (urlHasNulByte(req.originalUrl || req.url) || containsNulByte(req.body)) {
    res.status(400).json({
      statusCode: 400,
      message: 'Request contains a NUL byte',
      error: 'Bad Request',
    });
    return;
  }
  next();
}
