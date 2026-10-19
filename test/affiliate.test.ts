import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import { adminApiRoutes } from '../src/routes/admin/api.js';
import { applyBanner, getBanners, inertBanners, makeBanner, activeContentSignature } from '../src/lib/affiliate.js';
const source = `<a href="https://affiliate.test/?a=1&tag=x"><img src="https://affiliate.test/banner.png"></a>\n<img width="1" height="1" src="https://affiliate.test/pixel"><iframe src="https://affiliate.test/frame"></iframe><script src="https://affiliate.test/script.js"></script><script>window.tracking = '<exact & value>';</script>`;

test('complete source roundtrips, replacement preserves position and unrelated content', () => {
  const before = '<section><p>Avant &amp; après</p>';
  const after = '<p>Suite</p></section><aside data-affiliate-block="link"><a href="https://offer.test">Offre</a></aside><img src="ordinary.png">';
  const html = before + makeBanner({ source }) + after;
  assert.equal(getBanners(html)[0].source, source);
  assert.equal(applyBanner(html, { source: 'next' }), before + makeBanner({ source: 'next' }) + after);
  assert.equal(getBanners(applyBanner(html, { source })).length, 1);
  assert.equal(applyBanner(before + after, { source }), before + after + makeBanner({ source }));
});
test('legacy blocks, nested asides, comments and script text are parsed correctly', () => {
  const html = `<p><!-- <aside data-affiliate-block="banner">fake</aside> --></p><aside title=">" data-affiliate-block='banner'><aside>Nested</aside>${source}</aside><script>const s = '<aside data-affiliate-block="banner">fake</aside>';</script>`;
  assert.equal(getBanners(html).length, 1);
  assert.equal(getBanners(inertBanners(html))[0].source, '<aside>Nested</aside>' + source);
  assert.throws(() => applyBanner(html + makeBanner({ source }), { source }), /Plusieurs/);
  const next = applyBanner(html + makeBanner({ source }), { source: 'chosen' }, 1);
  assert.equal(getBanners(next)[0].source, '<aside>Nested</aside>' + source);
  assert.equal(getBanners(next)[1].source, 'chosen');
});
test('guard catches decoded source, direct scripts, event handlers and iframe srcdoc', () => {
  for (const html of [makeBanner({ source }), '<img src=x onerror="alert(1)">', '<iframe srcdoc="<script>alert(1)</script>"></iframe>']) assert.notEqual(activeContentSignature(html), '');
  assert.equal(activeContentSignature('<p>Ordinaire <a href="https://test">lien</a></p>'), '');
});

