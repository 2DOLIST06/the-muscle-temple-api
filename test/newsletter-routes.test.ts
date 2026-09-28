import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

process.env.FRONTEND_URL = 'https://bodytrainingguide.com';
process.env.BREVO_API_KEY = 'test-api-key';
process.env.BREVO_SENDER_EMAIL = 'newsletter@bodytrainingguide.com';
process.env.BREVO_SENDER_NAME = 'Body Training Guide';

type Subscriber = {
  id: string;
  email: string;
  status: 'active' | 'unsubscribed';
  language: 'fr' | 'en';
  source: string;
  consentAt: Date;
  consentTextVersion: string;
  consentSource: string;
  confirmedAt: Date;
  unsubscribedAt: Date | null;
  confirmationToken: string;
  preferencesToken: string;
};

const defaults = () => ({
  newArticles: true,
  strengthTraining: true,
  workoutPrograms: true,
  nutrition: true,
  supplements: true,
  equipment: true,
  tools: true,
  guides: true,
  frequency: 'weekly' as const
});

function createPrismaFixture() {
  const subscribers: Subscriber[] = [];
  const preferences = new Map<string, ReturnType<typeof defaults>>();
  const goals = new Map<string, string[]>();
  let sequence = 0;

  const hydrate = (subscriber: Subscriber) => ({
    ...subscriber,
    preferences: preferences.get(subscriber.id) ?? null,
    goals: (goals.get(subscriber.id) ?? []).map((goal) => ({ goal }))
  });
  const findSubscriber = (where: Record<string, string>) => subscribers.find((item) =>
    Object.entries(where).every(([key, value]) => item[key as keyof Subscriber] === value)
  );

  const prisma = {
    newsletterSubscriber: {
      findUnique: async ({ where }: { where: Record<string, string> }) => {
        const subscriber = findSubscriber(where);
        return subscriber ? hydrate(subscriber) : null;
      },
      findUniqueOrThrow: async ({ where }: { where: Record<string, string> }) => {
        const subscriber = findSubscriber(where);
        if (!subscriber) throw new Error('not found');
        return hydrate(subscriber);
      },
      create: async ({ data }: { data: Omit<Subscriber, 'id' | 'unsubscribedAt'> }) => {
        const subscriber = { id: `subscriber-${++sequence}`, unsubscribedAt: null, ...data };
        subscribers.push(subscriber);
        return subscriber;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Subscriber> }) => {
        const subscriber = findSubscriber(where);
        if (!subscriber) throw new Error('not found');
        Object.assign(subscriber, data);
        return subscriber;
      }
    },
    newsletterPreference: {
      upsert: async ({ where, create, update }: {
        where: { subscriberId: string };
        create: Record<string, unknown>;
        update: Partial<ReturnType<typeof defaults>>;
      }) => {
        const current = preferences.get(where.subscriberId);
        preferences.set(where.subscriberId, current ? { ...current, ...update } : { ...defaults(), ...create });
      }
    },
    newsletterSubscriberGoal: {
      deleteMany: async ({ where }: { where: { subscriberId: string } }) => goals.set(where.subscriberId, []),
      createMany: async ({ data }: { data: Array<{ subscriberId: string; goal: string }> }) => {
        if (data.length) goals.set(data[0].subscriberId, [...new Set(data.map(({ goal }) => goal))]);
      }
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
  };

  return { prisma, subscribers, preferences, goals };
}

test('newsletter lifecycle preserves data, maps API keys, and isolates Brevo failures', async () => {
  const originalFetch = globalThis.fetch;
  const brevoRequests: Array<Record<string, unknown>> = [];
  let failBrevo = false;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    brevoRequests.push(JSON.parse(String(init?.body)));
    return new Response('', { status: failBrevo ? 503 : 201 });
  }) as typeof fetch;

  const fixture = createPrismaFixture();
  const app = Fastify({ logger: false });
  app.decorate('prisma', fixture.prisma);
  const { newsletterRoutes } = await import('../src/routes/public/newsletter.js');
  await app.register(newsletterRoutes, { prefix: '/api' });

  const subscription = {
    email: ' READER@Example.COM ',
    language: 'fr',
    source: 'footer',
    consent: true,
    consentTextVersion: '2026-09'
  };

  try {
    const created = await app.inject({ method: 'POST', url: '/api/newsletter/subscribe', payload: subscription });
    assert.equal(created.statusCode, 200);
    assert.equal(fixture.subscribers.length, 1);
    assert.equal(fixture.subscribers[0].email, 'reader@example.com');
    assert.equal(fixture.subscribers[0].status, 'active');
    assert.ok(fixture.subscribers[0].consentAt);
    assert.ok(fixture.subscribers[0].confirmedAt);
    assert.equal(fixture.subscribers[0].consentSource, 'footer');
    assert.equal(brevoRequests.length, 1);

    const token = fixture.subscribers[0].preferencesToken;
    const firstToken = token;
    const initial = await app.inject({ method: 'GET', url: `/api/newsletter/preferences?token=${token}` });
    assert.equal(initial.statusCode, 200);
    assert.deepEqual(initial.json().data, {
      language: 'fr',
      topics: {
        new_articles: true,
        strength_training: true,
        workout_programs: true,
        nutrition: true,
        supplements: true,
        equipment: true,
        tools: true,
        guides: true
      },
      goals: [],
      frequency: 'weekly',
      unsubscribed: false
    });

    const update = await app.inject({
      method: 'PUT',
      url: '/api/newsletter/preferences',
      payload: {
        token,
        topics: { new_articles: false, strength_training: false, workout_programs: false },
        frequency: 'monthly',
        goals: ['strength', 'strength', 'fat_loss']
      }
    });
    assert.equal(update.statusCode, 200);
    assert.equal(update.json().data.topics.new_articles, false);
    assert.deepEqual(update.json().data.goals, ['strength', 'fat_loss']);

    const duplicate = await app.inject({ method: 'POST', url: '/api/newsletter/subscribe', payload: subscription });
    assert.equal(duplicate.statusCode, 200);
    assert.equal(fixture.subscribers.length, 1);
    assert.equal(brevoRequests.length, 1);
    assert.equal(fixture.preferences.get(fixture.subscribers[0].id)?.newArticles, false);

    const unsubscribed = await app.inject({
      method: 'POST', url: '/api/newsletter/unsubscribe', payload: { token }
    });
    assert.equal(unsubscribed.statusCode, 200);
    assert.equal(fixture.subscribers[0].status, 'unsubscribed');
    assert.ok(fixture.subscribers[0].unsubscribedAt);
    assert.equal(fixture.preferences.get(fixture.subscribers[0].id)?.newArticles, false);

    failBrevo = true;
    const resubscribed = await app.inject({ method: 'POST', url: '/api/newsletter/subscribe', payload: subscription });
    assert.equal(resubscribed.statusCode, 200);
    assert.equal(fixture.subscribers[0].status, 'active');
    assert.equal(fixture.subscribers[0].unsubscribedAt, null);
    assert.equal(fixture.subscribers[0].preferencesToken, firstToken);
    assert.equal(fixture.preferences.get(fixture.subscribers[0].id)?.newArticles, false);
    assert.equal(brevoRequests.length, 2);

    const invalidToken = await app.inject({
      method: 'GET', url: `/api/newsletter/preferences?token=${'x'.repeat(43)}`
    });
    assert.equal(invalidToken.statusCode, 404);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});
