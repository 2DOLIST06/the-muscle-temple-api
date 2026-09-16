import { FoodNutrition, FoodProduct, FoodSearchResult, NutritionUnit } from './types.js';

const API_BASE_URL = 'https://world.openfoodfacts.org';
const SEARCH_API_BASE_URL = 'https://search.openfoodfacts.org';
const PRODUCT_FIELDS = [
  'code', 'product_name', 'generic_name', 'brands', 'quantity', 'serving_size',
  'nutrition_data_per', 'product_quantity_unit', 'nutriments', 'selected_images',
  'image_url', 'image_front_url', 'image_small_url', 'image_thumb_url'
].join(',');
const SEARCH_FIELDS = [
  'code', 'product_name', 'brands', 'image_front_url', 'image_url', 'quantity'
].join(',');
const DIAGNOSTIC_BARCODE = '3017624010701';

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

function imageUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? candidate : null;
  } catch {
    return null;
  }
}

function firstImageInVariant(value: unknown): string | null {
  return Object.values(record(value)).map(imageUrl).find((url) => url !== null) ?? null;
}

function productImage(product: UnknownRecord): string | null {
  const front = record(record(product.selected_images).front);
  return firstImageInVariant(front.display)
    ?? firstImageInVariant(front.small)
    ?? firstImageInVariant(front.thumb)
    ?? imageUrl(product.image_front_url)
    ?? imageUrl(product.image_url)
    ?? imageUrl(product.image_small_url)
    ?? imageUrl(product.image_thumb_url);
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
    name: text(product.product_name) ?? text(product.generic_name),
    brand: text(product.brands),
    image: productImage(product),
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
    name: text(product.product_name) ?? text(product.generic_name),
    brand: text(product.brands),
    image: productImage(product),
    quantityLabel: text(product.quantity),
    source: 'open_food_facts',
    sourceUrl: sourceUrl(barcode)
  };
}

export class OpenFoodFactsService {
  constructor(
    private readonly userAgent: string,
    private readonly timeoutMs: number,
    private readonly fetchImplementation: Fetch = fetch,
    private readonly diagnosticLogger?: (details: UnknownRecord) => void
  ) {}

  private async request(url: URL, notFoundOn404 = false, operation?: 'search') {
    try {
      const response = await this.fetchImplementation(url, {
        headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (response.status === 404 && notFoundOn404) throw new ProductNotFoundError();
      if (!response.ok) throw new FoodDataProviderUnavailableError();
      const payload = await response.json() as unknown;
      if (operation) {
        this.diagnosticLogger?.({
          operation,
          url: url.toString(),
          status: response.status,
          responseType: Array.isArray(payload) ? 'array' : typeof payload,
          responseKeys: Object.keys(record(payload))
        });
      }
      return payload;
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
    const product = record(payload.product);
    if (barcode === DIAGNOSTIC_BARCODE) {
      this.diagnosticLogger?.({
        barcode,
        hasNutriments: Object.keys(record(product.nutriments)).length > 0,
        hasSelectedImages: Object.keys(record(product.selected_images)).length > 0,
        hasImageUrl: imageUrl(product.image_url) !== null,
        hasImageFrontUrl: imageUrl(product.image_front_url) !== null
      });
    }
    return normalizeProduct(product, barcode);
  }

  async searchProducts(query: string, limit: number) {
    // Product API v2 does not implement full-text search. Search-a-licious is
    // Open Food Facts' public full-text engine and applies `q` server-side.
    const url = new URL('/search', SEARCH_API_BASE_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('page', '1');
    url.searchParams.set('page_size', String(limit));
    url.searchParams.set('fields', SEARCH_FIELDS);
    const payload = record(await this.request(url, false, 'search'));
    if (!Array.isArray(payload.products)) {
      this.diagnosticLogger?.({
        operation: 'search',
        endpoint: url.origin + url.pathname,
        responseKeys: Object.keys(payload),
        productsType: payload.products === null ? 'null' : typeof payload.products
      });
      throw new FoodDataProviderUnavailableError('Unexpected Open Food Facts search response');
    }
    const products = payload.products;
    return products.map(normalizeSearchResult).filter((item): item is FoodSearchResult => item !== null).slice(0, limit);
  }
}
