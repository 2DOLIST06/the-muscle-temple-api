import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { FoodSourceType, MealType, NutritionUnit, Prisma, PrismaClient, UserRole } from '@prisma/client';
import { ZodError } from 'zod';
import { FoodProduct } from '../src/lib/food/types.js';
import { nutritionRoutes } from '../src/routes/public/nutrition.js';

const now = new Date('2026-10-04T12:00:00.000Z');
const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const dateKey = (value: Date) => value.toISOString().slice(0, 10);

function buildStore() {
  const goals: any[] = [];
  const foods: any[] = [];
  const days: any[] = [];
  const entries: any[] = [];
  let sequence = 0;
  const id = (prefix: string) => `${prefix}-${++sequence}`;
  const macroFields = (data: any) => ({
    caloriesKcal: decimal(data.caloriesKcal), proteinG: decimal(data.proteinG),
    carbohydratesG: decimal(data.carbohydratesG), fatG: decimal(data.fatG)
  });

  const client: any = {
    nutritionGoal: {
      async upsert({ where, create, update }: any) {
        const key = where.userId_effectiveFrom;
        let goal = goals.find((item) => item.userId === key.userId && dateKey(item.effectiveFrom) === dateKey(key.effectiveFrom));
        if (goal) Object.assign(goal, macroFields(update), { updatedAt: now });
        else {
          goal = { id: id('goal'), ...create, ...macroFields(create), createdAt: now, updatedAt: now };
          goals.push(goal);
        }
        return goal;
      },
      async findFirst({ where }: any) {
        return goals.filter((item) => item.userId === where.userId && item.effectiveFrom <= where.effectiveFrom.lte)
          .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null;
      },
      async findMany({ where }: any) {
        return goals.filter((item) => item.userId === where.userId)
          .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
      }
    },
    personalFood: {
      async create({ data }: any) {
        const food = { id: id('food'), ...data, basisAmount: decimal(data.basisAmount), ...macroFields(data), createdAt: now, updatedAt: now };
        foods.push(food);
        return food;
      },
      async findMany({ where }: any) { return foods.filter((item) => item.userId === where.userId); },
      async findFirst({ where }: any) { return foods.find((item) => item.id === where.id && item.userId === where.userId) ?? null; },
      async findFirstOrThrow({ where }: any) {
        const food = foods.find((item) => item.id === where.id && item.userId === where.userId);
        if (!food) throw new Error('not found');
        return food;
      },
      async updateMany({ where, data }: any) {
        const food = foods.find((item) => item.id === where.id && item.userId === where.userId);
        if (!food) return { count: 0 };
        Object.assign(food, data, data.basisAmount === undefined ? {} : { basisAmount: decimal(data.basisAmount) }, { updatedAt: now });
        for (const key of ['caloriesKcal', 'proteinG', 'carbohydratesG', 'fatG']) if (data[key] !== undefined) food[key] = decimal(data[key]);
        return { count: 1 };
      },
      async deleteMany({ where }: any) {
        const index = foods.findIndex((item) => item.id === where.id && item.userId === where.userId);
        if (index < 0) return { count: 0 };
        const [removed] = foods.splice(index, 1);
        for (const entry of entries) if (entry.personalFoodId === removed.id) entry.personalFoodId = null;
        return { count: 1 };
      }
    },
    nutritionDay: {
      async upsert({ where, create }: any) {
        const key = where.userId_date;
        let day = days.find((item) => item.userId === key.userId && dateKey(item.date) === dateKey(key.date));
        if (!day) { day = { id: id('day'), ...create, createdAt: now, updatedAt: now }; days.push(day); }
        return day;
      },
      async findUnique({ where }: any) {
        const key = where.userId_date;
        const day = days.find((item) => item.userId === key.userId && dateKey(item.date) === dateKey(key.date));
        return day ? { ...day, entries: entries.filter((entry) => entry.nutritionDayId === day.id) } : null;
      }
    },
    foodEntry: {
      async create({ data }: any) {
        const entry = {
          id: id('entry'), ...data,
          consumedAmount: decimal(data.consumedAmount), snapshotBasisAmount: decimal(data.snapshotBasisAmount),
          snapshotCaloriesKcal: decimal(data.snapshotCaloriesKcal), snapshotProteinG: decimal(data.snapshotProteinG),
          snapshotCarbohydratesG: decimal(data.snapshotCarbohydratesG), snapshotFatG: decimal(data.snapshotFatG),
          computedCaloriesKcal: decimal(data.computedCaloriesKcal), computedProteinG: decimal(data.computedProteinG),
          computedCarbohydratesG: decimal(data.computedCarbohydratesG), computedFatG: decimal(data.computedFatG),
          createdAt: now, updatedAt: now
        };
        entries.push(entry);
        return entry;
      },
      async findFirst({ where }: any) {
        return entries.find((entry) => entry.id === where.id && days.some((day) => day.id === entry.nutritionDayId && day.userId === where.nutritionDay.userId)) ?? null;
      },
      async update({ where, data }: any) {
        const entry = entries.find((item) => item.id === where.id);
        Object.assign(entry, data, data.consumedAmount === undefined ? {} : { consumedAmount: decimal(data.consumedAmount) });
        for (const key of ['computedCaloriesKcal', 'computedProteinG', 'computedCarbohydratesG', 'computedFatG']) {
          if (data[key] !== undefined) entry[key] = decimal(data[key]);
        }
        return entry;
      },
      async deleteMany({ where }: any) {
        const index = entries.findIndex((entry) => entry.id === where.id && days.some((day) => day.id === entry.nutritionDayId && day.userId === where.nutritionDay.userId));
        if (index < 0) return { count: 0 };
        entries.splice(index, 1);
        return { count: 1 };
      }
    }
  };
  client.$transaction = async (callback: (tx: any) => unknown) => callback(client);
  return { prisma: client as PrismaClient, goals, foods, days, entries };
}

