// Runs INSIDE the API container (docker exec construction-tools-api node /tmp/cep-check.js cards.json texts.json):
// the site's own checks on each written text, from the deployed code —
//   validateAnswer (invented numbers/codes, claims, contacts, mixed alphabets, length),
//   uniqueness against the supplier text (stems, 4-word shingles),
//   the detector's «written by a model» probability (detector container).
// Prints one JSON report; writes nothing.
const fs = require('fs');
const { validateAnswer } = require('/backend/dist/ai/ai-validate.js');
const { uniqueness } = require('/backend/dist/ai-detector/uniqueness.js');
const MIN_UNIQUE = 50;      // hard: the site refuses below it
const HUMANIZE_AT = 0.8;    // detector probability that asks for a rewrite pass
// Word starts only: «карданный» is not «данный» (\b does not work for Cyrillic in JS).
const STOCK = /(?<![\p{L}])(?:предназначен|обеспечива|позволя|идеально|отлично подход|незаменим|широк(?:ий|ого) (?:спектр|диапазон)|высокое качество|надежн|надёжн|долговечн|удобств|эффективн|оптимальн|благодаря|является|данн(?:ый|ая|ое|ого)(?![\p{L}])|вариант|линейк)/iu;

const cards = new Map(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).map((c) => [c.id, c]));
const texts = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

(async () => {
  const rows = [];
  for (const t of texts) {
    const c = cards.get(t.id);
    if (!c) { rows.push({ id: t.id, verdict: 'unknown-id' }); continue; }
    const specs = Object.entries(c.specs ?? {}).map(([k, v]) => `${k}: ${v}`);
    const source = [c.name, c.brand, c.category, c.sku, c.supplierShort, c.supplierDescription, ...specs].filter(Boolean).join('\n');
    const rejected = validateAnswer({ entity: 'PRODUCT', oldName: c.name, brand: c.brand, thin: false, source },
      { descriptionShort: t.descriptionShort, descriptionFull: t.descriptionFull });
    const ref = [c.supplierShort, c.supplierDescription].filter(Boolean).map((text) => ({ text, meta: {} }));
    const u = {};
    for (const f of ['descriptionShort', 'descriptionFull']) {
      u[f] = uniqueness(t[f] ?? '', ref).percent;
      if (u[f] !== null && u[f] < MIN_UNIQUE) rejected[f] = `уникальность ${u[f]}%`;
      const stock = (t[f] ?? '').match(STOCK);
      if (stock) rejected[f] = (rejected[f] ? rejected[f] + '; ' : '') + `штамп «${stock[0]}»`;
    }
    rows.push({ id: t.id, name: c.name, rejected, uShort: u.descriptionShort, uFull: u.descriptionFull });
  }
  // Detector: the container takes at most 32 texts a request (server.py MAX_BATCH).
  if (process.env.DETECTOR_URL) {
    const list = texts.flatMap((t) => [t.descriptionShort ?? '', t.descriptionFull ?? '']);
    const scores = [];
    for (let i = 0; i < list.length; i += 32) {
      const r = await fetch(`${process.env.DETECTOR_URL}/analyze/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(process.env.DETECTOR_TOKEN ? { Authorization: `Bearer ${process.env.DETECTOR_TOKEN}` } : {}) },
        body: JSON.stringify({ texts: list.slice(i, i + 32).map((t) => t || '-') }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(j.results)) throw new Error(`detector ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
      scores.push(...j.results.map((x) => x.probability));
    }
    rows.forEach((row, i) => { row.aiShort = scores[2 * i] ?? null; row.aiFull = scores[2 * i + 1] ?? null; });
  }
  for (const row of rows) {
    if (row.verdict) continue;
    row.verdict = Object.keys(row.rejected).length ? 'fail'
      : (row.aiFull ?? 0) >= HUMANIZE_AT || (row.aiShort ?? 0) >= HUMANIZE_AT ? 'humanize' : 'pass';
  }
  const count = (v) => rows.filter((r) => r.verdict === v).length;
  console.log(JSON.stringify({ total: rows.length, pass: count('pass'), humanize: count('humanize'), fail: count('fail'), rows }));
})();
