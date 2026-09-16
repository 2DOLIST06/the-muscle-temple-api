import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { FoodProductCacheRepository } from '../src/lib/food/cache.js';
import {
  FoodDataProviderUnavailableError,
  normalizeProduct,
  OpenFoodFactsService,
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

test('normalization prioritizes selected images and uses all image fallbacks', () => {
  const selectedImage = normalizeProduct({
    code: '96385074',
    selected_images: { front: { display: { fr: 'https://images.example/selected.jpg' } } },
    image_front_url: 'https://images.example/front.jpg'
  }, '96385074');
  assert.equal(selectedImage.image, 'https://images.example/selected.jpg');

  for (const field of ['image_front_url', 'image_url', 'image_small_url', 'image_thumb_url']) {
    const product = normalizeProduct({ code: '96385074', [field]: `https://images.example/${field}.jpg` }, '96385074');
    assert.equal(product.image, `https://images.example/${field}.jpg`);
  }

  assert.equal(normalizeProduct({ code: '96385074', image_url: 'not-a-url' }, '96385074').image, null);
});

test('product request asks Open Food Facts for nutrition and image fields', async () => {
  let requestedUrl: URL | undefined;
  let diagnostic: Record<string, unknown> | undefined;
  const fetchMock = (async (input: string | URL | Request) => {
    requestedUrl = new URL(input instanceof Request ? input.url : input.toString());
    return new Response(JSON.stringify({
      status: 1,
      product: {
        code: '3017624010701',
        product_name: 'Nutella',
        brands: 'Ferrero',
        nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3 },
        selected_images: { front: { display: { fr: 'https://images.example/nutella.jpg' } } }
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const service = new OpenFoodFactsService('test-agent', 1_000, fetchMock, (details) => { diagnostic = details; });

  const product = await service.getProductByBarcode('3017624010701');
  const fields = new Set(requestedUrl?.searchParams.get('fields')?.split(','));
  for (const field of [
    'code', 'product_name', 'generic_name', 'brands', 'quantity', 'serving_size',
    'nutrition_data_per', 'nutriments', 'selected_images', 'image_url',
    'image_front_url', 'image_small_url', 'image_thumb_url'
  ]) assert.equal(fields.has(field), true, `missing requested field: ${field}`);
  assert.equal(product.nutrition.caloriesKcal, 539);
  assert.equal(product.nutrition.proteinG, 6.3);
  assert.equal(product.image, 'https://images.example/nutella.jpg');
  assert.deepEqual(diagnostic, {
    barcode: '3017624010701',
    hasNutriments: true,
    hasSelectedImages: true,
    hasImageUrl: false,
    hasImageFrontUrl: false
  });
});

test('search uses Search-a-licious full-text search and normalizes its products', async () => {
  let requestedUrl: URL | undefined;
  let diagnostic: Record<string, unknown> | undefined;
  const fetchMock = (async (input: string | URL | Request) => {
    requestedUrl = new URL(input instanceof Request ? input.url : input.toString());
    return new Response(JSON.stringify({
      count: 1,
      page: 1,
      page_size: 2,
      hits: [{
        _source: {
          code: '3017620422003',
          product_name: 'Nutella',
          brands: 'Ferrero',
          quantity: '1 kg',
          image_front_url: 'https://images.example/nutella.jpg'
        }
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const service = new OpenFoodFactsService('test-agent', 1_000, fetchMock, (details) => { diagnostic = details; });

  const products = await service.searchProducts('nutella', 2);
  assert.equal(requestedUrl?.origin, 'https://search.openfoodfacts.org');
  assert.equal(requestedUrl?.pathname, '/search');
  assert.equal(requestedUrl?.searchParams.get('q'), 'nutella');
  assert.equal(requestedUrl?.searchParams.get('page'), '1');
  assert.equal(requestedUrl?.searchParams.get('page_size'), '2');
  assert.equal(requestedUrl?.searchParams.get('fields'), 'code,product_name,brands,image_front_url,image_url,quantity');
  assert.equal(requestedUrl?.searchParams.has('search_terms'), false);
  assert.deepEqual(products, [{
    barcode: '3017620422003',
    name: 'Nutella',
    brand: 'Ferrero',
    image: 'https://images.example/nutella.jpg',
    quantityLabel: '1 kg',
    source: 'open_food_facts',
    sourceUrl: 'https://world.openfoodfacts.org/product/3017620422003'
  }]);
  assert.equal('nutrition' in products[0]!, false);
  assert.equal(diagnostic?.operation, 'search');
  assert.equal(diagnostic?.status, 200);
  assert.deepEqual(diagnostic?.responseKeys, ['count', 'page', 'page_size', 'hits']);
});

test('search rejects an unexpected Open Food Facts response instead of reporting no results', async () => {
  let diagnostic: Record<string, unknown> | undefined;
  const fetchMock = (async () => new Response(JSON.stringify({ results: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })) as typeof fetch;
  const service = new OpenFoodFactsService('test-agent', 1_000, fetchMock, (details) => { diagnostic = details; });

  await assert.rejects(() => service.searchProducts('orange', 10), FoodDataProviderUnavailableError);
  assert.deepEqual(diagnostic, {
    operation: 'search',
    endpoint: 'https://search.openfoodfacts.org/search',
    responseKeys: ['results'],
    hitsType: 'undefined',
    productsType: 'undefined'
  });
});

test('search diagnostics expose provider HTTP errors and network timeouts', async (t) => {
  await t.test('HTTP error body', async () => {
    const diagnostics: Record<string, unknown>[] = [];
    const fetchMock = (async () => new Response('{"detail":"invalid fields"}', {
      status: 422,
      headers: { 'Content-Type': 'application/json' }
    })) as typeof fetch;
    const service = new OpenFoodFactsService('test-agent', 1_000, fetchMock, (details) => { diagnostics.push(details); });

    await assert.rejects(() => service.searchProducts('nutella', 10), FoodDataProviderUnavailableError);
    assert.equal(diagnostics[0]?.status, 422);
    assert.equal(diagnostics[0]?.responseBody, '{"detail":"invalid fields"}');
    assert.equal((diagnostics[0]?.parameters as Record<string, string>).q, 'nutella');
  });

  await t.test('network timeout', async () => {
    let diagnostic: Record<string, unknown> | undefined;
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    const fetchMock = (async () => { throw timeout; }) as typeof fetch;
    const service = new OpenFoodFactsService('test-agent', 250, fetchMock, (details) => { diagnostic = details; });

    await assert.rejects(() => service.searchProducts('skyr', 10), FoodDataProviderUnavailableError);
    assert.equal(diagnostic?.timedOut, true);
    assert.equal(diagnostic?.timeoutMs, 250);
    assert.equal(diagnostic?.errorMessage, 'The operation was aborted due to timeout');
  });
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

test('search trims and lowercases input, normalizes response envelope, and enforces the requested limit', async () => {
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
  const response = await app.inject({ method: 'GET', url: '/foods/search?q=%20BOISSON%20&limit=2' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, ['boisson', 2]);
  assert.equal(response.json().data.length, 2);
  assert.equal(response.json().data[0].nutrition, undefined);
  await app.close();
});

test('nutrition search handles case consistently and rejects a too-short query', async () => {
  const received: string[] = [];
  const app = buildApp({
    provider: {
      async getProductByBarcode() { return completeProduct; },
      async searchProducts(query) { received.push(query); return []; }
    },
    cache: { async get() { return null; }, async set() {} }
  }, '/api');

  for (const query of ['nutella', 'Nutella', 'NUTELLA', '%20%20Nutella%20%20']) {
    assert.equal((await app.inject({ method: 'GET', url: `/api/nutrition/search?query=${query}` })).statusCode, 200);
  }
  assert.deepEqual(received, ['nutella', 'nutella', 'nutella', 'nutella']);
  assert.equal((await app.inject({ method: 'GET', url: '/api/nutrition/search?query=a' })).statusCode, 400);
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
