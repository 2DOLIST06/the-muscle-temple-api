import { FoodSourceType, MealType, NutritionUnit, Prisma } from '@prisma/client';
import { FastifyPluginAsync } from 'fastify';
import { env } from '../../config/env.js';
import { requireUserAuth } from '../../lib/auth.js';
import { FoodProductCacheRepository } from '../../lib/food/cache.js';
import {
  FoodDataProviderUnavailableError,
  OpenFoodFactsService,
  ProductNotFoundError
} from '../../lib/food/open-food-facts.js';
import { FoodProduct } from '../../lib/food/types.js';
import { calculateConsumedMacros, decimalNumber, macroNumbers } from '../../lib/nutrition/calculations.js';
import { barcodeParamSchema } from '../../validation/food.js';
import {
  diaryEntryCreateSchema,
  diaryEntryPatchSchema,
  nutritionDateQuerySchema,
  nutritionGoalSchema,
  nutritionIdParamSchema,
  personalFoodCreateSchema,
  personalFoodPatchSchema
} from '../../validation/nutrition.js';

interface ProductLookup {
  getProductByBarcode(barcode: string): Promise<FoodProduct>;
}

export interface NutritionRoutesOptions {
  productLookup?: ProductLookup;
}

type Snapshot = {
  sourceType: FoodSourceType;
  productBarcode: string | null;
  personalFoodId: string | null;
  consumedUnit: NutritionUnit;
  snapshotName: string;
  snapshotBrand: string | null;
  snapshotBasisAmount: Prisma.Decimal.Value;
  snapshotBasisUnit: NutritionUnit;
  snapshotCaloriesKcal: Prisma.Decimal.Value;
  snapshotProteinG: Prisma.Decimal.Value;
  snapshotCarbohydratesG: Prisma.Decimal.Value;
  snapshotFatG: Prisma.Decimal.Value;
};

const essentialMacroKeys = ['caloriesKcal', 'proteinG', 'carbohydratesG', 'fatG'] as const;

function calendarDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function serializeGoal(goal: {
  id: string;
  effectiveFrom: Date;
  caloriesKcal: Prisma.Decimal.Value;
  proteinG: Prisma.Decimal.Value;
  carbohydratesG: Prisma.Decimal.Value;
  fatG: Prisma.Decimal.Value;
  createdAt: Date;
  updatedAt: Date;
} | null) {
  if (!goal) return null;
  return {
    id: goal.id,
    effectiveFrom: dateString(goal.effectiveFrom),
    ...macroNumbers(goal),
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt
  };
}

function serializePersonalFood(food: {
  id: string;
  name: string;
  brand: string | null;
  basisAmount: Prisma.Decimal.Value;
  basisUnit: NutritionUnit;
  caloriesKcal: Prisma.Decimal.Value;
  proteinG: Prisma.Decimal.Value;
  carbohydratesG: Prisma.Decimal.Value;
  fatG: Prisma.Decimal.Value;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...food,
    basisAmount: decimalNumber(food.basisAmount),
    ...macroNumbers(food)
  };
}

function serializeEntry(entry: {
  id: string;
  mealType: MealType;
  sourceType: FoodSourceType;
  productBarcode: string | null;
  personalFoodId: string | null;
  consumedAmount: Prisma.Decimal.Value;
  consumedUnit: NutritionUnit;
  snapshotName: string;
  snapshotBrand: string | null;
  snapshotBasisAmount: Prisma.Decimal.Value;
  snapshotBasisUnit: NutritionUnit;
  snapshotCaloriesKcal: Prisma.Decimal.Value;
  snapshotProteinG: Prisma.Decimal.Value;
  snapshotCarbohydratesG: Prisma.Decimal.Value;
  snapshotFatG: Prisma.Decimal.Value;
  computedCaloriesKcal: Prisma.Decimal.Value;
  computedProteinG: Prisma.Decimal.Value;
  computedCarbohydratesG: Prisma.Decimal.Value;
  computedFatG: Prisma.Decimal.Value;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...entry,
    consumedAmount: decimalNumber(entry.consumedAmount),
    snapshotBasisAmount: decimalNumber(entry.snapshotBasisAmount),
    snapshot: {
      name: entry.snapshotName,
      brand: entry.snapshotBrand,
      basisAmount: decimalNumber(entry.snapshotBasisAmount),
      basisUnit: entry.snapshotBasisUnit,
      ...macroNumbers({
        caloriesKcal: entry.snapshotCaloriesKcal,
        proteinG: entry.snapshotProteinG,
        carbohydratesG: entry.snapshotCarbohydratesG,
        fatG: entry.snapshotFatG
      })
    },
    computed: macroNumbers({
      caloriesKcal: entry.computedCaloriesKcal,
      proteinG: entry.computedProteinG,
      carbohydratesG: entry.computedCarbohydratesG,
      fatG: entry.computedFatG
    }),
    snapshotCaloriesKcal: decimalNumber(entry.snapshotCaloriesKcal),
    snapshotProteinG: decimalNumber(entry.snapshotProteinG),
    snapshotCarbohydratesG: decimalNumber(entry.snapshotCarbohydratesG),
    snapshotFatG: decimalNumber(entry.snapshotFatG),
    computedCaloriesKcal: decimalNumber(entry.computedCaloriesKcal),
    computedProteinG: decimalNumber(entry.computedProteinG),
    computedCarbohydratesG: decimalNumber(entry.computedCarbohydratesG),
    computedFatG: decimalNumber(entry.computedFatG)
  };
}

