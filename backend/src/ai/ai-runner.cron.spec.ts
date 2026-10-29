import { balanceFor, parseBalanceFloor } from './ai-runner.cron';

describe('AI spend floor', () => {
  it('reads «36.4» and «36,4 cny»', () => {
    expect(parseBalanceFloor('36.4')).toEqual({ amount: 36.4, currency: null });
    expect(parseBalanceFloor(' 36,4 cny ')).toEqual({
      amount: 36.4,
      currency: 'CNY',
    });
    expect(parseBalanceFloor('')).toBeNull();
    expect(parseBalanceFloor('много')).toBeNull();
    expect(parseBalanceFloor('0')).toBeNull();
  });

  it('compares with one currency, never a sum of yuan and dollars', () => {
    const balances = { CNY: 39.97, USD: 5 };
    expect(balanceFor(balances, 'CNY')).toBe(39.97);
    expect(balanceFor(balances, 'USD')).toBe(5);
    expect(balanceFor(balances, null)).toBe(39.97);
    expect(balanceFor(balances, 'EUR')).toBeNull();
    expect(balanceFor(null, null)).toBeNull();
  });
});
