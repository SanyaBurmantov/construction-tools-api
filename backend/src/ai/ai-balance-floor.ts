// Pure: the spend-cap value and the balance it is compared with. Kept apart
// from the service and the crons that use it — the service importing these
// from ai-runner.cron.ts while the cron imported the service was a cycle that
// left AiRunnerCron's third dependency undefined at boot (2026-11-12).

/**
 * The balance floor under which the runner stops — the spend cap of a run is
 * «balance at the start minus what we agreed to spend». «36.4» or
 * «36.4 CNY»; empty or unreadable means no floor. Where it is set:
 * `AiBalanceFloorService` (/admin/ai, then `AI_MIN_BALANCE`).
 */
export function parseBalanceFloor(raw: string | undefined) {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*([A-Za-z]{3})?\s*$/.exec(raw ?? '');
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  if (!(amount > 0)) return null;
  return { amount, currency: match[2]?.toUpperCase() ?? null };
}

/**
 * The balance a floor is compared with: the named currency, or — with none
 * named — the one the account actually holds (the largest). DeepSeek lists
 * CNY and USD side by side; adding them up compared yuan with dollars.
 */
export function balanceFor(
  balances: Record<string, number> | null,
  currency: string | null,
) {
  if (!balances) return null;
  if (currency) return balances[currency] ?? null;
  const amounts = Object.values(balances);
  return amounts.length ? Math.max(...amounts) : null;
}
