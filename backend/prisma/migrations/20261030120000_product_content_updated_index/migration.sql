-- The relations worker picks up products whose text changed (AI, admin,
-- supplier) every 30 s; the sitemap orders by it too.
CREATE INDEX "Product_contentUpdatedAt_idx" ON "Product"("contentUpdatedAt");
