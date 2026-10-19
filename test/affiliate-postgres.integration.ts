import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { PrismaClient, type Post } from '@prisma/client';
import { ZodError } from 'zod';
import { getBanners, makeBanner } from '../src/lib/affiliate.js';

// Never fall back to DATABASE_URL: this suite must not discover or use production.
const testUrl = process.env.AFFILIATE_TEST_DATABASE_URL;
assert.ok(testUrl, 'Set AFFILIATE_TEST_DATABASE_URL explicitly to an isolated local PostgreSQL test database.');
const parsedUrl = new URL(testUrl);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsedUrl.hostname), 'Only local test PostgreSQL is accepted.');
assert.match(parsedUrl.pathname, /^\/btg_affiliate_test(?:_[a-z0-9_]+)?$/);
assert.equal(process.env.ALLOW_AFFILIATE_POSTGRES_TESTS, '1', 'Explicit test-only opt-in is required.');
process.env.DATABASE_URL = testUrl;
process.env.JWT_SECRET = 'affiliate-postgres-test-secret-at-least-32-characters';
const { adminApiRoutes } = await import('../src/routes/admin/api.js');
const source = '<div>Démo 😀</div>\r\n<a href="https://demo.invalid/?id=test&x=1"><img src="https://demo.invalid/banner.png"></a><img width="1" height="1" src="https://demo.invalid/pixel"><iframe src="https://demo.invalid/frame"></iframe><script src="https://demo.invalid/script.js"></script><script>window.demoOnly=true;</script>';
// These tests store/retrieve source only. No browser or external HTTP call is made.
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded(promise: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout>;
  try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Test synchronization timed out')), 10000); })]); }
  finally { clearTimeout(timer!); }
}
async function makeApp(prisma: PrismaClient) {
  const app = Fastify(); app.decorate('prisma', prisma);
  await app.register(jwt, { secret: process.env.JWT_SECRET! });
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof ZodError ? 400 : 500).send({ message: error.message }));
  await app.register(adminApiRoutes, { prefix: '/admin-api' }); await app.ready();
  const headers = { authorization: `Bearer ${app.jwt.sign({ userId: 'postgres-test', email: 'postgres@example.invalid', role: 'ADMIN' })}` };
  const bulk = (ids: string[], code = source) => app.inject({ method: 'POST', url: '/admin-api/posts/affiliate-banner', headers, payload: { ids, source: code } });
  const save = (post: Post, html: string) => app.inject({ method: 'PUT', url: `/admin-api/posts/${post.id}`, headers, payload: {
    title: post.title, slug: post.slug, locale: post.locale, authorId: post.authorId, translationGroupId: post.translationGroupId,
    expectedUpdatedAt: post.updatedAt.toISOString(), contentHtml: html, contentJson: { type: 'doc', html },
    status: post.status, isActive: post.isActive, isIndexable: post.isIndexable, robots: post.robots,
    publishedAt: post.publishedAt?.toISOString() ?? null, metaTitle: post.metaTitle
  } });
  return { app, headers, bulk, save };
}

