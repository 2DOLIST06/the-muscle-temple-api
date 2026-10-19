import test from 'node:test';
import assert from 'node:assert/strict';
import { affiliateFixture, demoSource, ordinary } from './affiliate-fixture-helper.js';
import { getBanners, makeBanner } from '../src/lib/affiliate.js';

test('1-3: empty and mixed selections, repeated bulk applications and untouched metadata', async () => {
  const f = await affiliateFixture();
  try {
    const initial = structuredClone([...f.posts.entries()]);
    assert.equal((await f.apply(['empty', 'empty2'])).json().data.modified, 2);
    for (const id of ['empty', 'empty2']) {
      const before = initial.find(([key]) => key === id)![1];
      assert.equal(f.posts.get(id)!.contentHtml, before.contentHtml + makeBanner({ source: demoSource }));
    }
    assert.equal((await f.apply(['empty', 'placed', 'legacy', 'english'], '<b>Nouvelle bannière</b>')).json().data.modified, 4);
    for (let n = 0; n < 3; n++) assert.equal((await f.apply(['empty', 'placed', 'legacy', 'english'], '<b>Nouvelle bannière</b>')).json().data.unchanged, 4);
    for (const id of ['empty', 'placed', 'legacy', 'english']) {
      const post = f.posts.get(id)!;
      assert.equal(getBanners(post.contentHtml).length, 1);
      assert.deepEqual(post.contentJson.extra, { preserve: 'yes' });
      const before = initial.find(([key]) => key === id)![1];
      const { contentHtml:a, contentJson:b, contentMarkdown:c, updatedAt:d, ...other } = post;
      const { contentHtml:e, contentJson:g, contentMarkdown:h, updatedAt:i, ...previous } = before;
      assert.deepEqual(other, previous);
    }
    assert.equal(f.posts.get('placed')!.contentHtml, '<p>Avant</p>' + makeBanner({ source: '<b>Nouvelle bannière</b>' }) + '<p>Après</p>' + ordinary);
  } finally { await f.app.close(); }
});

test('4-7,10: real save route persists moved position and exact source, bulk replacement and single-article deletion', async () => {
  const f = await affiliateFixture();
  try {
    await f.apply(['empty', 'empty2']);
    const others = structuredClone([...f.posts.entries()].filter(([id]) => id !== 'empty'));
    const moved = '<p>Avant</p>' + makeBanner({ source: demoSource }) + '<p>Après</p>' + ordinary;
    let response = await f.save(f.posts.get('empty')!, moved);
    assert.equal(response.statusCode, 200, response.body);
    const loaded = await f.app.inject({ url: '/admin-api/posts/empty', headers: f.headers });
    assert.equal(loaded.json().data.contentHtml, moved);
    assert.equal(getBanners(loaded.json().data.contentJson.html)[0].source, demoSource);
    assert.deepEqual([...f.posts.entries()].filter(([id]) => id !== 'empty'), others);
    assert.equal((await f.apply(['empty'], '<span>Remplacement en lot</span>')).json().data.modified, 1);
    assert.equal(f.posts.get('empty')!.contentHtml, '<p>Avant</p>' + makeBanner({ source: '<span>Remplacement en lot</span>' }) + '<p>Après</p>' + ordinary);
    response = await f.save(f.posts.get('empty')!, '<p>Avant</p><p>Après</p>' + ordinary);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(getBanners(f.posts.get('empty')!.contentHtml).length, 0);
    assert.deepEqual([...f.posts.entries()].filter(([id]) => id !== 'empty'), others);
  } finally { await f.app.close(); }
});

test('11: stale editor and racing manual save cannot overwrite a recent bulk banner', async () => {
  const f = await affiliateFixture();
  try {
    const stale = structuredClone(f.posts.get('empty')!);
    await f.apply(['empty']);
    assert.equal((await f.save(stale, '<p>Old editor content</p>')).statusCode, 409);
    const current = structuredClone(f.posts.get('empty')!);
    f.conflictSave();
    assert.equal((await f.save(current, '<p>Concurrent save</p>')).statusCode, 409);
    assert.equal(getBanners(f.posts.get('empty')!.contentHtml)[0].source, demoSource);
  } finally { await f.app.close(); }
});

test('11: exhausted concurrency, partial database failure and retry without duplicate banners', async () => {
  const f = await affiliateFixture();
  try {
    f.errors.add('empty2'); f.conflictBulk(3);
    let response = await f.apply(['empty', 'empty2', 'placed', 'ambiguous', 'missing']);
    assert.equal(response.json().data.modified, 1); assert.equal(response.json().data.failed, 4);
    assert.equal(getBanners(f.posts.get('ambiguous')!.contentHtml).length, 2);
    f.errors.clear();
    response = await f.apply(['empty', 'empty2', 'placed']);
    assert.equal(response.json().data.modified, 2); assert.equal(response.json().data.unchanged, 1);
    assert.ok(f.posts.get('empty')!.contentHtml.startsWith('<p>Modification concurrente</p>'));
    for (const id of ['empty', 'empty2', 'placed']) assert.equal(getBanners(f.posts.get(id)!.contentHtml).length, 1);
  } finally { await f.app.close(); }
});

test('11: contradictory HTML and JSON are reported without discarding either version', async () => {
  const f = await affiliateFixture();
  try {
    f.posts.get('empty')!.contentJson.html = '<p>Different structured content</p>';
    const before = structuredClone(f.posts.get('empty'));
    const response = await f.apply(['empty', 'empty2']);
    assert.equal(response.json().data.failed, 1); assert.equal(response.json().data.modified, 1);
    assert.deepEqual(f.posts.get('empty'), before);
  } finally { await f.app.close(); }
});

test('7: a full 100000-character Unicode code remains editable after URI encoding', async () => {
  const f = await affiliateFixture();
  try {
    const source = '😀'.repeat(50000);
    assert.equal((await f.apply(['empty'], source)).json().data.modified, 1);
    const post = f.posts.get('empty')!;
    const response = await f.save(post, post.contentHtml);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(getBanners(f.posts.get('empty')!.contentHtml)[0].source, source);
  } finally { await f.app.close(); }
});
