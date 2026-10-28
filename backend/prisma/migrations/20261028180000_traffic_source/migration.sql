-- Where an order or a lead came from (attribution/traffic-source.ts).
ALTER TABLE "Order" ADD COLUMN "trafficSource" TEXT,
                    ADD COLUMN "firstTrafficSource" TEXT,
                    ADD COLUMN "attribution" JSONB;
CREATE INDEX "Order_trafficSource_createdAt_idx" ON "Order"("trafficSource", "createdAt");

ALTER TABLE "Lead" ADD COLUMN "trafficSource" TEXT,
                   ADD COLUMN "firstTrafficSource" TEXT,
                   ADD COLUMN "attribution" JSONB;
