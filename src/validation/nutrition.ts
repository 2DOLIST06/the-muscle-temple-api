import { FoodSourceType, MealType, NutritionUnit } from '@prisma/client';
import { z } from 'zod';

const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export const calendarDateSchema = z.string().regex(calendarDatePattern, 'La date doit utiliser le format YYYY-MM-DD.').refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'La date de calendrier est invalide.');

const nonNegativeNutritionValue = z.number().finite().nonnegative();
const positiveAmount = z.number().finite().positive();

export const nutritionDateQuerySchema = z.object({ date: calendarDateSchema }).strict();

export const nutritionGoalSchema = z.object({
  effectiveFrom: calendarDateSchema,
  caloriesKcal: nonNegativeNutritionValue,
  proteinG: nonNegativeNutritionValue,
  carbohydratesG: nonNegativeNutritionValue,
  fatG: nonNegativeNutritionValue
}).strict();

export const personalFoodCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().min(1).max(200).nullable().optional(),
  basisAmount: positiveAmount,
  basisUnit: z.nativeEnum(NutritionUnit),
  caloriesKcal: nonNegativeNutritionValue,
  proteinG: nonNegativeNutritionValue,
  carbohydratesG: nonNegativeNutritionValue,
  fatG: nonNegativeNutritionValue
}).strict();

export const personalFoodPatchSchema = personalFoodCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Au moins un champ doit être fourni.'
);

export const nutritionIdParamSchema = z.object({ id: z.string().trim().min(1) }).strict();

const diaryEntryBase = {
  date: calendarDateSchema,
  mealType: z.nativeEnum(MealType),
  consumedAmount: positiveAmount
};

export const diaryEntryCreateSchema = z.discriminatedUnion('sourceType', [
  z.object({
    ...diaryEntryBase,
    sourceType: z.literal(FoodSourceType.OPEN_FOOD_FACTS),
    barcode: z.string()
  }).strict(),
  z.object({
    ...diaryEntryBase,
    sourceType: z.literal(FoodSourceType.PERSONAL),
    personalFoodId: z.string().trim().min(1)
  }).strict()
]);

export const diaryEntryPatchSchema = z.object({
  mealType: z.nativeEnum(MealType).optional(),
  consumedAmount: positiveAmount.optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'Au moins un champ doit être fourni.');