function product(overrides: Partial<FoodProduct> = {}): FoodProduct {
  return {
    barcode: '4006381333931', name: 'Produit test', brand: 'Marque', image: null,
    quantityLabel: null, servingSize: null, nutritionBasis: { amount: 100, unit: 'g' },
    nutrition: { caloriesKcal: 200, energyKj: 840, proteinG: 20, carbohydratesG: 30, sugarsG: null, fatG: 10, saturatedFatG: null, fiberG: null, saltG: null, sodiumG: null },
    nutritionAvailable: true, source: 'open_food_facts', sourceUrl: 'https://world.openfoodfacts.org/product/4006381333931',
    ...overrides
  };
}

async function buildApp(productLookup = { async getProductByBarcode() { return product(); } }) {
  const store = buildStore();
  const app = Fastify({ logger: false });
  app.decorate('prisma', store.prisma);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ message: error.issues[0]?.message });
    return reply.code(500).send({ message: error.message });
  });
  await app.register(jwt, { secret: 'test-secret-that-is-at-least-32-characters' });
  await app.register(nutritionRoutes, { prefix: '/api', productLookup });
  const token = (userId: string) => app.jwt.sign({ userId, email: `${userId}@example.com`, role: UserRole.USER });
  const request = (userId: string, options: Parameters<typeof app.inject>[0]) => app.inject({
    ...options, headers: { ...options.headers, authorization: `Bearer ${token(userId)}` }
  });
  return { app, store, request };
}

test('nutrition goals are upserted, historical, date-effective, isolated, and reject userId', async () => {
  const { app, request } = await buildApp();
  const goal = (effectiveFrom: string, caloriesKcal: number) => ({ effectiveFrom, caloriesKcal, proteinG: 100, carbohydratesG: 200, fatG: 50 });
  assert.equal((await request('a', { method: 'PUT', url: '/api/nutrition/goals', payload: goal('2026-01-01', 2000) })).statusCode, 200);
  assert.equal((await request('a', { method: 'PUT', url: '/api/nutrition/goals', payload: goal('2026-06-01', 2200) })).statusCode, 200);
  assert.equal((await request('a', { method: 'PUT', url: '/api/nutrition/goals', payload: goal('2026-06-01', 2300) })).json().data.caloriesKcal, 2300);
  const applicable = await request('a', { method: 'GET', url: '/api/nutrition/goals?date=2026-07-01' });
  assert.equal(applicable.json().data.caloriesKcal, 2300);
  assert.deepEqual((await request('a', { method: 'GET', url: '/api/nutrition/goals/history' })).json().data.map((item: any) => item.caloriesKcal), [2300, 2000]);
  assert.equal((await request('b', { method: 'GET', url: '/api/nutrition/goals?date=2026-07-01' })).json().data, null);
  assert.equal((await request('b', { method: 'PUT', url: '/api/nutrition/goals', payload: { ...goal('2026-01-01', 1), userId: 'a' } })).statusCode, 400);
  await app.close();
});

