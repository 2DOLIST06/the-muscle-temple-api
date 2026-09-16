import { FastifyPluginAsync } from 'fastify';
import { env } from '../../config/env.js';
import { FoodProductCacheRepository } from '../../lib/food/cache.js';
import {
  FoodDataProviderUnavailableError,
  OpenFoodFactsService,
  ProductNotFoundError
} from '../../lib/food/open-food-facts.js';
import { FoodProduct, FoodSearchResult } from '../../lib/food/types.js';
import { barcodeParamSchema, foodSearchQuerySchema } from '../../validation/food.js';

interface ProductProvider {
  getProductByBarcode(barcode: string): Promise<FoodProduct>;
  searchProducts(query: string, limit: number): Promise<FoodSearchResult[]>;
}

interface ProductCache {
  get(barcode: string): Promise<FoodProduct | null>;
  set(product: FoodProduct): Promise<unknown>;
}

export interface FoodRoutesOptions {
  provider?: ProductProvider;
  cache?: ProductCache;
}

const providerUnavailable = { code: 'FOOD_DATA_PROVIDER_UNAVAILABLE', message: 'Le service de données nutritionnelles est temporairement indisponible.' };

export const foodRoutes: FastifyPluginAsync<FoodRoutesOptions> = async (fastify, options) => {
  const provider = options.provider ?? new OpenFoodFactsService(env.OPEN_FOOD_FACTS_USER_AGENT, env.OPEN_FOOD_FACTS_TIMEOUT_MS);
  const cache = options.cache ?? new FoodProductCacheRepository(
    fastify.prisma,
    env.OPEN_FOOD_FACTS_CACHE_TTL_HOURS * 60 * 60 * 1000
  );

  fastify.get('/foods/barcode/:code', async (request, reply) => {
    const { code } = barcodeParamSchema.parse(request.params);
    const cached = await cache.get(code);
    if (cached) return { data: cached, meta: { cached: true } };

    try {
      const product = await provider.getProductByBarcode(code);
      await cache.set(product);
      return { data: product, meta: { cached: false } };
    } catch (error) {
      if (error instanceof ProductNotFoundError) {
        return reply.code(404).send({ code: 'PRODUCT_NOT_FOUND', message: 'Produit introuvable.' });
      }
      if (error instanceof FoodDataProviderUnavailableError) {
        request.log.warn({ error, barcode: code }, 'Open Food Facts product request failed');
        return reply.code(503).send(providerUnavailable);
      }
      throw error;
    }
  });

  fastify.get('/foods/search', async (request, reply) => {
    const { q, limit } = foodSearchQuerySchema.parse(request.query);
    try {
      const products = await provider.searchProducts(q, limit);
      return { data: products, meta: { query: q, limit, count: products.length } };
    } catch (error) {
      if (error instanceof FoodDataProviderUnavailableError) {
        request.log.warn({ error, query: q }, 'Open Food Facts search request failed');
        return reply.code(503).send(providerUnavailable);
      }
      throw error;
    }
  });
};
