import { ArgumentsHost, BadRequestException } from '@nestjs/common';
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
});
