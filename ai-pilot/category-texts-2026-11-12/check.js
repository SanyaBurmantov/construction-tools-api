// Runs INSIDE the API container: the site's own validateAnswer on each
// category text (numbers/codes not in the source, claims, contacts, markup,
// length, «безнал» in the SEO description). Writes nothing.
// node /tmp/cep-cat-check.js cards.json final.json
const fs = require('fs');
const { validateAnswer } = require('/backend/dist/ai/ai-validate.js');
const cards = new Map(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).map((c) => [c.id, c]));
const texts = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const rows = [];
for (const t of texts) {
  const c = cards.get(t.id);
  if (!c) { rows.push({ id: t.id, rejected: { id: 'unknown' } }); continue; }
  const source = [c.name, c.path, ...c.subcategories, ...c.sampleProducts, ...c.brands, ...c.commonSpecs].filter(Boolean).join('\n');
  const rejected = validateAnswer({ entity: 'CATEGORY', oldName: c.name, thin: false, source },
    { description: t.description, seoDescription: t.seoDescription });
  if (Object.keys(rejected).length) rows.push({ id: t.id, slug: t.slug, rejected });
}
console.log(JSON.stringify({ total: texts.length, pass: texts.length - rows.length, fail: rows.length, rows }));
