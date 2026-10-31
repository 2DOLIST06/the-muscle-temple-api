import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { PrismaClient } from '@prisma/client';
import { newsletterAccountRoutes } from '../src/routes/public/newsletter-account.js';
import { publicAuthRoutes } from '../src/routes/public/auth.js';
import { env } from '../src/config/env.js';

async function setup() {
  const users: any[] = [],
    subs: any[] = [],
    prefs = new Map<string, any>(),
    goals = new Map<string, string[]>();
  let sequence = 0;
  const match = (row: any, where: any): boolean =>
    Object.entries(where).every(([key, value]: any) =>
      key === 'OR'
        ? value.some((part: any) => match(row, part))
        : value && typeof value === 'object' && 'lt' in value
          ? row[key] < value.lt
          : value && typeof value === 'object' && 'gt' in value
            ? row[key] > value.gt
            : row[key] === value,
    );
  const hydrate = (s: any) =>
    s
      ? { ...s, preferences: prefs.get(s.id), goals: (goals.get(s.id) || []).map((goal) => ({ goal })) }
      : null;
  const db: any = {
    user: {
      findUnique: async ({ where }: any) => users.find((u) => match(u, where)) || null,
      findUniqueOrThrow: async ({ where }: any) => {
        const u = users.find((u) => match(u, where));
        if (!u) throw Error('missing user');
        return u;
      },
      findFirst: async ({ where }: any) => users.find((u) => match(u, where)) || null,
      create: async ({ data }: any) => {
        const u = {
          id: 'user-' + ++sequence,
          sessionVersion: 0,
          emailVerifiedAt: null,
          loginLinkRequestedAt: null,
          ...data,
        };
        users.push(u);
        return u;
      },
      update: async ({ where, data }: any) => {
        const u = users.find((u) => match(u, where));
        Object.assign(u, data);
        return u;
      },
      updateMany: async ({ where, data }: any) => {
        const u = users.find((u) => match(u, where));
        if (!u) return { count: 0 };
        const v = u.sessionVersion;
        Object.assign(u, data);
        if (data.sessionVersion) u.sessionVersion = v + data.sessionVersion.increment;
        return { count: 1 };
      },
      upsert: async ({ where, create }: any) =>
        users.find((u) => match(u, where)) || db.user.create({ data: create }),
    },
    newsletterSubscriber: {
      findUnique: async ({ where }: any) => hydrate(subs.find((s) => match(s, where))),
      findUniqueOrThrow: async ({ where }: any) => hydrate(subs.find((s) => match(s, where))),
      create: async ({ data }: any) => {
        const s = { id: 'sub-' + ++sequence, ...data };
        subs.push(s);
        if (data.preferences)
          prefs.set(s.id, {
            newArticles: true,
            strengthTraining: true,
            workoutPrograms: true,
            nutrition: true,
            supplements: true,
            equipment: true,
            tools: true,
            guides: true,
            frequency: 'weekly',
          });
        return s;
      },
      update: async ({ where, data }: any) => {
        const s = subs.find((s) => match(s, where));
        Object.assign(s, data);
        return hydrate(s);
      },
    },
    newsletterPreference: {
      upsert: async ({ where, create, update }: any) =>
        prefs.set(
          where.subscriberId,
          prefs.has(where.subscriberId) ? { ...prefs.get(where.subscriberId), ...update } : create,
        ),
    },
    newsletterSubscriberGoal: {
      deleteMany: async ({ where }: any) => goals.set(where.subscriberId, []),
      createMany: async ({ data }: any) => {
        if (data.length)
          goals.set(
            data[0].subscriberId,
            data.map((x: any) => x.goal),
          );
      },
    },
    $transaction: async (fn: any) => fn(db),
  };
  Object.assign(env, {
    FRONTEND_URL: 'https://bodytrainingguide.com',
    BREVO_API_KEY: 'test',
    BREVO_SENDER_EMAIL: 'test@example.com',
    BREVO_SENDER_NAME: 'BTG',
  });
  const messages: any[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    messages.push(JSON.parse(init!.body as string));
    return new Response('{}', { status: 201 });
  };
  const app = Fastify();
  app.decorate('prisma', db as PrismaClient);
  await app.register(jwt, { secret: 'test-secret-that-is-at-least-32-characters' });
  app.setErrorHandler((err, _req, reply) =>
    reply.code(err instanceof ZodError ? 400 : 500).send({ message: err.message }),
  );
  await app.register(newsletterAccountRoutes, { prefix: '/api' });
  await app.register(publicAuthRoutes, { prefix: '/api' });
  await app.ready();
  const call = (path: string, payload?: any, token?: string) =>
    app.inject({
      url: '/api/auth/' + path,
      method: payload === undefined ? 'GET' : 'POST',
      ...(payload === undefined ? {} : { payload }),
      headers: token ? { authorization: 'Bearer ' + token } : {},
    });
  const signup = (email = 'new@example.com') =>
    call('newsletter/start', {
      email,
      language: 'fr',
      source: 'footer',
      consent: true,
      consentTextVersion: 'v2',
    });
  return {
    app,
    db,
    users,
    subs,
    prefs,
    messages,
    call,
    signup,
    close: async () => {
      globalThis.fetch = previous;
      await app.close();
    },
  };
}
const selection = {
  topics: {
    new_articles: false,
    strength_training: true,
    workout_programs: false,
    nutrition: true,
    supplements: false,
    equipment: false,
    tools: false,
    guides: false,
  },
  goals: ['strength'],
  frequency: 'monthly',
  language: 'fr',
  consent: true,
};
test('new newsletter signup immediately opens its one account; saved choices survive password and email sign-in', async () => {
  const f = await setup();
  try {
    const start = await f.signup();
    assert.equal(start.statusCode, 201);
    const result = start.json();
    assert.equal(result.authenticated, true);
    assert.equal(f.users[0].emailVerifiedAt, null);
    assert.equal(f.users[0].newsletterSubscriberId, f.subs[0].id);
    assert.equal(f.subs[0].status, 'active');
    assert.ok(!('passwordHash' in result.user));
    assert.equal(
      (await f.call('newsletter/settings', undefined, result.token)).json().data.topics.nutrition,
      true,
    );
    assert.equal((await f.call('newsletter/settings', selection, result.token)).statusCode, 200);
    const initial = (await f.call('newsletter/settings', undefined, result.token)).json().data;
    assert.deepEqual(initial.topics, selection.topics);
    const password = 'FuturePassword123!';
    const changed = await f.call('password', { password }, result.token);
    assert.equal(changed.statusCode, 200);
    assert.equal((await f.call('newsletter/settings', undefined, result.token)).statusCode, 401);
    const signed = await f.call('login', { email: ' NEW@EXAMPLE.COM ', password });
    assert.equal(signed.statusCode, 200);
    assert.deepEqual(
      (await f.call('newsletter/settings', undefined, signed.json().token)).json().data,
      initial,
    );
    f.users[0].loginLinkRequestedAt = null;
    await f.call('login-link', { email: 'new@example.com', locale: 'fr' });
    const link = new URL(f.messages.at(-1).textContent.split('\n')[0].replace('Me connecter: ', ''));
    const consumed = await f.call('login-link/consume', { token: link.hash.slice(1) });
    assert.equal(consumed.statusCode, 200);
    assert.equal(f.app.jwt.verify<any>(consumed.json().token).userId, result.user.id);
    assert.deepEqual(
      (await f.call('newsletter/settings', undefined, consumed.json().token)).json().data,
      initial,
    );
  } finally {
    await f.close();
  }
});
test('known addresses and legacy subscribers never disclose a session or preferences from email alone', async () => {
  const f = await setup();
  try {
    await f.db.user.create({ data: { email: 'known@example.com', role: 'USER', passwordHash: 'private' } });
    await f.db.newsletterSubscriber.create({
      data: {
        email: 'legacy@example.com',
        status: 'active',
        preferencesToken: 'legacy-preferences-token-long-enough',
        language: 'en',
      },
    });
    for (const email of ['known@example.com', 'legacy@example.com']) {
      const r = await f.signup(email);
      assert.equal(r.json().status, 'existing');
      assert.equal(r.json().authenticated, false);
      assert.equal(r.json().token, undefined);
      assert.equal(r.json().preferencesToken, undefined);
    }
    assert.equal(f.messages.length, 0);
    assert.equal(f.subs.length, 1);
    await f.call('login-link', { email: 'legacy@example.com', locale: 'en' });
    assert.equal(f.users.length, 2);
    assert.equal(f.messages.length, 1);
    const legacy = f.users.find((u) => u.email === 'legacy@example.com');
    const unverified = f.app.jwt.sign({
      userId: legacy.id,
      email: legacy.email,
      role: 'USER',
      sessionVersion: 0,
    });
    assert.equal((await f.call('newsletter/settings', undefined, unverified)).statusCode, 403);
  } finally {
    await f.close();
  }
});
test('one account cannot edit another; unsubscribe and reactivation require explicit authenticated choices', async () => {
  const f = await setup();
  try {
    const one = (await f.signup('one@example.com')).json(),
      two = (await f.signup('two@example.com')).json();
    assert.equal((await f.call('newsletter/settings', selection)).statusCode, 401);
    assert.equal(
      (await f.call('newsletter/settings', { ...selection, email: 'two@example.com' }, one.token)).statusCode,
      400,
    );
    await f.call('newsletter/settings', selection, one.token);
    assert.equal(
      (await f.call('newsletter/settings', undefined, two.token)).json().data.topics.new_articles,
      true,
    );
    await f.call('newsletter/unsubscribe', {}, one.token);
    assert.equal((await f.call('newsletter/settings', undefined, one.token)).json().data.unsubscribed, true);
    assert.equal((await f.call('newsletter/settings', selection, one.token)).statusCode, 409);
    assert.equal(
      (await f.call('newsletter/settings', { ...selection, reactivate: true }, one.token)).statusCode,
      200,
    );
    assert.equal((await f.call('newsletter/settings', undefined, one.token)).json().data.unsubscribed, false);
    f.subs[0].status = 'complained';
    assert.equal((await f.call('newsletter/settings', selection, one.token)).statusCode, 409);
  } finally {
    await f.close();
  }
});
test('welcome delivery failure keeps subscription and session, duplicates do not send welcome again', async () => {
  const f = await setup();
  try {
    globalThis.fetch = async () => {
      throw Error('offline');
    };
    const r = await f.signup();
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().email_sent, false);
    assert.equal((await f.call('newsletter/settings', undefined, r.json().token)).statusCode, 200);
    assert.equal((await f.signup()).json().status, 'existing');
    assert.equal(f.subs.length, 1);
  } finally {
    await f.close();
  }
});
test('expired links resend in place; resend capabilities can never authenticate as members', async () => {
  const f = await setup();
  try {
    await f.signup();
    const welcome = f.messages[0].textContent;
    const raw = welcome.match(/https:\/\/[^\s]+\/fr\/connexion\/lien#[^\s]+/)[0];
    const token = new URL(raw).hash.slice(1);
    f.users[0].loginTokenExpiresAt = new Date(0);
    assert.equal((await f.call('login-link/consume', { token })).statusCode, 401);
    f.users[0].loginLinkRequestedAt = null;
    const resend = await f.call('login-link/resend', { token, locale: 'en' });
    assert.equal(resend.statusCode, 200);
    assert.equal(f.messages.length, 2);
    assert.match(f.messages[1].textContent, /\/login\/link#/);
    assert.equal((await f.call('newsletter/settings', undefined, token.split('~')[1])).statusCode, 403);
    assert.equal((await f.call('login-link/resend', { token, locale: 'en' })).statusCode, 429);
  } finally {
    await f.close();
  }
});

test('password registration opens the same account and only subscribes after explicit preferences are saved', async () => {
  const f = await setup();
  try {
    const registered = await f.call('register', {email:'password@example.com',password:'ChosenPassword123!',displayName:'Member'});
    assert.equal(registered.statusCode,201);
    const token=registered.json().token;
    assert.equal((await f.call('me',undefined,token)).json().data.email,'password@example.com');
    assert.equal((await f.call('newsletter/settings',undefined,token)).json().data.subscribed,false);
    assert.equal(f.subs.length,0);
    assert.equal((await f.call('newsletter/settings',selection,token)).statusCode,200);
    assert.equal(f.subs.length,1);
    assert.equal(f.users[0].newsletterSubscriberId,f.subs[0].id);
  } finally { await f.close(); }
});