type FakePost = { id: string; locale: string; contentHtml: string; contentMarkdown: string; contentJson: { type: string; html: string }; updatedAt: Date; status: string; metaTitle: string };
async function fixture() {
  const makePost = (id: string, html: string, locale = 'fr'): FakePost => ({ id, locale, contentHtml: html, contentMarkdown: html, contentJson: { type: 'doc', html }, updatedAt: new Date(1), status: 'PUBLISHED', metaTitle: 'SEO untouched' });
  const posts = new Map([
    ['one', makePost('one', '<p>Corps</p>')], ['two', makePost('two', '<p>Début</p>' + makeBanner({ source: 'old' }) + '<p>Fin</p>')],
    ['ambiguous', makePost('ambiguous', makeBanner({ source: 'a' }) + makeBanner({ source: 'b' }))], ['english', makePost('english', '<p>English</p>', 'en')]
  ]);
  let race = false;
  const prisma = { post: {
    async findUnique({ where }: { where: { id: string } }) { return structuredClone(posts.get(where.id) ?? null); },
    async updateMany({ where, data }: { where: { id: string; updatedAt: Date }; data: Partial<FakePost> }) {
      const post = posts.get(where.id)!;
      if (race) { race = false; post.contentHtml = '<p>Concurrent edit</p>' + post.contentHtml; post.contentJson.html = post.contentHtml; post.updatedAt = new Date(50); return { count: 0 }; }
      if (+post.updatedAt !== +where.updatedAt) return { count: 0 };
      Object.assign(post, data, { updatedAt: new Date(+post.updatedAt + 1) }); return { count: 1 };
    }
  }} as unknown as PrismaClient;
  const app = Fastify(); app.decorate('prisma', prisma);
  app.register(jwt, { secret: 'test-secret-that-is-at-least-32-characters' });
  app.setErrorHandler((err, _req, reply) => reply.code(err instanceof ZodError ? 400 : 500).send({ message: err.message }));
  await app.register(adminApiRoutes, { prefix: '/admin-api' }); await app.ready();
  const auth = (role: string) => ({ authorization: `Bearer ${app.jwt.sign({ userId: 'test', role, email: 'test@example.com' })}` });
  const apply = (payload: object, role = 'ADMIN') => app.inject({ method: 'POST', url: '/admin-api/posts/affiliate-banner', headers: auth(role), payload });
  return { posts, app, auth, apply, setRace: () => { race = true; } };
}
test('bulk ADMIN authorization, scope, ambiguous legacy blocks, idempotent retries', async () => {
  const { app, posts, apply } = await fixture();
  try {
    const payload = { ids: ['one', 'two', 'ambiguous', 'missing', 'one'], source, name: 'Campagne' };
    for (const role of ['USER', 'EDITOR']) assert.equal((await apply(payload, role)).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/admin-api/posts/affiliate-banner', payload })).statusCode, 401);
    const res = await apply(payload); assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.modified, 2); assert.equal(res.json().data.failed, 2);
    assert.equal(posts.get('one')!.status, 'PUBLISHED'); assert.equal(posts.get('one')!.metaTitle, 'SEO untouched');
    assert.equal(posts.get('english')!.contentHtml, '<p>English</p>');
    assert.equal(posts.get('two')!.contentHtml, '<p>Début</p>' + makeBanner({ source, name: 'Campagne' }) + '<p>Fin</p>');
    assert.equal(getBanners(posts.get('ambiguous')!.contentHtml).length, 2);
    const retry = await apply(payload); assert.equal(retry.json().data.modified, 0); assert.equal(retry.json().data.unchanged, 2);
  } finally { await app.close(); }
});
test('concurrent writes reread the latest body before applying', async () => {
  const { app, posts, apply, setRace } = await fixture();
  try {
    setRace(); const res = await apply({ ids: ['one'], source }); assert.equal(res.json().data.modified, 1);
    assert.ok(posts.get('one')!.contentHtml.startsWith('<p>Concurrent edit</p>'));
    assert.equal(posts.get('one')!.contentJson.html, posts.get('one')!.contentHtml);
    assert.equal(getBanners(posts.get('one')!.contentHtml).length, 1);
  } finally { await app.close(); }
});
test('standard post routes cannot bypass ADMIN restriction or hide code in contentJson', async () => {
  const { app, auth } = await fixture();
  try {
    for (const contentHtml of [makeBanner({ source }), '<p>Content</p><script>alert(1)</script>']) {
      const payload = { title: 'Titre test', contentHtml, authorId: 'author' };
      assert.equal((await app.inject({ method: 'POST', url: '/admin-api/posts', headers: auth('EDITOR'), payload })).statusCode, 403);
      assert.equal((await app.inject({ method: 'PUT', url: '/admin-api/posts/one', headers: auth('EDITOR'), payload })).statusCode, 403);
    }
    assert.equal((await app.inject({ method: 'POST', url: '/admin-api/posts', headers: auth('EDITOR'), payload: { title: 'Titre test', contentHtml: '<p>Ordinaire</p>', contentJson: { html: makeBanner({ source }) }, authorId: 'author' } })).statusCode, 400);
  } finally { await app.close(); }
});
