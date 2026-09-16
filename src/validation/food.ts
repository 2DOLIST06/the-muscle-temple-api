import { z } from 'zod';

function hasValidGtinCheckDigit(value: string) {
  const digits = [...value].map(Number);
  const checkDigit = digits.pop();
  if (checkDigit == null) return false;
  const sum = digits.reduce((total, digit, index) => {
    const distanceFromRight = digits.length - index;
    return total + digit * (distanceFromRight % 2 === 1 ? 3 : 1);
  }, 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
}

export const barcodeParamSchema = z.object({
  code: z.string().transform((value) => value.replace(/\s/g, '')).pipe(
    z.string()
      .regex(/^\d+$/, 'Le code-barres doit contenir uniquement des chiffres.')
      .refine((value) => [8, 12, 13].includes(value.length), 'Le code-barres doit être un EAN-8, UPC-A, UPC-E ou EAN-13.')
      .refine(hasValidGtinCheckDigit, 'La clé de contrôle du code-barres est invalide.')
  )
});

export const foodSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'La recherche doit contenir au moins 2 caractères.').max(100, 'La recherche ne peut pas dépasser 100 caractères.'),
  limit: z.coerce.number().int().positive().max(20).default(10)
});
