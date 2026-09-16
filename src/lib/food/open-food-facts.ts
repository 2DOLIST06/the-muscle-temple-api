import { FoodNutrition, FoodProduct, FoodSearchResult, NutritionUnit } from './types.js';

const API_BASE_URL = 'https://world.openfoodfacts.org';
const PRODUCT_FIELDS = [
  'code', 'product_name', 'brands', 'image_front_url', 'image_url', 'quantity', 'serving_size',
  'nutrition_data_per', 'product_quantity_unit', 'nutriments'
].join(',');
const SEARCH_FIELDS = ['code', 'product_name', 'brands', 'image_front_url', 'image_url', 'quantity'].join(',');

type Fetch = typeof fetch;
type UnknownRecord = Record<string, unknown>;

export class FoodDataProviderUnavailableError extends Error {}
export class ProductNotFoundError extends Error {}

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function nutritionUnit(product: UnknownRecord): NutritionUnit {
  const basis = text(product.nutrition_data_per)?.toLowerCase().replace(/\s/g, '');
  if (basis === '100ml') return 'ml';
  if (basis === '100g') return 'g';

  // OFF's quantity unit is used only to identify the reference unit. Values are
  // never converted between volume and mass.
  const quantityUnit = text(product.product_quantity_unit)?.toLowerCase();
  return quantityUnit === 'ml' || quantityUnit === 'cl' || quantityUnit === 'l' ? 'ml' : 'g';
}

function sourceUrl(barcode: string) {
  return `${API_BASE_URL}/product/${encodeURIComponent(barcode)}`;
}

export function normalizeProduct(raw: unknown, fallbackBarcode: string): FoodProduct {
  const product = record(raw);
  const nutriments = record(product.nutriments);
  const barcode = text(product.code) ?? fallbackBarcode;
  const nutrition: FoodNutrition = {
    caloriesKcal: number(nutriments['energy-kcal_100g']),
    energyKj: number(nutriments['energy-kj_100g']),
    proteinG: number(nutriments.proteins_100g),
    carbohydratesG: number(nutriments.carbohydrates_100g),
    sugarsG: number(nutriments.sugars_100g),
    fatG: number(nutriments.fat_100g),
    saturatedFatG: number(nutriments['saturated-fat_100g']),
    fiberG: number(nutriments.fiber_100g),
    saltG: number(nutriments.salt_100g),
    sodiumG: number(nutriments.sodium_100g)
  };

  return {
    barcode,
    name: text(product.product_name),
    brand: text(product.brands),
    image: text(product.image_front_url) ?? text(product.image_url),
    quantityLabel: text(product.quantity),
    servingSize: text(product.serving_size),
    nutritionBasis: { amount: 100, unit: nutritionUnit(product) },
    nutrition,
    nutritionAvailable: Object.values(nutrition).some((value) => value !== null),
    source: 'open_food_facts',
    sourceUrl: sourceUrl(barcode)
  };
}

function normalizeSearchResult(raw: unknown): FoodSearchResult | null {
  const product = record(raw);
  const barcode = text(product.code);
  if (!barcode) return null;
  return {
    barcode,
    name: text(product.product_name),
    brand: text(product.brands),
    image: text(product.image_front_url) ?? text(product.image_url),
    quantityLabel: text(product.quantity),
    source: 'open_food_facts',
    sourceUrl: sourceUrl(barcode)
  };
}

export class OpenFoodFactsService {
  constructor(
    private readonly userAgent: string,
    private readonly timeoutMs: number,
    private readonly fetchImplementation: Fetch = fetch
  ) {}

  private async request(url: URL, notFoundOn404 = false) {
    try {
      const response = await this.fetchImplementation(url, {
        headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (response.status === 404 && notFoundOn404) throw new ProductNotFoundError();
      if (!response.ok) throw new FoodDataProviderUnavailableError();
      return await response.json() as unknown;
    } catch (error) {
      if (error instanceof ProductNotFoundError || error instanceof FoodDataProviderUnavailableError) throw error;
      throw new FoodDataProviderUnavailableError('Open Food Facts request failed', { cause: error });
    }
  }

  async getProductByBarcode(barcode: string) {
    const url = new URL(`/api/v2/product/${encodeURIComponent(barcode)}.json`, API_BASE_URL);
    url.searchParams.set('fields', PRODUCT_FIELDS);
    const payload = record(await this.request(url, true));
    if (payload.status === 0 || !payload.product) throw new ProductNotFoundError();
    return normalizeProduct(payload.product, barcode);
  }

  async searchProducts(query: string, limit: number) {
    // OFF documents cgi/search.pl for full-text product search. Keeping this
    // provider detail here allows it to be replaced without changing our API.
    const url = new URL('/cgi/search.pl', API_BASE_URL);
    url.searchParams.set('search_terms', query);
    url.searchParams.set('search_simple', '1');
    url.searchParams.set('action', 'process');
    url.searchParams.set('json', '1');
    url.searchParams.set('page_size', String(limit));
    url.searchParams.set('fields', SEARCH_FIELDS);
    const payload = record(await this.request(url));
    const products = Array.isArray(payload.products) ? payload.products : [];
    return products.map(normalizeSearchResult).filter((item): item is FoodSearchResult => item !== null).slice(0, limit);
  }
}
