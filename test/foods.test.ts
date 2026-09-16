import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { FoodProductCacheRepository } from '../src/lib/food/cache.js';
import {
  FoodDataProviderUnavailableError,
  normalizeProduct,
  ProductNotFoundError
} from '../src/lib/food/open-food-facts.js';
import { FoodProduct } from '../src/lib/food/types.js';
import { foodRoutes } from '../src/routes/public/foods.js';
import { barcodeParamSchema } from '../src/validation/food.js';

const completeProduct = normalizeProduct({
  code: '4006381333931',
  product_name: 'Boisson test',
  brands: 'Marque',
  quantity: '500 ml',
  nutrition_data_per: '100ml',
  nutriments: {
    'energy-kcal_100g': 42,
    'energy-kj_100g': 176,
    proteins_100g: 1.2,
    carbohydrates_100g: 8,
    sugars_100g: 4,
    fat_100g: 0,
    'saturated-fat_100g': 0,
    fiber_100g: 0.5,
    salt_100g: 0.1,
    sodium_100g: 0.04
  }
}, '4006381333931');

function buildApp(options: Parameters<typeof foodRoutes>[1], prefix?: string) {
  const app = Fastify({ logger: false });
  app.register(foodRoutes, { ...options, prefix });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ message: error.issues[0]?.message });
    return reply.code(500).send({ message: 'Internal server error' });
  });
  return app;
}

test('barcode validation accepts EAN/UPC formats, strips spaces, and rejects bad check digits', () => {
  assert.equal(barcodeParamSchema.parse({ code: '4006 381333 931' }).code, '4006381333931');
  assert.equal(barcodeParamSchema.parse({ code: '96385074' }).code, '96385074');
  assert.equal(barcodeParamSchema.parse({ code: '036000291452' }).code, '036000291452');
  assert.throws(() => barcodeParamSchema.parse({ code: '4006381333932' }));
  assert.throws(() => barcodeParamSchema.parse({ code: 'https://example.com' }));
});

test('normalization preserves 100 ml, provider calories, explicit zeroes, and null missing values', () => {
  assert.deepEqual(completeProduct.nutritionBasis, { amount: 100, unit: 'ml' });
  assert.equal(completeProduct.nutrition.caloriesKcal, 42);
  assert.equal(completeProduct.nutrition.fatG, 0);
  assert.equal(completeProduct.nutritionAvailable, true);
  assert.equal(completeProduct.servingSize, null);

  const partial = normalizeProduct({ code: '96385074', nutrition_data_per: '100g', nutriments: { proteins_100g: 3 } }, '96385074');
  assert.equal(partial.nutrition.proteinG, 3);
  assert.equal(partial.nutrition.sugarsG, null);
  assert.equal(partial.nutrition.caloriesKcal, null);

  const withoutNutrition = normalizeProduct({ code: '96385074', product_name: 'Sans nutrition' }, '96385074');
  assert.equal(withoutNutrition.nutritionAvailable, false);
  assert.ok(Object.values(withoutNutrition.nutrition).every((value) => value === null));
});

test('valid cached product avoids a provider call', async () => {
  let calls = 0;
  const app = buildApp({
    provider: {
      async getProductByBarcode() { calls += 1; return completeProduct; },
      async searchProducts() { return []; }
    },
    cache: { async get() { return completeProduct; }, async set() {} }
  });
  const first = await app.inject({ method: 'GET', url: '/foods/barcode/4006381333931' });
  const second = await app.inject({ method: 'GET', url: '/foods/barcode/4006381333931' });
  assert.equal(first.statusCode, 200);
  assert.equal(second.json().meta.cached, true);
  assert.equal(calls, 0);
  await app.close();
});

test('frontend nutrition paths are registered with the expected parameters', async () => {
  let searchedFor: [string, number] | undefined;
  const app = buildApp({
    provider: {
      async getProductByBarcode() { return completeProduct; },
      async searchProducts(query, limit) { searchedFor = [query, limit]; return []; }
    },
    cache: { async get() { return completeProduct; }, async set() {} }
  }, '/api');

  const productResponse = await app.inject({ method: 'GET', url: '/api/nutrition/products/3017624010701' });
  assert.equal(productResponse.statusCode, 200);
  assert.equal(productResponse.json().data.barcode, completeProduct.barcode);

  const searchResponse = await app.inject({ method: 'GET', url: '/api/nutrition/search?query=steak' });
  assert.equal(searchResponse.statusCode, 200);
  assert.deepEqual(searchedFor, ['steak', 10]);
  assert.deepEqual(searchResponse.json(), {
    data: [],
    meta: { query: 'steak', limit: 10, count: 0 }
  });
  await app.close();
});

test('barcode endpoint returns validation, not-found, and provider errors distinctly', async (t) => {
  await t.test('invalid barcode', async () => {
    const app = buildApp({ provider: { async getProductByBarcode() { return completeProduct; }, async searchProducts() { return []; } }, cache: { async get() { return null; }, async set() {} } });
    assert.equal((await app.inject({ method: 'GET', url: '/foods/barcode/123' })).statusCode, 400);
    await app.close();
  });
  await t.test('not found', async () => {
    const app = buildApp({ provider: { async getProductByBarcode() { throw new ProductNotFoundError(); }, async searchProducts() { return []; } }, cache: { async get() { return null; }, async set() {} } });
    const response = await app.inject({ method: 'GET', url: '/foods/barcode/4006381333931' });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().code, 'PRODUCT_NOT_FOUND');
    await app.close();
  });
  await t.test('provider unavailable', async () => {
    const app = buildApp({ provider: { async getProductByBarcode() { throw new FoodDataProviderUnavailableError(); }, async searchProducts() { return []; } }, cache: { async get() { return null; }, async set() {} } });
    const response = await app.inject({ method: 'GET', url: '/foods/barcode/4006381333931' });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, 'FOOD_DATA_PROVIDER_UNAVAILABLE');
    await app.close();
  });
});

test('search trims input, normalizes response envelope, and enforces the requested limit', async () => {
  let received: [string, number] | undefined;
  const result = {
    barcode: completeProduct.barcode, name: completeProduct.name, brand: completeProduct.brand,
    image: completeProduct.image, quantityLabel: completeProduct.quantityLabel,
    source: completeProduct.source, sourceUrl: completeProduct.sourceUrl
  };
  const app = buildApp({
    provider: {
      async getProductByBarcode() { return completeProduct; },
      async searchProducts(query, limit) { received = [query, limit]; return Array.from({ length: limit }, () => result); }
    },
    cache: { async get() { return null; }, async set() {} }
  });
  const response = await app.inject({ method: 'GET', url: '/foods/search?q=%20boisson%20&limit=2' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, ['boisson', 2]);
  assert.equal(response.json().data.length, 2);
  assert.equal(response.json().data[0].nutrition, undefined);
  await app.close();
});

test('cache repository expires stale records and upserts normalized products', async () => {
  let stored: object | undefined;
  const client = {
    foodProductCache: {
      async findUnique() { return { product: completeProduct, updatedAt: new Date(Date.now() - 2_000) }; },
      async upsert(args: { create: { product: object } }) { stored = args.create.product; }
    }
  };
  const cache = new FoodProductCacheRepository(client, 1_000);
  assert.equal(await cache.get(completeProduct.barcode), null);
  await cache.set(completeProduct as FoodProduct);
  assert.equal(stored, completeProduct);
});
