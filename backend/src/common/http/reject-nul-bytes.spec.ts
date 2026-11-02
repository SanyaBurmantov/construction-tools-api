import type { Request, Response } from 'express';
import { containsNulByte, rejectNulBytes } from './reject-nul-bytes';

function run(url: string, body?: unknown) {
  const res = { statusCode: 200, status: jest.fn(), json: jest.fn() };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  const next = jest.fn();
  rejectNulBytes(
    { url, originalUrl: url, body } as Request,
    res as unknown as Response,
    next,
  );
  return { status: res.statusCode, passed: next.mock.calls.length === 1 };
}

describe('rejectNulBytes', () => {
  it('answers 400 to %00 in the query or the path', () => {
    expect(run('/products/suggest?q=a%00b')).toEqual({
      status: 400,
      passed: false,
    });
    expect(run('/products/a%00')).toEqual({ status: 400, passed: false });
  });

  it('answers 400 to a NUL in a JSON body, keys included', () => {
    expect(run('/orders', { customer: { name: 'a\0b' } }).status).toBe(400);
    expect(run('/orders', { ['k\0']: 1 }).status).toBe(400);
    expect(run('/orders', { items: [{ note: 'x\0' }] }).status).toBe(400);
  });

  it('lets ordinary requests through', () => {
    expect(run('/products?search=%D0%B4%D1%80%D0%B5%D0%BB%D1%8C').passed).toBe(
      true,
    );
    expect(run('/orders', { items: [{ quantity: 100 }] }).passed).toBe(true);
  });

  it('stops descending at a bounded depth', () => {
    let deep: unknown = 'x\0';
    for (let i = 0; i < 20; i += 1) deep = { deep };
    expect(containsNulByte(deep)).toBe(false);
  });
});
