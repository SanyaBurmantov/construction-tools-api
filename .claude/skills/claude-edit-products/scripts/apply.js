// Runs INSIDE the API container: writes descriptions through the admin product
// PATCH — the same path as the admin form: the changed fields join lockedFields
// (the daily re-parse will not put the supplier text back), contentUpdatedAt
// moves (sitemap lastmod), the page is queued for IndexNow, the audit log keeps
// the request. The same script with the rollback file restores the old texts.
// node /tmp/cep-apply.js texts.json   (texts = [{id, descriptionShort, descriptionFull}])
const items = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
(async () => {
  let ok = 0; const failed = [];
  for (const t of items) {
    const r = await fetch(`http://localhost:8000/admin/products/${t.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-admin-token': process.env.ADMIN_TOKEN },
      body: JSON.stringify({ descriptionShort: t.descriptionShort, descriptionFull: t.descriptionFull }),
    });
    if (r.ok) ok++; else failed.push({ id: t.id, status: r.status, body: (await r.text()).slice(0, 200) });
  }
  console.log(JSON.stringify({ written: ok, of: items.length, failed }));
})();