test('personal foods are private CRUD resources and deletion preserves entry snapshots', async () => {
  const { app, request } = await buildApp();
  const payload = { name: 'Lasagnes maison', brand: null, basisAmount: 100, basisUnit: NutritionUnit.G, caloriesKcal: 145, proteinG: 8.2, carbohydratesG: 17.5, fatG: 4.8 };
  const created = await request('a', { method: 'POST', url: '/api/nutrition/personal-foods', payload });
  const foodId = created.json().data.id;
  assert.equal(created.statusCode, 201);
  assert.equal((await request('b', { method: 'GET', url: '/api/nutrition/personal-foods' })).json().data.length, 0);
  assert.equal((await request('b', { method: 'GET', url: `/api/nutrition/personal-foods/${foodId}` })).statusCode, 404);
  assert.equal((await request('b', { method: 'PATCH', url: `/api/nutrition/personal-foods/${foodId}`, payload: { name: 'Volé' } })).statusCode, 404);
  const patched = await request('a', { method: 'PATCH', url: `/api/nutrition/personal-foods/${foodId}`, payload: { name: 'Lasagnes familiales' } });
  assert.equal(patched.json().data.name, 'Lasagnes familiales');
  const entry = await request('a', { method: 'POST', url: '/api/nutrition/diary/entries', payload: { date: '2026-10-04', mealType: MealType.LUNCH, sourceType: FoodSourceType.PERSONAL, personalFoodId: foodId, consumedAmount: 200 } });
  assert.equal(entry.json().data.computedCaloriesKcal, 290);
  assert.equal((await request('a', { method: 'DELETE', url: `/api/nutrition/personal-foods/${foodId}` })).statusCode, 204);
  const diary = await request('a', { method: 'GET', url: '/api/nutrition/diary?date=2026-10-04' });
  assert.equal(diary.json().data.entries[0].personalFoodId, null);
  assert.equal(diary.json().data.entries[0].snapshot.name, 'Lasagnes familiales');
  await app.close();
});

test('diary calculates snapshots, totals and negative remaining, then patches from snapshots without provider reload', async () => {
  let providerCalls = 0;
  const { app, request } = await buildApp({ async getProductByBarcode() { providerCalls += 1; return product(); } });
  await request('a', { method: 'PUT', url: '/api/nutrition/goals', payload: { effectiveFrom: '2026-01-01', caloriesKcal: 100, proteinG: 20, carbohydratesG: 20, fatG: 10 } });
  const empty = await request('a', { method: 'GET', url: '/api/nutrition/diary?date=2026-10-04' });
  assert.deepEqual(empty.json().data.entries, []);
  assert.deepEqual(empty.json().data.totals, { caloriesKcal: 0, proteinG: 0, carbohydratesG: 0, fatG: 0 });

  const added = await request('a', { method: 'POST', url: '/api/nutrition/diary/entries', payload: { date: '2026-10-04', mealType: MealType.BREAKFAST, sourceType: FoodSourceType.OPEN_FOOD_FACTS, barcode: '4006381333931', consumedAmount: 150 } });
  assert.equal(added.statusCode, 201);
  assert.equal(added.json().data.snapshot.caloriesKcal, 200);
  assert.equal(added.json().data.computedCaloriesKcal, 300);
  const entryId = added.json().data.id;

  const diary = await request('a', { method: 'GET', url: '/api/nutrition/diary?date=2026-10-04' });
  assert.equal(diary.json().data.totals.caloriesKcal, 300);
  assert.equal(diary.json().data.remaining.caloriesKcal, -200);

  const patched = await request('a', { method: 'PATCH', url: `/api/nutrition/diary/entries/${entryId}`, payload: { mealType: MealType.DINNER, consumedAmount: 50 } });
  assert.equal(patched.json().data.mealType, MealType.DINNER);
  assert.equal(patched.json().data.computedCaloriesKcal, 100);
  assert.equal(providerCalls, 1);
  assert.equal((await request('b', { method: 'PATCH', url: `/api/nutrition/diary/entries/${entryId}`, payload: { consumedAmount: 1 } })).statusCode, 404);
  assert.equal((await request('b', { method: 'DELETE', url: `/api/nutrition/diary/entries/${entryId}` })).statusCode, 404);
  assert.equal((await request('a', { method: 'DELETE', url: `/api/nutrition/diary/entries/${entryId}` })).statusCode, 204);
  await app.close();
});

test('diary rejects incomplete OFF nutrition and strict ownership fields', async () => {
  const incomplete = product({ nutrition: { ...product().nutrition, proteinG: null } });
  const { app, request } = await buildApp({ async getProductByBarcode() { return incomplete; } });
  const response = await request('a', { method: 'POST', url: '/api/nutrition/diary/entries', payload: { date: '2026-10-04', mealType: MealType.SNACK, sourceType: FoodSourceType.OPEN_FOOD_FACTS, barcode: '4006381333931', consumedAmount: 10 } });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().code, 'INCOMPLETE_NUTRITION_DATA');
  assert.equal((await request('b', { method: 'POST', url: '/api/nutrition/personal-foods', payload: { userId: 'a', name: 'Test', basisAmount: 100, basisUnit: NutritionUnit.G, caloriesKcal: 1, proteinG: 1, carbohydratesG: 1, fatG: 1 } })).statusCode, 400);
  await app.close();
});
