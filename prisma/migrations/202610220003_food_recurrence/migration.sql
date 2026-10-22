CREATE TABLE "FoodRecurrence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "weekdays" INTEGER[] NOT NULL,
  "template" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FoodRecurrence_userId_startDate_idx" ON "FoodRecurrence"("userId", "startDate");
ALTER TABLE "FoodEntry" ADD COLUMN "recurrenceId" TEXT REFERENCES "FoodRecurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "FoodEntry_recurrenceId_nutritionDayId_key" ON "FoodEntry"("recurrenceId", "nutritionDayId");
