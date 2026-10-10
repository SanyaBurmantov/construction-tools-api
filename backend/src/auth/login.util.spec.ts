import { loginProblem, normalizeLogin } from './login.util';

describe('normalizeLogin', () => {
  it('trims and lowercases, so one account cannot become two', () => {
    expect(normalizeLogin('  Admin ')).toBe('admin');
    expect(normalizeLogin('Shop@Example.COM')).toBe('shop@example.com');
  });
});

describe('loginProblem', () => {
  it('accepts a plain login and an e-mail', () => {
    expect(loginProblem('ivanov')).toBeNull();
    expect(loginProblem('ivanov.petrov+1@mail.by')).toBeNull();
  });

  it('rejects too short, too long and odd characters', () => {
    expect(loginProblem('ab')).not.toBeNull();
    expect(loginProblem('a'.repeat(65))).not.toBeNull();
    expect(loginProblem('иванов')).not.toBeNull();
    expect(loginProblem('with space')).not.toBeNull();
  });
});
