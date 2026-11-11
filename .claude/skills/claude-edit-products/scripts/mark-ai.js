// Runs INSIDE the API container, after apply.js: marks the written
// descriptions as AI-written — adds descriptionShort/descriptionFull to
// Product.aiLockedFields. That is what the site reads as «изменено ИИ»: the
// plans' «Карточек с ИИ-текстами» counts it, the assistant's autopilot and the
// «ИИ не писал поле» filter skip the card (so DeepSeek never rewrites Claude's
// text), and the re-parse keeps its hands off as with any AI field.
// node /tmp/cep-mark-ai.js texts.json   (the same file apply.js wrote)
const { PrismaClient } = require('/backend/node_modules/@prisma/client');
const FIELDS = ['descriptionShort', 'descriptionFull'];
const ids = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8')).map((t) => t.id);
(async () => {
  const prisma = new PrismaClient();
  const marked = await prisma.$executeRaw`
    UPDATE "Product"
       SET "aiLockedFields" = ARRAY(SELECT DISTINCT unnest("aiLockedFields" || ${FIELDS}::text[]))
     WHERE id = ANY(${ids}::text[])`;
  console.log(JSON.stringify({ marked, of: ids.length }));
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
