import { z } from 'zod';

export const newsletterGoals = ['hypertrophy', 'fat_loss', 'strength', 'general_fitness'] as const;

const sourceSchema = z.string().trim().min(1).max(120);
const tokenSchema = z.string().trim().min(32).max(200);

export const newsletterSubscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.'),
  language: z.enum(['fr', 'en']),
  source: sourceSchema,
  consent: z.literal(true, { errorMap: () => ({ message: 'Le consentement est requis.' }) }),
  consentTextVersion: z.string().trim().min(1).max(80),
  consentSource: sourceSchema.optional()
}).strict();

export const newsletterTokenBodySchema = z.object({ token: tokenSchema }).strict();
export const newsletterTokenQuerySchema = z.object({ token: tokenSchema }).strict();

export const newsletterTopicsSchema = z.object({
  new_articles: z.boolean().optional(),
  strength_training: z.boolean().optional(),
  workout_programs: z.boolean().optional(),
  nutrition: z.boolean().optional(),
  supplements: z.boolean().optional(),
  equipment: z.boolean().optional(),
  tools: z.boolean().optional(),
  guides: z.boolean().optional()
}).strict().refine((topics) => Object.keys(topics).length > 0, {
  message: 'Au moins un thème doit être fourni.'
});

export const newsletterPreferencesUpdateSchema = z.object({
  token: tokenSchema,
  topics: newsletterTopicsSchema.optional(),
  frequency: z.enum(['immediate', 'weekly', 'monthly']).optional(),
  goals: z.array(z.enum(newsletterGoals)).max(newsletterGoals.length).optional()
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'token'), {
  message: 'Au moins une préférence doit être fournie.'
});
