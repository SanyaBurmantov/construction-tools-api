// Google URL Inspection for a list of slugs; key read from the memory file (never copied elsewhere).
import fs from 'node:fs';
import crypto from 'node:crypto';
const mem = fs.readFileSync(process.env.GSC_MEMORY /* the memory file gsc-service-account.md — the key never goes into git */, 'utf8');
const key = JSON.parse(mem.match(/```json\n([\s\S]*?)\n```/)[1]);
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/webmasters', aud: key.token_uri, iat: now, exp: now + 3600 })}`;
const jwt = `${unsigned}.${crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url')}`;
const tok = await (await fetch(key.token_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}` })).json();
if (!tok.access_token) { console.error(tok); process.exit(1); }
const groups = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const items = [...groups.treated.map((x) => ({ ...x, group: 'treated' })), ...groups.control.map((x) => ({ ...x, group: 'control' }))];
const out = [];
let i = 0;
async function worker() {
  while (i < items.length) {
    const it = items[i++];
    const url = `https://gost.by/product/${it.slug}`;
    const r = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST', headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ inspectionUrl: url, siteUrl: 'sc-domain:gost.by', languageCode: 'ru' }),
    });
    const j = await r.json();
    const s = j.inspectionResult?.indexStatusResult ?? {};
    out.push({ ...it, url, http: r.status, verdict: s.verdict ?? null, coverage: s.coverageState ?? j.error?.message ?? null, lastCrawl: s.lastCrawlTime ?? null });
  }
}
await Promise.all(Array.from({ length: 5 }, worker));
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
const sum = (g) => { const a = out.filter((o) => o.group === g); const c = {}; for (const o of a) c[o.coverage] = (c[o.coverage] ?? 0) + 1; return { n: a.length, ...c }; };
console.log(JSON.stringify({ treated: sum('treated'), control: sum('control') }, null, 1));
