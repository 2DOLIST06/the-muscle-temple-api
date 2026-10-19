// In-memory Prisma adapter for exercising the real admin routes without touching a database.
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { Prisma, PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import { publicRoutes } from '../src/routes/public/index.js';
import { adminApiRoutes } from '../src/routes/admin/api.js';
import { makeBanner } from '../src/lib/affiliate.js';

export const demoSource = `<div class="demo">Démonstration é 😀</div>\r\n<a rel="ugc" href="http://127.0.0.1:4199/demo/offer?affiliate=demo&x=1"><img width="320" height="60" src="http://127.0.0.1:4199/demo/banner.svg"></a>\n<img width="1" height="1" src="http://127.0.0.1:4199/demo/pixel.gif"><iframe src="http://127.0.0.1:4199/demo/frame"></iframe>\n<script src="http://127.0.0.1:4199/demo/external.js"></script><script>window.demoInline=(window.demoInline||0)+1;window.demoOrder=window.demoExternal===window.demoInline;</script>`;
export const ordinary = '<p>Un <a href="https://ordinary.invalid/?affiliate=unchanged">lien affilié texte</a></p><aside data-affiliate-block="link"><a href="https://ordinary.invalid/button">Bouton</a></aside><img src="http://127.0.0.1:4199/demo/ordinary.svg" alt="ordinaire">';
export function makeTestPost(id: string, html = '<p>Premier paragraphe</p><p>Deuxième paragraphe</p>' + ordinary, locale = 'fr') {
  return { id, title: `Article ${id}`, slug: id, locale, translationGroupId: `group-${id}`, excerpt: 'Description de démonstration.', authorId: 'author', author: { id: 'author', name: 'Auteur démo', slug: 'demo' }, category: null, coverImage: null, categoryId: null, categorySlug: null, coverImageId: null,
    contentHtml: html, contentMarkdown: html, contentJson: { type: 'doc', html, extra: { preserve: 'yes' } },
    status: 'PUBLISHED', isActive: true, isIndexable: true, robots: 'index,follow', publishedAt: new Date('2026-01-01'), createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'),
    metaTitle: 'SEO démo', metaDescription: 'Description SEO', faqJson: [], tagsJson: [], jsonLd: null, seoMetadata: null, postTags: [], relatedFrom: [] };
}
export type TestPost = ReturnType<typeof makeTestPost>;
export async function affiliateFixture(count = 0, publicContent = false) {
  const posts = new Map<string, TestPost>();
  posts.set('empty', makeTestPost('empty'));
  posts.set('empty2', makeTestPost('empty2'));
  posts.set('placed', makeTestPost('placed', '<p>Avant</p>' + makeBanner({ source: '<b>Ancien</b>' }) + '<p>Après</p>' + ordinary));
  posts.set('legacy', makeTestPost('legacy', '<p>Avant</p><aside data-affiliate-block="banner"><a href="https://demo.invalid/"><img src="http://127.0.0.1:4199/demo/banner.svg"></a></aside><p>Après</p>' + ordinary));
  posts.set('ambiguous', makeTestPost('ambiguous', makeBanner({ source: 'a' }) + makeBanner({ source: 'b' })));
  posts.set('english', makeTestPost('english', '<p>English untouched</p>', 'en'));
  for (let i = 0; i < count; i++) posts.set(`filtered-${i}`, makeTestPost(`filtered-${i}`));
  let bulkConflicts = 0;
  let saveConflict = false;
  const errors = new Set<string>();
  const clone = <T>(v: T): T => structuredClone(v);
  function matches(post: TestPost, where: any) {
    if (!where) return true;
    if (where.id && (typeof where.id === 'string' ? post.id !== where.id : where.id.not === post.id || (where.id.in && !where.id.in.includes(post.id)))) return false;
    if (where.updatedAt && +post.updatedAt !== +new Date(where.updatedAt)) return false;
    for (const key of ['slug', 'locale', 'translationGroupId'] as const) {
      if (typeof where[key] === 'string' && post[key] !== where[key]) return false;
      if (where[key]?.in && !where[key].in.includes(post[key])) return false;
    }
    return true;
  }
  function update(where: any, data: any) {
    const post = posts.get(where.id);
    if (saveConflict && post) { post.updatedAt = new Date(+post.updatedAt + 1); saveConflict = false; }
    if (!post || !matches(post, where)) throw new Prisma.PrismaClientKnownRequestError('Concurrent update', { code: 'P2025', clientVersion: 'test' });
    for (const [key, value] of Object.entries(data)) if (value !== undefined) (post as any)[key] = clone(value);
    return clone(post);
  }
  const prisma = { post: {
    async findUnique({ where }: any) { return clone(posts.get(where.id) ?? null); },
    async findFirst({ where }: any) { return clone([...posts.values()].find(p => matches(p, where)) ?? null); },
    async count({ where }: any = {}) { return [...posts.values()].filter(p => matches(p, where)).length; },
    async findMany({ where, skip = 0, take, orderBy }: any = {}) {
      const rows = [...posts.values()].filter(p => matches(p, where));
      if (orderBy) rows.sort((a, b) => +b.publishedAt - +a.publishedAt);
      return clone(rows.slice(skip, take === undefined ? undefined : skip + take));
    },
    async update({ where, data }: any) { return update(where, data); },
    async updateMany({ where, data }: any) {
      if (errors.has(where.id)) throw new Error('Simulated database failure');
      const post = posts.get(where.id);
      if (bulkConflicts && post) {
        bulkConflicts--; post.contentHtml = '<p>Modification concurrente</p>' + post.contentHtml;
        post.contentJson.html = post.contentHtml; post.contentMarkdown = post.contentHtml; post.updatedAt = new Date(+post.updatedAt + 1);
        return { count: 0 };
      }
      if (!post || !matches(post, where)) return { count: 0 };
      update(where, data); return { count: 1 };
    }
  }, author: { async findUnique() { return { id: 'author' }; }, async findMany() { return [{ id: 'author', name: 'Auteur démo' }]; } },
    category: { async findMany() { return []; } }, tag: { async findMany() { return []; } }, media: { async findMany() { return []; } },
    postTag: { async deleteMany() {}, async createMany() {} }, postRelation: { async deleteMany() {}, async createMany() {}, async findMany() { return []; } }
  } as unknown as PrismaClient;
  const app = Fastify(); app.decorate('prisma', prisma);
  await app.register(jwt, { secret: 'affiliate-test-secret-at-least-32-characters' });
  app.setErrorHandler((err, _req, reply) => reply.code(err instanceof ZodError ? 400 : 500).send({ message: err.message }));
  await app.register(adminApiRoutes, { prefix: '/admin-api' });
  if (publicContent) await app.register(publicRoutes, { prefix: '/api' });
  await app.ready();
  const token = app.jwt.sign({ userId: 'demo-admin', email: 'demo@example.invalid', role: 'ADMIN' });
  const headers = { authorization: `Bearer ${token}` };
  const apply = (ids: string[], source = demoSource) => app.inject({ method: 'POST', url: '/admin-api/posts/affiliate-banner', headers, payload: { ids, source } });
  const save = (post: TestPost, html: string, revision = post.updatedAt.toISOString()) => app.inject({ method: 'PUT', url: `/admin-api/posts/${post.id}`, headers,
    payload: { ...post, publishedAt: post.publishedAt.toISOString(), expectedUpdatedAt: revision, contentHtml: html, contentJson: { ...post.contentJson, html }, tagIds: [], relatedPostIds: [] } });
  return { app, posts, headers, token, apply, save, errors, conflictBulk: (times = 1) => { bulkConflicts = times; }, conflictSave: () => { saveConflict = true; } };
}
