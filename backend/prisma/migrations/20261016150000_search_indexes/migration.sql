
-- CreateIndex
CREATE INDEX "Brand_name_idx" ON "Brand" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Product_model_idx" ON "Product" USING GIN ("model" gin_trgm_ops);

