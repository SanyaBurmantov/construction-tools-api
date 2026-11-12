// Runs INSIDE the API container: writes description + seoDescription of each
// category through the admin PATCH (the admin form's own path) and prints the
// previous values — keep that output, it is the rollback file (same script).
// node /tmp/cep-cat-apply.js texts.json   (texts = [{id, slug, description, seoDescription}])
const items = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
(async () => {
  const previous = []; const failed = []; let ok = 0;
  for (const t of items) {
    const before = await fetch(`http://localhost:8000/categories/${t.slug}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!before || before.id !== t.id) { failed.push({ id: t.id, slug: t.slug, why: 'category not found by slug' }); continue; }
    const r = await fetch(`http://localhost:8000/admin/categories/${t.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-admin-token': process.env.ADMIN_TOKEN },
      body: JSON.stringify({ description: t.description, seoDescription: t.seoDescription }),
    });
    if (r.ok) { ok++; previous.push({ id: t.id, slug: t.slug, description: before.description, seoDescription: before.seoDescription }); }
    else failed.push({ id: t.id, slug: t.slug, status: r.status, body: (await r.text()).slice(0, 200) });
  }
  console.log(JSON.stringify({ written: ok, of: items.length, failed, previous }));
})();
