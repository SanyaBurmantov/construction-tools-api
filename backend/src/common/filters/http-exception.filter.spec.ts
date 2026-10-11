import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function buildHost(request: Record<string, unknown> = {}) {
  let body: Record<string, unknown> | undefined;
  const json = jest.fn((payload: Record<string, unknown>) => {
    body = payload;
  });
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({
        method: 'POST',
        url: '/orders',
        path: '/orders',
        headers: {},
        ...request,
      }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, getBody: () => body };
}

describe('HttpExceptionFilter', () => {
  it('uses the HttpException status', () => {
    const { host, status, getBody } = buildHost();
    new HttpExceptionFilter().catch(new BadRequestException('bad'), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(getBody()).toMatchObject({ statusCode: 400 });
  });

  it('honors express-style errors carrying a numeric statusCode (body-parser 413)', () => {
    const { host, status, getBody } = buildHost();
    const err = Object.assign(new Error('request entity too large'), {
      statusCode: 413,
    });
    new HttpExceptionFilter().catch(err, host);
    expect(status).toHaveBeenCalledWith(413);
    expect(getBody()).toMatchObject({
      statusCode: 413,
      message: 'request entity too large',
    });
  });

  it('falls back to 500 for unknown errors', () => {
    const { host, status } = buildHost();
    new HttpExceptionFilter().catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(500);
  });

  // Callers branch on these instead of parsing a Russian sentence.
  it('passes machine-readable detail through on client errors', () => {
    const { host, getBody } = buildHost();
    new HttpExceptionFilter().catch(
      new ConflictException({
        message: 'Цены изменились',
        code: 'CART_PRICE_CHANGED',
        expectedItemsTotal: 150,
        actualItemsTotal: 189.9,
      }),
      host,
    );

    expect(getBody()).toMatchObject({
      statusCode: 409,
      code: 'CART_PRICE_CHANGED',
      expectedItemsTotal: 150,
      actualItemsTotal: 189.9,
    });
  });

  it('passes a merge redirect target through', () => {
    const { host, getBody } = buildHost();
    new HttpExceptionFilter().catch(
      new NotFoundException({
        message: 'Product moved',
        code: 'PRODUCT_MERGED',
        redirectTo: 'perforator-b',
      }),
      host,
    );

    expect(getBody()).toMatchObject({ redirectTo: 'perforator-b' });
  });

  // A 500 body must never carry internals, however the exception was built.
  it('drops extra detail on server errors', () => {
    const { host, getBody } = buildHost();
    new HttpExceptionFilter().catch(
      new InternalServerErrorException({
        message: 'boom',
        connectionString: 'postgres://user:pass@host/db',
      }),
      host,
    );

    expect(Object.keys(getBody() ?? {}).sort()).toEqual([
      'error',
      'message',
      'path',
      'statusCode',
      'timestamp',
    ]);
  });

  it('never lets detail overwrite the rendered envelope keys', () => {
    const { host, getBody } = buildHost();
    new HttpExceptionFilter().catch(
      new BadRequestException({
        message: 'настоящее сообщение',
        statusCode: 999,
        path: '/spoofed',
      }),
      host,
    );

    expect(getBody()).toMatchObject({
      statusCode: 400,
      message: 'настоящее сообщение',
      path: '/orders',
    });
  });
});

/**
 * What reaches the error log behind /admin/errors.
 *
 * The rule is deliberately asymmetric: a server error is a bug wherever it
 * happens, while a client error is only interesting when an admin screen was
 * answered with it — the storefront's 400s are mostly someone mistyping a
 * phone number, and they would bury everything else.
 */
describe('HttpExceptionFilter error log', () => {
  const errorLog = () => ({ record: jest.fn(() => Promise.resolve()) });

  it('records every server error, wherever it came from', () => {
    const log = errorLog();
    const { host } = buildHost();
    new HttpExceptionFilter(log as never).catch(new Error('boom'), host);

    expect(log.record).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        method: 'POST',
        path: '/orders',
        kind: 'Error',
        message: 'boom',
        stack: expect.any(String) as string,
      }),
    );
  });

  it('records a client error from an admin screen', () => {
    const log = errorLog();
    const { host } = buildHost({ path: '/admin/users', url: '/admin/users' });
    new HttpExceptionFilter(log as never).catch(
      new BadRequestException(['name must be longer than or equal to 1']),
      host,
    );

    expect(log.record).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'name must be longer than or equal to 1',
        // The list is kept as sent, so a four-error validation failure can be
        // read line by line rather than as one run-on sentence.
        detail: { message: ['name must be longer than or equal to 1'] },
      }),
    );
  });

  // A storefront 400 is a form typo, not an incident.
  it('ignores a client error outside admin scope', () => {
    const log = errorLog();
    const { host } = buildHost();
    new HttpExceptionFilter(log as never).catch(
      new BadRequestException('bad'),
      host,
    );
    expect(log.record).not.toHaveBeenCalled();
  });

  // 401/403/404 are the normal noise of a public API, and the audit trail
  // already records admin attempts that a guard rejected.
  it('ignores a 404 even in admin scope', () => {
    const log = errorLog();
    const { host } = buildHost({
      path: '/admin/users/x',
      url: '/admin/users/x',
    });
    new HttpExceptionFilter(log as never).catch(
      new NotFoundException('nope'),
      host,
    );
    expect(log.record).not.toHaveBeenCalled();
  });

  // The filter is also constructed without the service (bootstrap, tests).
  it('answers normally with no error log attached', () => {
    const { host, status } = buildHost();
    expect(() =>
      new HttpExceptionFilter().catch(new Error('boom'), host),
    ).not.toThrow();
    expect(status).toHaveBeenCalledWith(500);
  });
});
