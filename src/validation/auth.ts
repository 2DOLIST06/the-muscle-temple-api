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
