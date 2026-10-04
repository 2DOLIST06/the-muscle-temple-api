import { Prisma } from '@prisma/client';

export type MacroValues = {
  caloriesKcal: Prisma.Decimal.Value;
  proteinG: Prisma.Decimal.Value;
  carbohydratesG: Prisma.Decimal.Value;
  fatG: Prisma.Decimal.Value;
};

export function calculateConsumedMacros(
  macros: MacroValues,
  consumedAmount: Prisma.Decimal.Value,
  basisAmount: Prisma.Decimal.Value
) {
  const factor = new Prisma.Decimal(consumedAmount).div(basisAmount);
  return {
    computedCaloriesKcal: new Prisma.Decimal(macros.caloriesKcal).mul(factor),
    computedProteinG: new Prisma.Decimal(macros.proteinG).mul(factor),
    computedCarbohydratesG: new Prisma.Decimal(macros.carbohydratesG).mul(factor),
    computedFatG: new Prisma.Decimal(macros.fatG).mul(factor)
  };
}

export function decimalNumber(value: Prisma.Decimal.Value): number {
  return new Prisma.Decimal(value).toNumber();
}

export function macroNumbers(values: MacroValues) {
  return {
    caloriesKcal: decimalNumber(values.caloriesKcal),
    proteinG: decimalNumber(values.proteinG),
    carbohydratesG: decimalNumber(values.carbohydratesG),
    fatG: decimalNumber(values.fatG)
  };
}
