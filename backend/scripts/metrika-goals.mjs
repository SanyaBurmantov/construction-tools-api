#!/usr/bin/env node
/**
 * Creates the Metrika goals the storefront fires (`frontend/app/utils/metrika.ts`)
 * — «JavaScript-событие» goals keyed by identifier. Idempotent: a goal whose
 * identifier already exists is left alone, so it can be re-run after adding a
 * new event.
 *
 *   METRIKA_TOKEN=… node scripts/metrika-goals.mjs [--dry-run]
 *
 * The token needs `metrika:write` («Создание счётчиков, изменение параметров
 * своих и доверенных счётчиков»). Counter: METRIKA_COUNTER_ID or 113800110.
 */
const token = process.env.METRIKA_TOKEN;
const counter = process.env.METRIKA_COUNTER_ID || '113800110';
const dryRun = process.argv.includes('--dry-run');

/** Same ids as `MetrikaGoal`; the order is the order Metrika lists them. */
const GOALS = [
  ['order', 'Заказ оформлен'],
  ['order_invoice', 'Заказ по счёту (юрлицо)'],
  ['lead', 'Заявка менеджеру'],
  ['quote', 'Скачал коммерческое предложение'],
  ['price_list', 'Скачал прайс-лист'],
  ['register_company', 'Регистрация юрлица'],
  ['register', 'Регистрация'],
  ['checkout', 'Начал оформление заказа'],
  ['add_to_cart', 'Добавил в корзину'],
  ['phone_click', 'Клик по телефону'],
  ['messenger_click', 'Клик по мессенджеру'],
];

if (!token) {
  console.error('METRIKA_TOKEN is not set');
  process.exit(1);
}

const api = `https://api-metrika.yandex.net/management/v1/counter/${counter}/goals`;
const headers = { Authorization: `OAuth ${token}`, 'Content-Type': 'application/json' };

const existing = await fetch(api, { headers }).then(async (res) => {
  const body = await res.json();
  if (!res.ok) throw new Error(`list goals: ${res.status} ${body.message ?? ''}`);
  return body.goals ?? [];
});
const known = new Set(
  existing
    .filter((g) => g.type === 'action')
    .flatMap((g) => (g.conditions ?? []).map((c) => c.url)),
);

for (const [id, name] of GOALS) {
  if (known.has(id)) {
    console.log(`= ${id} (есть)`);
    continue;
  }
  if (dryRun) {
    console.log(`+ ${id} «${name}» (dry run)`);
    continue;
  }
  const res = await fetch(api, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      goal: { name, type: 'action', conditions: [{ type: 'exact', url: id }] },
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`! ${id}: ${res.status} ${body.message ?? ''}`);
    process.exitCode = 1;
    continue;
  }
  console.log(`+ ${id} «${name}» → goal ${body.goal?.id}`);
}
