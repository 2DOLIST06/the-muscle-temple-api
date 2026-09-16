import { FoodProduct } from './types.js';

interface FoodCacheClient {
  foodProductCache: {
    findUnique(args: { where: { barcode: string } }): Promise<{ product: unknown; updatedAt: Date } | null>;
    upsert(args: {
      where: { barcode: string };
      create: { barcode: string; product: object };
      update: { product: object };
    }): Promise<unknown>;
  };
}

export class FoodProductCacheRepository {
  constructor(private readonly client: FoodCacheClient, private readonly ttlMs: number) {}

  async get(barcode: string): Promise<FoodProduct | null> {
    const cached = await this.client.foodProductCache.findUnique({ where: { barcode } });
    if (!cached || Date.now() - cached.updatedAt.getTime() >= this.ttlMs) return null;
    return cached.product as FoodProduct;
  }

  async set(product: FoodProduct) {
    await this.client.foodProductCache.upsert({
      where: { barcode: product.barcode },
      create: { barcode: product.barcode, product },
      update: { product }
    });
  }
}
