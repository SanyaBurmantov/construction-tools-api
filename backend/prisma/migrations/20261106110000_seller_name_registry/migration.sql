-- 06.11.2026: the seller's name as the tax registry spells it («МультиТул»,
-- grp.nalog.gov.by for УНП 391807521). Only the old spelling is replaced, so a
-- name an admin typed in /admin/settings stays as typed. Data only.
UPDATE "SiteSetting"
SET "value" = 'ООО «МультиТул»', "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'seller.name' AND "value" = 'ООО «Мультитул»';
