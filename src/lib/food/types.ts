export type NutritionUnit = 'g' | 'ml';

export interface FoodNutrition {
  caloriesKcal: number | null;
  energyKj: number | null;
  proteinG: number | null;
  carbohydratesG: number | null;
  sugarsG: number | null;
  fatG: number | null;
  saturatedFatG: number | null;
  fiberG: number | null;
  saltG: number | null;
  sodiumG: number | null;
}

export interface FoodProduct {
  barcode: string;
  name: string | null;
  brand: string | null;
  image: string | null;
  quantityLabel: string | null;
  servingSize: string | null;
  nutritionBasis: { amount: 100; unit: NutritionUnit };
  nutrition: FoodNutrition;
  nutritionAvailable: boolean;
  source: 'open_food_facts';
  sourceUrl: string;
}

export type FoodSearchResult = Pick<FoodProduct, 'barcode' | 'name' | 'brand' | 'image' | 'quantityLabel' | 'source' | 'sourceUrl'>;