test('real PostgreSQL: persistence, positions, concurrent writes, 409 and partial retry', { timeout: 60000 }, async t => {
  const prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
  const reader = new PrismaClient({ datasources: { db: { url: testUrl } } });
  const prefix = 'affiliate-pg-' + randomUUID();
  const ids: string[] = [];
  const apps: Array<Awaited<ReturnType<typeof makeApp>>> = [];
  const author = await prisma.author.create({ data: { name: 'Auteur test isolé', slug: prefix } });
  const seed = async (suffix: string, html = '<p>Avant</p><p>Après</p>') => {
    const post = await prisma.post.create({ data: { title: 'Article test ' + suffix, slug: prefix + '-' + suffix,
      authorId: author.id, contentHtml: html, contentMarkdown: html, contentJson: { type: 'doc', html, extra: 'preserve' },
      locale: 'fr', status: 'PUBLISHED', isActive: true, isIndexable: true, robots: 'index,follow', metaTitle: 'SEO conservé', publishedAt: new Date('2026-01-01T00:00:00Z') } });
    ids.push(post.id); return post;
  };
  const api = await makeApp(prisma); apps.push(api);
  try {
    const identity = await reader.$queryRaw<Array<{ database: string; version: string }>>`SELECT current_database() AS database, version() AS version`;
    assert.equal(identity[0].database, parsedUrl.pathname.slice(1));
    t.diagnostic(identity[0].version.split(' on ')[0] + ', isolated database ' + identity[0].database);
    await t.test('bulk add, mixed replacement, exact source and independent SQL reread', async () => {
      const a = await seed('empty-a'), b = await seed('empty-b');
      const placed = await seed('placed', '<p>Avant</p>' + makeBanner({ source: 'ancien' }) + '<p>Après</p>');
      const untouched = await seed('untouched');
      let result = await api.bulk([a.id, b.id, placed.id]);
      assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().data.modified, 3);
      const saved = await reader.$queryRaw<Array<{ id: string; contentHtml: string; contentJson: { html: string; extra: string }; metaTitle: string; status: string }>>`
        SELECT id, "contentHtml", "contentJson", "metaTitle", status::text FROM "Post" WHERE id IN (${a.id}, ${b.id}, ${placed.id})`;
      for (const row of saved) {
        assert.equal(getBanners(row.contentHtml)[0].source, source);
        assert.equal(row.contentHtml, row.contentJson.html); assert.equal(row.contentJson.extra, 'preserve');
        assert.equal(row.metaTitle, 'SEO conservé'); assert.equal(row.status, 'PUBLISHED');
        assert.equal(row.contentHtml, row.id === placed.id ? '<p>Avant</p>' + makeBanner({ source }) + '<p>Après</p>' : a.contentHtml + makeBanner({ source }));
      }
      assert.deepEqual(await reader.post.findUnique({ where: { id: untouched.id } }), untouched);
      result = await api.bulk([a.id, b.id, placed.id], '<strong>remplacé</strong>');
      assert.equal(result.json().data.modified, 3);
      assert.equal((await api.bulk([a.id, b.id, placed.id], '<strong>remplacé</strong>')).json().data.unchanged, 3);
      assert.equal((await reader.post.findUniqueOrThrow({ where: { id: placed.id } })).contentHtml, '<p>Avant</p>' + makeBanner({ source: '<strong>remplacé</strong>' }) + '<p>Après</p>');
    });
    await t.test('manual save persists moved position, then bulk replacement preserves it', async () => {
      const post = await seed('move');
      await api.bulk([post.id]);
      const current = await reader.post.findUniqueOrThrow({ where: { id: post.id } });
      const moved = '<p>Avant</p>' + makeBanner({ source }) + '<p>Après</p>';
      const response = await api.save(current, moved); assert.equal(response.statusCode, 200, response.body);
      assert.equal((await reader.post.findUniqueOrThrow({ where: { id: post.id } })).contentHtml, moved);
      const loaded = await api.app.inject({ url: '/admin-api/posts/' + post.id, headers: api.headers });
      assert.equal(loaded.json().data.contentJson.html, moved);
      assert.equal((await api.bulk([post.id], 'code remplacé')).json().data.modified, 1);
      assert.equal((await reader.post.findUniqueOrThrow({ where: { id: post.id } })).contentHtml, '<p>Avant</p>' + makeBanner({ source: 'code remplacé' }) + '<p>Après</p>');
    });
    await t.test('two simultaneous SQL-backed saves: one winner, one 409, then explicit reconciliation', async () => {
      const post = await seed('simultaneous');
      const bothRead = deferred(); let arrivals = 0; let reads = 0;
      // Synchronization only: every query below is executed by real Prisma/PostgreSQL.
      const gated = prisma.$extends({ query: { post: { async findUnique({ args, query }) {
        const value = await query(args);
        if (args.where.id === post.id && arrivals < 2) { arrivals++; reads++; if (arrivals === 2) bothRead.resolve(); await bounded(bothRead.promise); }
        return value;
      } } } });
      const raceApi = await makeApp(gated as unknown as PrismaClient); apps.push(raceApi);
      const [a, b] = await Promise.all([raceApi.save(post, '<p>Écriture A</p>'), raceApi.save(post, '<p>Écriture B</p>')]);
      assert.equal(reads, 2); assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
      const winningHtml = a.statusCode === 200 ? '<p>Écriture A</p>' : '<p>Écriture B</p>';
      const saved = await reader.post.findUniqueOrThrow({ where: { id: post.id } });
      assert.equal(saved.contentHtml, winningHtml);
      assert.equal((await api.save(post, '<p>Obsolete</p>')).statusCode, 409);
      assert.deepEqual(await reader.post.findUniqueOrThrow({ where: { id: post.id } }), saved);
      const merged = winningHtml + '<p>Changement du second éditeur réappliqué explicitement</p>';
      assert.equal((await api.save(saved, merged)).statusCode, 200);
      assert.equal((await reader.post.findUniqueOrThrow({ where: { id: post.id } })).contentHtml, merged);
    });
    await t.test('bulk stale SQL snapshot retries after a concurrent manual edit without losing it', async () => {
      const post = await seed('bulk-race'); const captured = deferred(), release = deferred(); let reads = 0;
      const gated = prisma.$extends({ query: { post: { async findUnique({ args, query }) {
        const value = await query(args);
        if (args.where.id === post.id && ++reads === 1) { captured.resolve(); await bounded(release.promise); }
        return value;
      } } } });
      const raceApi = await makeApp(gated as unknown as PrismaClient); apps.push(raceApi);
      const pending = raceApi.bulk([post.id]);
      try {
        await bounded(captured.promise);
        const save = await api.save(post, '<p>Modification concurrente conservée</p>'); assert.equal(save.statusCode, 200, save.body);
      } finally { release.resolve(); }
      const result = await pending; assert.equal(result.json().data.modified, 1); assert.ok(reads >= 2);
      assert.equal((await reader.post.findUniqueOrThrow({ where: { id: post.id } })).contentHtml, '<p>Modification concurrente conservée</p>' + makeBanner({ source }));
    });
    await t.test('real database trigger failure affects one article; retry and replay create no duplicate', async () => {
      const good = await seed('partial-good'), failing = await seed('partial-fail');
      // A trigger in this disposable database produces an actual SQL failure, not a mocked error.
      await prisma.$executeRawUnsafe(`CREATE FUNCTION btg_affiliate_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${failing.id}' THEN RAISE EXCEPTION 'Deliberate isolated affiliate test failure'; END IF; RETURN NEW; END $$`);
      await prisma.$executeRawUnsafe('CREATE TRIGGER btg_affiliate_test_fail BEFORE UPDATE ON "Post" FOR EACH ROW EXECUTE FUNCTION btg_affiliate_test_fail()');
      try {
        const response = await api.bulk([good.id, failing.id]);
        assert.equal(response.statusCode, 200); assert.equal(response.json().data.modified, 1); assert.equal(response.json().data.failed, 1);
        assert.deepEqual(await reader.post.findUniqueOrThrow({ where: { id: failing.id } }), failing);
        assert.equal(getBanners((await reader.post.findUniqueOrThrow({ where: { id: good.id } })).contentHtml!)[0].source, source);
      } finally {
        await prisma.$executeRawUnsafe('DROP TRIGGER btg_affiliate_test_fail ON "Post"');
        await prisma.$executeRawUnsafe('DROP FUNCTION btg_affiliate_test_fail()');
      }
      assert.equal((await api.bulk([failing.id])).json().data.modified, 1);
      assert.equal((await api.bulk([good.id, failing.id])).json().data.unchanged, 2);
      for (const id of [good.id, failing.id]) assert.equal(getBanners((await reader.post.findUniqueOrThrow({ where: { id } })).contentHtml!).length, 1);
    });
  } finally {
    await Promise.all(apps.map(api => api.app.close()));
    await prisma.post.deleteMany({ where: { id: { in: ids }, authorId: author.id } });
    await prisma.author.delete({ where: { id: author.id } });
    await Promise.all([prisma.$disconnect(), reader.$disconnect()]);
  }
});
