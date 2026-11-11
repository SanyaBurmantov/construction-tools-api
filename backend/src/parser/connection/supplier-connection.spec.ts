import {
  BLOCKED_AFTER_FAILURES,
  ConnectionOutcome,
  RouteSnapshot,
  applyOutcome,
  chooseRoute,
  classifyStatus,
  emptySnapshot,
  maskProxyUrl,
  normalizeProxyUrl,
  sourceForUrl,
} from './supplier-connection';

const unreachable: ConnectionOutcome = {
  kind: 'unreachable',
  error: 'connect ETIMEDOUT',
};
const t = (minute: number) => new Date(Date.UTC(2026, 10, 11, 7, minute));

function failTimes(n: number, start = emptySnapshot()) {
  let s = start;
  for (let i = 0; i < n; i++) s = applyOutcome(s, unreachable, t(i));
  return s;
}

describe('connection state', () => {
  it('is unknown before the first request', () => {
    expect(emptySnapshot().state).toBe('UNKNOWN');
  });

  it('calls a route degraded on the first failures and blocked after five in a row', () => {
    expect(failTimes(1).state).toBe('DEGRADED');
    expect(failTimes(BLOCKED_AFTER_FAILURES - 1).state).toBe('DEGRADED');
    const blocked = failTimes(BLOCKED_AFTER_FAILURES);
    expect(blocked.state).toBe('BLOCKED');
    expect(blocked.failureKind).toBe('UNREACHABLE');
    expect(blocked.blockedSince).toEqual(t(BLOCKED_AFTER_FAILURES - 1));
  });

  it('keeps the moment the block began while failures continue', () => {
    const later = failTimes(3, failTimes(BLOCKED_AFTER_FAILURES));
    expect(later.blockedSince).toEqual(t(BLOCKED_AFTER_FAILURES - 1));
    expect(later.consecutiveFailures).toBe(BLOCKED_AFTER_FAILURES + 3);
  });

  it('one answer clears a block', () => {
    const ok = applyOutcome(
      failTimes(9),
      { kind: 'ok', status: 200, ms: 80 },
      t(30),
    );
    expect(ok).toMatchObject({
      state: 'OK',
      consecutiveFailures: 0,
      blockedSince: null,
      failureKind: null,
      lastOkAt: t(30),
      lastMs: 80,
    });
    // The last error stays on record for the screen.
    expect(ok.lastError).toContain('ETIMEDOUT');
  });

  it('a 404 is the site answering, 403 and 429 are a refusal', () => {
    expect(classifyStatus(200)).toBe('ok');
    expect(classifyStatus(404)).toBe('ok');
    expect(classifyStatus(500)).toBe('ok');
    expect(classifyStatus(403)).toBe('denied');
    expect(classifyStatus(429)).toBe('denied');
    let s: RouteSnapshot = emptySnapshot();
    for (let i = 0; i < BLOCKED_AFTER_FAILURES; i++) {
      s = applyOutcome(s, { kind: 'denied', status: 403 }, t(i));
    }
    expect(s).toMatchObject({
      state: 'BLOCKED',
      failureKind: 'DENIED',
      lastError: 'HTTP 403',
      lastStatus: 403,
    });
  });
});

describe('route choice', () => {
  const blocked = failTimes(BLOCKED_AFTER_FAILURES);
  const ok = applyOutcome(emptySnapshot(), { kind: 'ok', status: 200 }, t(0));

  it('goes direct without a proxy whatever the mode', () => {
    expect(chooseRoute('always', false, blocked)).toBe('DIRECT');
    expect(chooseRoute('auto', false, blocked)).toBe('DIRECT');
  });

  it('auto uses the proxy only while direct is blocked', () => {
    expect(chooseRoute('auto', true, ok)).toBe('DIRECT');
    expect(chooseRoute('auto', true, failTimes(2))).toBe('DIRECT');
    expect(chooseRoute('auto', true, blocked)).toBe('PROXY');
  });

  it('always and off do what they say', () => {
    expect(chooseRoute('always', true, ok)).toBe('PROXY');
    expect(chooseRoute('off', true, blocked)).toBe('DIRECT');
  });
});

describe('source of a URL', () => {
  const sources = [
    { code: 'th-tools', host: 'th-tool.by' },
    { code: 'tools-by', host: 'tools.by' },
  ];

  it('matches the host, www and subdomains, not look-alikes', () => {
    expect(sourceForUrl('https://th-tool.by/x/', sources)?.code).toBe(
      'th-tools',
    );
    expect(sourceForUrl('https://www.tools.by/p/1', sources)?.code).toBe(
      'tools-by',
    );
    expect(sourceForUrl('https://content.tools.by/a.jpg', sources)?.code).toBe(
      'tools-by',
    );
    // th-tool.by ends in "tool.by", not in ".tools.by".
    expect(sourceForUrl('https://eviltools.by/', sources)).toBeUndefined();
    expect(sourceForUrl('https://api.telegram.org/', sources)).toBeUndefined();
    expect(sourceForUrl('not a url', sources)).toBeUndefined();
  });
});

describe('proxy address', () => {
  it('accepts an HTTP(S) proxy with credentials', () => {
    expect(normalizeProxyUrl(' http://user:p%40ss@1.2.3.4:8000 ')).toBe(
      'http://user:p%40ss@1.2.3.4:8000',
    );
    expect(normalizeProxyUrl('https://proxy.example:443/')).toBe(
      'https://proxy.example',
    );
  });

  it('refuses what undici cannot use', () => {
    expect(() => normalizeProxyUrl('socks5://1.2.3.4:1080')).toThrow(/HTTP/);
    expect(() => normalizeProxyUrl('1.2.3.4:8000')).toThrow();
    expect(() => normalizeProxyUrl('http://1.2.3.4:8000/path')).toThrow();
  });

  it('never shows the password', () => {
    expect(maskProxyUrl('http://user:secret@1.2.3.4:8000')).toBe(
      'http://user:***@1.2.3.4:8000',
    );
    expect(maskProxyUrl('http://1.2.3.4:8000')).toBe('http://1.2.3.4:8000');
    expect(maskProxyUrl(null)).toBeNull();
  });
});
