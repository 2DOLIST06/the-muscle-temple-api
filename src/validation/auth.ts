import { z } from 'zod';

export const publicRegisterSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(10),
  displayName: z.string().trim().min(2).max(100)
}).strict();

export const publicLoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8)
}).strict();

export const loginLinkSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  locale: z.enum(['fr', 'en']).default('fr')
}).strict();
export const consumeLoginLinkSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const changePasswordSchema = z.object({
  password: z.string().min(10).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password is too long')
}).strict();

export const profileSchema = z.object({
  firstName: z.string().trim().max(100),
  lastName: z.string().trim().max(100),
  phone: z.string().trim().max(40),
  address: z.string().trim().max(250),
  postalCode: z.string().trim().max(20),
  city: z.string().trim().max(100),
  country: z.string().trim().max(100)
}).strict();
