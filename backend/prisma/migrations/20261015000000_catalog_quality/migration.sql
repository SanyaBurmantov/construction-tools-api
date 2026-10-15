-- Catalogue hygiene from the content audit. Data only, no schema change.

-- 1. The parsers' fallback category «Неразобранные товары поставщиков» is a
--    work queue, not a department. New rows are created with
--    isVisible = false (see FALLBACK_CATEGORY_SLUG); this hides the one that
--    already exists. Its URL and its products' URLs keep working.
UPDATE "Category"
SET "isVisible" = false
WHERE "slug" = 'unmapped-supplier-products';

-- 2. Weight and overall dimensions stop being catalogue filters by default
--    («Вес», «Вес, кг», «Вес с упаковкой, кг», «Габариты (ДхШхВ), см» …).
--    Mirrors isOffByDefaultSpec() in src/parser/spec-filterable.ts, which
--    governs new rows; this is the one-off for existing ones. A one-off on
--    purpose: an admin may switch any of them back on in
--    /admin/specifications, and nothing re-runs this to undo that.
--    Letters are spelled in both cases because the database's ctype may not
--    fold Cyrillic.
UPDATE "Specification"
SET "filterable" = false
WHERE "filterable" = true
  AND (
    concat_ws(' | ', "name", "canonicalName")
      ~ '(^|[^А-Яа-яЁёA-Za-z])([Вв][Ее][Сс]|[Мм][Аа][Сс][Сс][Аа])([^А-Яа-яЁёA-Za-z]|$)'
    OR concat_ws(' | ', "name", "canonicalName")
      ~ '[Гг][Аа][Бб][Аа][Рр][Ии][Тт]|[Рр][Аа][Зз][Мм][Ее][Рр][ЫыАа]? [Уу][Пп][Аа][Кк][Оо][Вв][Кк][Ии]|(^|[^А-Яа-яЁёA-Za-z])[Дд] *[xXхХ×*] *[Шш] *[xXхХ×*] *[Вв]'
  );
