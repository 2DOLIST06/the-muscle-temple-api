import { FastifyPluginAsync } from 'fastify';
import { PostStatus, Prisma } from '@prisma/client';
import { paginationQuerySchema } from '../../validation/common.js';

const getPublicPostWhere = () => ({
  status: PostStatus.PUBLISHED,
  isActive: true,
  publishedAt: { lte: new Date() }
});

const postInclude = {
  author: true,
  category: true,
  coverImage: true,
  seoMetadata: true,
  postTags: { include: { tag: true } }
} as const;

type PublicPost = Prisma.PostGetPayload<{ include: typeof postInclude }>;

const serializePublicPost = (post: PublicPost) => {
  const tags = post.postTags.map(({ tag }) => tag);

  return {
    ...post,
    category: post.category,
    categorySlug: post.categorySlug ?? post.category?.slug ?? null,
    author: post.author,
    authorSlug: post.author.slug,
    tags,
    tagsJson: post.tagsJson,
    seo: post.seoMetadata,
    seoMetadata: post.seoMetadata
  };
};

export const publicRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async () => ({ ok: true }));

  fastify.get('/posts', async (request, reply) => {
    const { page, limit } = paginationQuerySchema.parse(request.query);
    const skip = (page - 1) * limit;
    const publicPostWhere = getPublicPostWhere();

    reply.header('Cache-Control', 'no-store');

    const [total, posts] = await Promise.all([
      fastify.prisma.post.count({ where: publicPostWhere }),
      fastify.prisma.post.findMany({
        where: publicPostWhere,
        skip,
        take: limit,
        orderBy: [{ publishedAt: 'desc' }],
        include: postInclude
      })
    ]);

    return { data: posts.map(serializePublicPost), meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  });

  fastify.get('/posts/:slug', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    const post = await fastify.prisma.post.findFirst({
      where: { slug, status: PostStatus.PUBLISHED, isActive: true },
      include: {
        author: true,
        category: true,
        coverImage: true,
        seoMetadata: { include: { openGraphImage: true } },
        postTags: { include: { tag: true } }
      }
    });

    if (!post) return reply.code(404).send({ message: 'Post not found' });

    const relatedIds = await fastify.prisma.postRelation.findMany({
      where: { sourcePostId: post.id },
      select: { targetPostId: true }
    });

    const relatedPosts = relatedIds.length
      ? await fastify.prisma.post.findMany({
          where: { id: { in: relatedIds.map((r) => r.targetPostId) }, status: PostStatus.PUBLISHED, isActive: true },
          include: { author: true, coverImage: true }
        })
      : [];

    return { data: { ...post, relatedPosts } };
  });

  fastify.get('/categories', async () => {
    const categories = await fastify.prisma.category.findMany({
      include: { seoMetadata: true, _count: { select: { posts: true } } },
      orderBy: { name: 'asc' }
    });
    return { data: categories };
  });

  fastify.get('/categories/:slug/posts', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    const category = await fastify.prisma.category.findUnique({ where: { slug } });
    if (!category) return reply.code(404).send({ message: 'Category not found' });

    const posts = await fastify.prisma.post.findMany({
      where: { categoryId: category.id, status: PostStatus.PUBLISHED, isActive: true, publishedAt: { lte: new Date() } },
      include: { author: true, coverImage: true, seoMetadata: true },
      orderBy: { publishedAt: 'desc' }
    });

    return { data: { category, posts } };
  });

  fastify.get('/authors', async () => {
    const authors = await fastify.prisma.author.findMany({
      include: { avatarMedia: true, seoMetadata: true, _count: { select: { posts: true } } }
    });
    return { data: authors };
  });

  fastify.get('/authors/:slug/posts', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    const author = await fastify.prisma.author.findUnique({ where: { slug }, include: { seoMetadata: true, avatarMedia: true } });
    if (!author) return reply.code(404).send({ message: 'Author not found' });

    const posts = await fastify.prisma.post.findMany({
      where: { authorId: author.id, status: PostStatus.PUBLISHED, isActive: true, publishedAt: { lte: new Date() } },
      include: { category: true, coverImage: true, seoMetadata: true },
      orderBy: { publishedAt: 'desc' }
    });

    return { data: { author, posts } };
  });

  fastify.get('/seo/pages/:key', async (request, reply) => {
    const key = (request.params as { key: string }).key;
    const meta = await fastify.prisma.seoMetadata.findUnique({ where: { pageKey: key } });
    if (!meta) return reply.code(404).send({ message: 'SEO metadata not found' });
    return { data: meta };
  });
};
