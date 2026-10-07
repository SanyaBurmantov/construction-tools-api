import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function buildHost() {
  let body: Record<string, unknown> | undefined;
  const json = jest.fn((payload: Record<string, unknown>) => {
    body = payload;
  });
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', url: '/orders' }),
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
