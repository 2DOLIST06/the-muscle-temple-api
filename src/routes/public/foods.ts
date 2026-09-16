import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
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
  const provider = options.provider ?? new OpenFoodFactsService(
    env.OPEN_FOOD_FACTS_USER_AGENT,
    env.OPEN_FOOD_FACTS_TIMEOUT_MS,
    fetch,
    (details) => fastify.log.info(details, 'Open Food Facts diagnostic')
  );
  const cache = options.cache ?? new FoodProductCacheRepository(
    fastify.prisma,
    env.OPEN_FOOD_FACTS_CACHE_TTL_HOURS * 60 * 60 * 1000
  );

  const getProduct = async (barcode: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const { code } = barcodeParamSchema.parse({ code: barcode });
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
  };

  const searchProducts = async (query: unknown, limitValue: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const { q, limit } = foodSearchQuerySchema.parse({ q: query, limit: limitValue });
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
  };

  fastify.get('/foods/barcode/:code', async (request, reply) => {
    const { code } = request.params as { code: string };
    return getProduct(code, request, reply);
  });

  fastify.get('/foods/search', async (request, reply) => {
    const { q, limit } = request.query as { q?: string; limit?: string };
    return searchProducts(q, limit, request, reply);
  });

  fastify.get('/nutrition/products/:barcode', async (request, reply) => {
    const { barcode } = request.params as { barcode: string };
    return getProduct(barcode, request, reply);
  });

  fastify.get('/nutrition/search', async (request, reply) => {
    const { query, limit } = request.query as { query?: string; limit?: string };
    return searchProducts(query, limit, request, reply);
  });
};
