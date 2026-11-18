import {
  SSR_VISITOR_IP_HEADER,
  SSR_VISITOR_UA_HEADER,
  requestVisitor,
} from './ssr-visitor';

describe('requestVisitor', () => {
  const ssrHeaders = {
    'user-agent': 'node',
    [SSR_VISITOR_IP_HEADER]: '203.0.113.7',
    [SSR_VISITOR_UA_HEADER]: 'Mozilla/5.0 (compatible; YandexBot/3.0)',
  };

  it('names the visitor an SSR fetch was made for', () => {
    expect(requestVisitor({ ip: '172.18.0.7', headers: ssrHeaders })).toEqual({
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (compatible; YandexBot/3.0)',
      viaSsr: true,
    });
  });

  it('ignores the headers from outside the Docker network', () => {
    expect(requestVisitor({ ip: '198.51.100.1', headers: ssrHeaders })).toEqual(
      { ip: '198.51.100.1', userAgent: 'node', viaSsr: false },
    );
  });

  it('ignores a header that is not an address', () => {
    expect(
      requestVisitor({
        ip: '172.18.0.7',
        headers: { 'user-agent': 'node', [SSR_VISITOR_IP_HEADER]: 'x; drop' },
      }),
    ).toEqual({ ip: '172.18.0.7', userAgent: 'node', viaSsr: false });
  });

  it('keeps the peer when there are no headers', () => {
    expect(requestVisitor({ ip: '10.0.0.1' })).toEqual({
      ip: '10.0.0.1',
      userAgent: undefined,
      viaSsr: false,
    });
  });

  it('accepts IPv6 and bounds the user agent', () => {
    const visitor = requestVisitor({
      ip: '::1',
      headers: {
        [SSR_VISITOR_IP_HEADER]: '2001:db8::1',
        [SSR_VISITOR_UA_HEADER]: 'x'.repeat(1000),
      },
    });
    expect(visitor.ip).toBe('2001:db8::1');
    expect(visitor.userAgent).toHaveLength(300);
  });
});
