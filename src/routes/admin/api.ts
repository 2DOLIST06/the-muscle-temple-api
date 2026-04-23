import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { PostStatus, SeoEntityType, UserRole } from '@prisma/client';
import { z } from 'zod';
import { makeSlug } from '../../lib/slug.js';
import { authorSchema, categorySchema, createUserSchema, loginSchema, mediaSchema, postSchema, tagSchema } from '../../validation/admin.js';
import { requireAdminAuth, requireRole } from '../../lib/auth.js';

const pageSeoSchema = z.object({
  title: z.string().max(70).optional(),
  description: z.string().max(160).optional(),
  canonicalUrl: z.string().url().optional(),
  noIndex: z.boolean().optional().default(false),
  openGraphImageId: z.string().optional()
});

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

export const adminApiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await fastify.prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return reply.code(401).send({ message: 'Invalid credentials' });

    const isValid = await bcrypt.compare(body.password, user.passwordHash);
    if (!isValid) return reply.code(401).send({ message: 'Invalid credentials' });

    const token = await reply.jwtSign({ userId: user.id, email: user.email, role: user.role }, { expiresIn: '12h' });
    return { data: { token, user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName } } };
  });

  fastify.register(async (protectedScope) => {
    protectedScope.addHook('preHandler', requireAdminAuth);

    protectedScope.get('/me', async (request) => {
      const user = await fastify.prisma.user.findUnique({ where: { id: request.adminUser.userId } });
      return { data: user };
    });

    protectedScope.get('/dashboard', async () => {
      const [posts, drafts, published, categories, authors] = await Promise.all([
        fastify.prisma.post.count(),
        fastify.prisma.post.count({ where: { status: PostStatus.DRAFT } }),
        fastify.prisma.post.count({ where: { status: PostStatus.PUBLISHED } }),
        fastify.prisma.category.count(),
        fastify.prisma.author.count()
      ]);
      return { data: { posts, drafts, published, categories, authors } };
    });

    protectedScope.register(async (adminOnly) => {
      adminOnly.addHook('preHandler', requireRole([UserRole.ADMIN]));
      adminOnly.post('/users', async (request) => {
        const body = createUserSchema.parse(request.body);
        const passwordHash = await bcrypt.hash(body.password, 10);
        const user = await fastify.prisma.user.create({
          data: { email: body.email, passwordHash, role: body.role, displayName: body.displayName }
        });
        return { data: user };
      });
    });

    protectedScope.get('/posts', async () => {
      const posts = await fastify.prisma.post.findMany({
        include: {
          author: true,
          category: true,
          coverImage: true,
          seoMetadata: true,
          postTags: { include: { tag: true } },
          relatedFrom: { include: { targetPost: { select: { id: true, title: true, slug: true } } } }
        },
        orderBy: { updatedAt: 'desc' }
      });
      return { data: posts };
    });

    protectedScope.post('/posts', async (request) => {
      const body = postSchema.parse(request.body);
      const slug = body.slug ? makeSlug(body.slug) : makeSlug(body.title);
      const tagIds = uniqueIds(body.tagIds);
      const relatedPostIds = uniqueIds(body.relatedPostIds);

      const post = await fastify.prisma.post.create({
        data: {
          title: body.title,
          slug,
          excerpt: body.excerpt,
          contentMarkdown: body.contentMarkdown,
          contentJson: body.contentJson,
          status: body.status,
          publishedAt: body.publishedAt ? new Date(body.publishedAt) : body.status === PostStatus.PUBLISHED ? new Date() : null,
          readingTimeMinutes: body.readingTimeMinutes ?? undefined,
          authorId: body.authorId,
          categoryId: body.categoryId ?? undefined,
          coverImageId: body.coverImageId ?? undefined
        }
      });

      if (tagIds.length) {
        await fastify.prisma.postTag.createMany({
          data: tagIds.map((tagId) => ({ postId: post.id, tagId })),
          skipDuplicates: true
        });
      }

      const filteredRelatedPostIds = relatedPostIds.filter((relatedId) => relatedId !== post.id);
      if (filteredRelatedPostIds.length) {
        await fastify.prisma.postRelation.createMany({
          data: filteredRelatedPostIds.map((targetPostId) => ({ sourcePostId: post.id, targetPostId })),
          skipDuplicates: true
        });
      }

      if (body.seo) {
        await fastify.prisma.seoMetadata.create({
          data: {
            entityType: SeoEntityType.POST,
            postId: post.id,
            title: body.seo.title || undefined,
            description: body.seo.description || undefined,
            canonicalUrl: body.seo.canonicalUrl || undefined,
            noIndex: body.seo.noIndex,
            openGraphImageId: body.seo.openGraphImageId || undefined
          }
        });
      }

      return { data: post };
    });

    protectedScope.put('/posts/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = postSchema.parse(request.body);
      const existing = await fastify.prisma.post.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ message: 'Post not found' });

      const tagIds = uniqueIds(body.tagIds);
      const relatedPostIds = uniqueIds(body.relatedPostIds).filter((relatedId) => relatedId !== id);

      const updated = await fastify.prisma.post.update({
        where: { id },
        data: {
          title: body.title,
          slug: body.slug ? makeSlug(body.slug) : makeSlug(body.title),
          excerpt: body.excerpt,
          contentMarkdown: body.contentMarkdown,
          contentJson: body.contentJson,
          status: body.status,
          publishedAt: body.publishedAt ? new Date(body.publishedAt) : body.status === PostStatus.PUBLISHED ? existing.publishedAt ?? new Date() : null,
          readingTimeMinutes: body.readingTimeMinutes ?? undefined,
          authorId: body.authorId,
          categoryId: body.categoryId ?? undefined,
          coverImageId: body.coverImageId ?? undefined
        }
      });

      await fastify.prisma.postTag.deleteMany({ where: { postId: id } });
      if (tagIds.length) {
        await fastify.prisma.postTag.createMany({
          data: tagIds.map((tagId) => ({ postId: id, tagId })),
          skipDuplicates: true
        });
      }

      await fastify.prisma.postRelation.deleteMany({ where: { sourcePostId: id } });
      if (relatedPostIds.length) {
        await fastify.prisma.postRelation.createMany({
          data: relatedPostIds.map((targetPostId) => ({ sourcePostId: id, targetPostId })),
          skipDuplicates: true
        });
      }

      if (body.seo) {
        await fastify.prisma.seoMetadata.upsert({
          where: { postId: id },
          update: {
            title: body.seo.title || undefined,
            description: body.seo.description || undefined,
            canonicalUrl: body.seo.canonicalUrl || undefined,
            noIndex: body.seo.noIndex,
            openGraphImageId: body.seo.openGraphImageId || undefined
          },
          create: {
            entityType: SeoEntityType.POST,
            postId: id,
            title: body.seo.title || undefined,
            description: body.seo.description || undefined,
            canonicalUrl: body.seo.canonicalUrl || undefined,
            noIndex: body.seo.noIndex,
            openGraphImageId: body.seo.openGraphImageId || undefined
          }
        });
      }

      return { data: updated };
    });

    protectedScope.delete('/posts/:id', async (request) => {
      const { id } = request.params as { id: string };
      await fastify.prisma.post.delete({ where: { id } });
      return { success: true };
    });

    protectedScope.get('/categories', async () => ({ data: await fastify.prisma.category.findMany({ include: { seoMetadata: true } }) }));
    protectedScope.post('/categories', async (request) => {
      const body = categorySchema.parse(request.body);
      const category = await fastify.prisma.category.create({
        data: { name: body.name, slug: body.slug ? makeSlug(body.slug) : makeSlug(body.name), description: body.description }
      });
      if (body.seo) {
        await fastify.prisma.seoMetadata.create({
          data: {
            entityType: SeoEntityType.CATEGORY,
            categoryId: category.id,
            title: body.seo.title || undefined,
            description: body.seo.description || undefined,
            canonicalUrl: body.seo.canonicalUrl || undefined,
            noIndex: body.seo.noIndex,
            openGraphImageId: body.seo.openGraphImageId || undefined
          }
        });
      }
      return { data: category };
    });

    protectedScope.put('/categories/:id', async (request) => {
      const { id } = request.params as { id: string };
      const body = categorySchema.parse(request.body);
      const category = await fastify.prisma.category.update({
        where: { id },
        data: { name: body.name, slug: body.slug ? makeSlug(body.slug) : makeSlug(body.name), description: body.description }
      });
      if (body.seo) {
        await fastify.prisma.seoMetadata.upsert({
          where: { categoryId: id },
          update: {
            title: body.seo.title || undefined,
            description: body.seo.description || undefined,
            canonicalUrl: body.seo.canonicalUrl || undefined,
            noIndex: body.seo.noIndex,
            openGraphImageId: body.seo.openGraphImageId || undefined
          },
          create: {
            entityType: SeoEntityType.CATEGORY,
            categoryId: id,
            title: body.seo.title || undefined,
            description: body.seo.description || undefined,
            canonicalUrl: body.seo.canonicalUrl || undefined,
            noIndex: body.seo.noIndex,
            openGraphImageId: body.seo.openGraphImageId || undefined
          }
        });
      }
      return { data: category };
    });
    protectedScope.delete('/categories/:id', async (request, reply) => {
      try {
        return {
          data: await fastify.prisma.category.delete({ where: { id: (request.params as { id: string }).id } })
        };
      } catch {
        return reply.code(409).send({ message: 'Impossible de supprimer cette catégorie (posts liés).' });
      }
    });

    protectedScope.get('/authors', async () => ({
      data: await fastify.prisma.author.findMany({ include: { seoMetadata: true, avatarMedia: true } })
    }));
    protectedScope.post('/authors', async (request) => {
      const body = authorSchema.parse(request.body);
      const author = await fastify.prisma.author.create({
        data: {
          name: body.name,
          slug: body.slug ? makeSlug(body.slug) : makeSlug(body.name),
          bio: body.bio,
          avatarMediaId: body.avatarMediaId || undefined
        }
      });
      if (body.seo) {
        await fastify.prisma.seoMetadata.create({
          data: {
            entityType: SeoEntityType.AUTHOR,
            authorId: author.id,
            title: body.seo.title || undefined,
            description: body.seo.description || undefined,
            canonicalUrl: body.seo.canonicalUrl || undefined,
            noIndex: body.seo.noIndex,
            openGraphImageId: body.seo.openGraphImageId || undefined
          }
        });
      }
      return { data: author };
    });
    protectedScope.put('/authors/:id', async (request) => {
      const { id } = request.params as { id: string };
      const body = authorSchema.parse(request.body);
      const author = await fastify.prisma.author.update({
        where: { id },
        data: {
          name: body.name,
          slug: body.slug ? makeSlug(body.slug) : makeSlug(body.name),
          bio: body.bio,
          avatarMediaId: body.avatarMediaId || undefined
        }
      });
      if (body.seo) {
        await fastify.prisma.seoMetadata.upsert({
          where: { authorId: id },
          update: {
            title: body.seo.title || undefined,
            description: body.seo.description || undefined,
            canonicalUrl: body.seo.canonicalUrl || undefined,
            noIndex: body.seo.noIndex,
            openGraphImageId: body.seo.openGraphImageId || undefined
          },
          create: {
            entityType: SeoEntityType.AUTHOR,
            authorId: id,
            title: body.seo.title || undefined,
            description: body.seo.description || undefined,
            canonicalUrl: body.seo.canonicalUrl || undefined,
            noIndex: body.seo.noIndex,
            openGraphImageId: body.seo.openGraphImageId || undefined
          }
        });
      }
      return { data: author };
    });
    protectedScope.delete('/authors/:id', async (request, reply) => {
      try {
        return { data: await fastify.prisma.author.delete({ where: { id: (request.params as { id: string }).id } }) };
      } catch {
        return reply.code(409).send({ message: 'Impossible de supprimer cet auteur (posts liés).' });
      }
    });

    protectedScope.get('/tags', async () => ({ data: await fastify.prisma.tag.findMany({ orderBy: { name: 'asc' } }) }));
    protectedScope.post('/tags', async (request) => {
      const body = tagSchema.parse(request.body);
      return {
        data: await fastify.prisma.tag.create({
          data: { name: body.name, slug: body.slug ? makeSlug(body.slug) : makeSlug(body.name) }
        })
      };
    });

    protectedScope.get('/media', async () => ({ data: await fastify.prisma.media.findMany({ orderBy: { createdAt: 'desc' } }) }));
    protectedScope.post('/media', async (request) => {
      const body = mediaSchema.parse(request.body);
      return { data: await fastify.prisma.media.create({ data: body }) };
    });

    protectedScope.get('/seo/page/:key', async (request) => {
      const key = (request.params as { key: string }).key;
      return {
        data: await fastify.prisma.seoMetadata.findUnique({ where: { pageKey: key }, include: { openGraphImage: true } })
      };
    });

    protectedScope.put('/seo/page/:key', async (request) => {
      const key = (request.params as { key: string }).key;
      const body = pageSeoSchema.parse(request.body);
      return {
        data: await fastify.prisma.seoMetadata.upsert({
          where: { pageKey: key },
          update: { ...body, entityType: SeoEntityType.PAGE },
          create: { ...body, pageKey: key, entityType: SeoEntityType.PAGE }
        })
      };
    });
  });
};
