-- Cache normalized Open Food Facts product records so repeated scans do not call
-- the upstream provider. Records are refreshed according to their updatedAt date.
CREATE TABLE "FoodProductCache" (
    "barcode" TEXT NOT NULL,
    "product" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodProductCache_pkey" PRIMARY KEY ("barcode")
);

CREATE INDEX "FoodProductCache_updatedAt_idx" ON "FoodProductCache"("updatedAt");