function buildDefaultProductLookup(fastify: Parameters<FastifyPluginAsync>[0]): ProductLookup {
  const provider = new OpenFoodFactsService(
    env.OPEN_FOOD_FACTS_USER_AGENT,
    env.OPEN_FOOD_FACTS_TIMEOUT_MS,
    fetch,
    (details) => fastify.log.info(details, 'Open Food Facts diagnostic')
  );
  const cache = new FoodProductCacheRepository(
    fastify.prisma,
    env.OPEN_FOOD_FACTS_CACHE_TTL_HOURS * 60 * 60 * 1000
  );
  return {
    async getProductByBarcode(barcode) {
      const cached = await cache.get(barcode);
      if (cached) return cached;
      const product = await provider.getProductByBarcode(barcode);
      await cache.set(product);
      return product;
    }
  };
}

export const nutritionRoutes: FastifyPluginAsync<NutritionRoutesOptions> = async (fastify, options) => {
  const productLookup = options.productLookup ?? buildDefaultProductLookup(fastify);

  fastify.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', requireUserAuth);

    protectedRoutes.get('/nutrition/goals', async (request) => {
      const { date } = nutritionDateQuerySchema.parse(request.query);
      const goal = await fastify.prisma.nutritionGoal.findFirst({
        where: { userId: request.authenticatedUser.userId, effectiveFrom: { lte: calendarDate(date) } },
        orderBy: { effectiveFrom: 'desc' }
      });
      return { data: serializeGoal(goal) };
    });

    protectedRoutes.put('/nutrition/goals', async (request) => {
      const body = nutritionGoalSchema.parse(request.body);
      const userId = request.authenticatedUser.userId;
      const effectiveFrom = calendarDate(body.effectiveFrom);
      const values = {
        caloriesKcal: body.caloriesKcal,
        proteinG: body.proteinG,
        carbohydratesG: body.carbohydratesG,
        fatG: body.fatG
      };
      const goal = await fastify.prisma.nutritionGoal.upsert({
        where: { userId_effectiveFrom: { userId, effectiveFrom } },
        create: { userId, effectiveFrom, ...values },
        update: values
      });
      return { data: serializeGoal(goal) };
    });

    protectedRoutes.get('/nutrition/goals/history', async (request) => {
      const goals = await fastify.prisma.nutritionGoal.findMany({
        where: { userId: request.authenticatedUser.userId },
        orderBy: { effectiveFrom: 'desc' }
      });
      return { data: goals.map(serializeGoal) };
    });

    protectedRoutes.get('/nutrition/personal-foods', async (request) => {
      const foods = await fastify.prisma.personalFood.findMany({
        where: { userId: request.authenticatedUser.userId },
        orderBy: { createdAt: 'desc' }
      });
      return { data: foods.map(serializePersonalFood) };
    });

    protectedRoutes.post('/nutrition/personal-foods', async (request, reply) => {
      const body = personalFoodCreateSchema.parse(request.body);
      const food = await fastify.prisma.personalFood.create({
        data: { ...body, brand: body.brand ?? null, userId: request.authenticatedUser.userId }
      });
      return reply.code(201).send({ data: serializePersonalFood(food) });
    });

    protectedRoutes.get('/nutrition/personal-foods/:id', async (request, reply) => {
      const { id } = nutritionIdParamSchema.parse(request.params);
      const food = await fastify.prisma.personalFood.findFirst({
        where: { id, userId: request.authenticatedUser.userId }
      });
      if (!food) return reply.code(404).send({ message: 'Personal food not found' });
      return { data: serializePersonalFood(food) };
    });

    protectedRoutes.patch('/nutrition/personal-foods/:id', async (request, reply) => {
      const { id } = nutritionIdParamSchema.parse(request.params);
      const body = personalFoodPatchSchema.parse(request.body);
      const result = await fastify.prisma.personalFood.updateMany({
        where: { id, userId: request.authenticatedUser.userId },
        data: body
      });
      if (result.count === 0) return reply.code(404).send({ message: 'Personal food not found' });
      const food = await fastify.prisma.personalFood.findFirstOrThrow({
        where: { id, userId: request.authenticatedUser.userId }
      });
      return { data: serializePersonalFood(food) };
    });

    protectedRoutes.delete('/nutrition/personal-foods/:id', async (request, reply) => {
      const { id } = nutritionIdParamSchema.parse(request.params);
      const result = await fastify.prisma.personalFood.deleteMany({
        where: { id, userId: request.authenticatedUser.userId }
      });
      if (result.count === 0) return reply.code(404).send({ message: 'Personal food not found' });
      return reply.code(204).send();
    });

    protectedRoutes.get('/nutrition/diary', async (request) => {
      const { date } = nutritionDateQuerySchema.parse(request.query);
      const userId = request.authenticatedUser.userId;
      const requestedDate = calendarDate(date);
      const [goal, day] = await Promise.all([
        fastify.prisma.nutritionGoal.findFirst({
          where: { userId, effectiveFrom: { lte: requestedDate } },
          orderBy: { effectiveFrom: 'desc' }
        }),
        fastify.prisma.nutritionDay.findUnique({
          where: { userId_date: { userId, date: requestedDate } },
          include: { entries: { orderBy: { createdAt: 'asc' } } }
        })
      ]);
      const entries = day?.entries ?? [];
      const totals = entries.reduce((sum, entry) => ({
        caloriesKcal: sum.caloriesKcal.add(entry.computedCaloriesKcal),
        proteinG: sum.proteinG.add(entry.computedProteinG),
        carbohydratesG: sum.carbohydratesG.add(entry.computedCarbohydratesG),
        fatG: sum.fatG.add(entry.computedFatG)
      }), {
        caloriesKcal: new Prisma.Decimal(0),
        proteinG: new Prisma.Decimal(0),
        carbohydratesG: new Prisma.Decimal(0),
        fatG: new Prisma.Decimal(0)
      });
      const serializedTotals = macroNumbers(totals);
      const serializedGoal = serializeGoal(goal);
      const remaining = serializedGoal ? {
        caloriesKcal: new Prisma.Decimal(serializedGoal.caloriesKcal).sub(totals.caloriesKcal).toNumber(),
        proteinG: new Prisma.Decimal(serializedGoal.proteinG).sub(totals.proteinG).toNumber(),
        carbohydratesG: new Prisma.Decimal(serializedGoal.carbohydratesG).sub(totals.carbohydratesG).toNumber(),
        fatG: new Prisma.Decimal(serializedGoal.fatG).sub(totals.fatG).toNumber()
      } : null;
      return {
        data: {
          date,
          goal: serializedGoal,
          totals: serializedTotals,
          remaining,
          entries: entries.map(serializeEntry)
        }
      };
    });

    protectedRoutes.post('/nutrition/diary/entries', async (request, reply) => {
      const body = diaryEntryCreateSchema.parse(request.body);
      const userId = request.authenticatedUser.userId;
      let snapshot: Snapshot;

      if (body.sourceType === FoodSourceType.PERSONAL) {
        const food = await fastify.prisma.personalFood.findFirst({
          where: { id: body.personalFoodId, userId }
        });
        if (!food) return reply.code(404).send({ message: 'Personal food not found' });
        snapshot = {
          sourceType: FoodSourceType.PERSONAL,
          productBarcode: null,
          personalFoodId: food.id,
          consumedUnit: food.basisUnit,
          snapshotName: food.name,
          snapshotBrand: food.brand,
          snapshotBasisAmount: food.basisAmount,
          snapshotBasisUnit: food.basisUnit,
          snapshotCaloriesKcal: food.caloriesKcal,
          snapshotProteinG: food.proteinG,
          snapshotCarbohydratesG: food.carbohydratesG,
          snapshotFatG: food.fatG
        };
      } else {
        const { code } = barcodeParamSchema.parse({ code: body.barcode });
        try {
          const product = await productLookup.getProductByBarcode(code);
          if (essentialMacroKeys.some((key) => product.nutrition[key] === null)) {
            return reply.code(422).send({
              code: 'INCOMPLETE_NUTRITION_DATA',
              message: 'Les calories, protéines, glucides et lipides sont requis pour ajouter ce produit.'
            });
          }
          snapshot = {
            sourceType: FoodSourceType.OPEN_FOOD_FACTS,
            productBarcode: product.barcode,
            personalFoodId: null,
            consumedUnit: product.nutritionBasis.unit === 'ml' ? NutritionUnit.ML : NutritionUnit.G,
            snapshotName: product.name ?? product.barcode,
            snapshotBrand: product.brand,
            snapshotBasisAmount: product.nutritionBasis.amount,
            snapshotBasisUnit: product.nutritionBasis.unit === 'ml' ? NutritionUnit.ML : NutritionUnit.G,
            snapshotCaloriesKcal: product.nutrition.caloriesKcal!,
            snapshotProteinG: product.nutrition.proteinG!,
            snapshotCarbohydratesG: product.nutrition.carbohydratesG!,
            snapshotFatG: product.nutrition.fatG!
          };
        } catch (error) {
          if (error instanceof ProductNotFoundError) {
            return reply.code(404).send({ code: 'PRODUCT_NOT_FOUND', message: 'Produit introuvable.' });
          }
          if (error instanceof FoodDataProviderUnavailableError) {
            return reply.code(503).send({
              code: 'FOOD_DATA_PROVIDER_UNAVAILABLE',
              message: 'Le service de données nutritionnelles est temporairement indisponible.'
            });
          }
          throw error;
        }
      }

      const computed = calculateConsumedMacros({
        caloriesKcal: snapshot.snapshotCaloriesKcal,
        proteinG: snapshot.snapshotProteinG,
        carbohydratesG: snapshot.snapshotCarbohydratesG,
        fatG: snapshot.snapshotFatG
      }, body.consumedAmount, snapshot.snapshotBasisAmount);

      const entry = await fastify.prisma.$transaction(async (tx) => {
        const day = await tx.nutritionDay.upsert({
          where: { userId_date: { userId, date: calendarDate(body.date) } },
          create: { userId, date: calendarDate(body.date) },
          update: {}
        });
        return tx.foodEntry.create({
          data: {
            nutritionDayId: day.id,
            mealType: body.mealType,
            consumedAmount: body.consumedAmount,
            ...snapshot,
            ...computed
          }
        });
      });
      return reply.code(201).send({ data: serializeEntry(entry) });
    });

    protectedRoutes.patch('/nutrition/diary/entries/:id', async (request, reply) => {
      const { id } = nutritionIdParamSchema.parse(request.params);
      const body = diaryEntryPatchSchema.parse(request.body);
      const userId = request.authenticatedUser.userId;
      const updated = await fastify.prisma.$transaction(async (tx) => {
        const entry = await tx.foodEntry.findFirst({
          where: { id, nutritionDay: { userId } }
        });
        if (!entry) return null;
        const computed = body.consumedAmount === undefined ? {} : calculateConsumedMacros({
          caloriesKcal: entry.snapshotCaloriesKcal,
          proteinG: entry.snapshotProteinG,
          carbohydratesG: entry.snapshotCarbohydratesG,
          fatG: entry.snapshotFatG
        }, body.consumedAmount, entry.snapshotBasisAmount);
        return tx.foodEntry.update({
          where: { id },
          data: { ...body, ...computed }
        });
      });
      if (!updated) return reply.code(404).send({ message: 'Food entry not found' });
      return { data: serializeEntry(updated) };
    });

    protectedRoutes.delete('/nutrition/diary/entries/:id', async (request, reply) => {
      const { id } = nutritionIdParamSchema.parse(request.params);
      const result = await fastify.prisma.foodEntry.deleteMany({
        where: { id, nutritionDay: { userId: request.authenticatedUser.userId } }
      });
      if (result.count === 0) return reply.code(404).send({ message: 'Food entry not found' });
      return reply.code(204).send();
    });
  });
};
