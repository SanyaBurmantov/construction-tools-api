-- The seller requisites printed on an order's invoice, frozen at first issue.
ALTER TABLE "Order" ADD COLUMN "sellerSnapshot" JSONB;
