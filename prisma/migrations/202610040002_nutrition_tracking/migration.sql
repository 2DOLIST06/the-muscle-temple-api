-- CreateEnum
CREATE TYPE "NutritionUnit" AS ENUM ('G', 'ML');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'SNACK', 'DINNER');

-- CreateEnum
CREATE TYPE "FoodSourceType" AS ENUM ('OPEN_FOOD_FACTS', 'PERSONAL');

-- CreateTable
CREATE TABLE "NutritionGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "caloriesKcal" DECIMAL(18,6) NOT NULL,
    "proteinG" DECIMAL(18,6) NOT NULL,
    "carbohydratesG" DECIMAL(18,6) NOT NULL,
    "fatG" DECIMAL(18,6) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NutritionGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalFood" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "basisAmount" DECIMAL(18,6) NOT NULL,
    "basisUnit" "NutritionUnit" NOT NULL,
    "caloriesKcal" DECIMAL(18,6) NOT NULL,
    "proteinG" DECIMAL(18,6) NOT NULL,
    "carbohydratesG" DECIMAL(18,6) NOT NULL,
    "fatG" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PersonalFood_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NutritionDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NutritionDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodEntry" (
    "id" TEXT NOT NULL,
    "nutritionDayId" TEXT NOT NULL,
    "mealType" "MealType" NOT NULL,
    "sourceType" "FoodSourceType" NOT NULL,
    "productBarcode" TEXT,
    "personalFoodId" TEXT,
    "consumedAmount" DECIMAL(18,6) NOT NULL,
    "consumedUnit" "NutritionUnit" NOT NULL,
    "snapshotName" TEXT NOT NULL,
    "snapshotBrand" TEXT,
    "snapshotBasisAmount" DECIMAL(18,6) NOT NULL,
    "snapshotBasisUnit" "NutritionUnit" NOT NULL,
    "snapshotCaloriesKcal" DECIMAL(18,6) NOT NULL,
    "snapshotProteinG" DECIMAL(18,6) NOT NULL,
    "snapshotCarbohydratesG" DECIMAL(18,6) NOT NULL,
    "snapshotFatG" DECIMAL(18,6) NOT NULL,
    "computedCaloriesKcal" DECIMAL(18,6) NOT NULL,
    "computedProteinG" DECIMAL(18,6) NOT NULL,
    "computedCarbohydratesG" DECIMAL(18,6) NOT NULL,
    "computedFatG" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FoodEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NutritionGoal_userId_effectiveFrom_key" ON "NutritionGoal"("userId", "effectiveFrom");
CREATE INDEX "NutritionGoal_userId_effectiveFrom_idx" ON "NutritionGoal"("userId", "effectiveFrom");
CREATE INDEX "PersonalFood_userId_createdAt_idx" ON "PersonalFood"("userId", "createdAt");
CREATE UNIQUE INDEX "NutritionDay_userId_date_key" ON "NutritionDay"("userId", "date");
CREATE INDEX "NutritionDay_userId_date_idx" ON "NutritionDay"("userId", "date");
CREATE INDEX "FoodEntry_nutritionDayId_mealType_idx" ON "FoodEntry"("nutritionDayId", "mealType");
CREATE INDEX "FoodEntry_personalFoodId_idx" ON "FoodEntry"("personalFoodId");
CREATE INDEX "FoodEntry_productBarcode_idx" ON "FoodEntry"("productBarcode");

-- AddForeignKey
ALTER TABLE "NutritionGoal" ADD CONSTRAINT "NutritionGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalFood" ADD CONSTRAINT "PersonalFood_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NutritionDay" ADD CONSTRAINT "NutritionDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FoodEntry" ADD CONSTRAINT "FoodEntry_nutritionDayId_fkey" FOREIGN KEY ("nutritionDayId") REFERENCES "NutritionDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FoodEntry" ADD CONSTRAINT "FoodEntry_personalFoodId_fkey" FOREIGN KEY ("personalFoodId") REFERENCES "PersonalFood"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddCheckConstraints
ALTER TABLE "NutritionGoal" ADD CONSTRAINT "NutritionGoal_nonnegative_macros_check" CHECK (
  "caloriesKcal" >= 0 AND "proteinG" >= 0 AND "carbohydratesG" >= 0 AND "fatG" >= 0
);
ALTER TABLE "PersonalFood" ADD CONSTRAINT "PersonalFood_valid_nutrition_check" CHECK (
  "basisAmount" > 0 AND "caloriesKcal" >= 0 AND "proteinG" >= 0 AND "carbohydratesG" >= 0 AND "fatG" >= 0
);
ALTER TABLE "FoodEntry" ADD CONSTRAINT "FoodEntry_valid_amounts_check" CHECK (
  "consumedAmount" > 0 AND "snapshotBasisAmount" > 0
  AND "snapshotCaloriesKcal" >= 0 AND "snapshotProteinG" >= 0
  AND "snapshotCarbohydratesG" >= 0 AND "snapshotFatG" >= 0
);
ALTER TABLE "FoodEntry" ADD CONSTRAINT "FoodEntry_source_reference_check" CHECK (
  ("sourceType" = 'OPEN_FOOD_FACTS' AND "productBarcode" IS NOT NULL AND "personalFoodId" IS NULL)
  OR ("sourceType" = 'PERSONAL' AND "productBarcode" IS NULL)
);
