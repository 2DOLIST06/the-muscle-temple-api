import { PostStatus, UserRole } from '@prisma/client';
import { z } from 'zod';
import { seoSchema } from './common.js';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2),
  password: z.string().min(10),
  role: z.nativeEnum(UserRole)
});

export const mediaSchema = z.object({
  url: z.string().url(),
  altText: z.string().optional(),
  caption: z.string().optional(),
  mimeType: z.string().optional(),
  source: z.string().optional()
});

export const authorSchema = z.object({
  name: z.string().min(2),
  slug: z.string().optional(),
  bio: z.string().optional(),
  avatarMediaId: z.string().optional().nullable(),
  seo: seoSchema.optional()
});

export const categorySchema = z.object({
  name: z.string().min(2),
  slug: z.string().optional(),
  description: z.string().optional(),
  seo: seoSchema.optional()
});

export const tagSchema = z.object({
  name: z.string().min(2),
  slug: z.string().optional()
});

export const postSchema = z.object({
  title: z.string().min(4),
  slug: z.string().optional(),
  excerpt: z.string().max(280).optional(),
  contentMarkdown: z.string().min(10),
  contentJson: z.unknown().optional(),
  status: z.nativeEnum(PostStatus).default(PostStatus.DRAFT),
  publishedAt: z.string().datetime().optional().nullable(),
  readingTimeMinutes: z.coerce.number().int().positive().optional().nullable(),
  authorId: z.string().trim().min(1),
  categoryId: z.string().trim().optional().nullable(),
  coverImageId: z.string().trim().optional().nullable(),
  tagIds: z.array(z.string().trim()).default([]),
  relatedPostIds: z.array(z.string().trim()).default([]),
  seo: seoSchema.optional()
});
