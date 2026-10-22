import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { PrismaClient, UserRole } from '@prisma/client';
import { ZodError } from 'zod';
import { publicAuthRoutes } from '../src/routes/public/auth.js';

async function setup() {
  const member = { id: 'member-1', email: 'member@example.com', role: UserRole.USER, sessionVersion: 0, emailVerifiedAt: null as Date | null, firstName: null as string | null };
  let queriedEmail: string | undefined;
  const app = Fastify();
  app.decorate('prisma', {
    user: {
      findUnique: async () => member,
      findUniqueOrThrow: async () => member,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        assert.equal(where.id, member.id); Object.assign(member, data); return member;
      }
    },
    newsletterSubscriber: { findUnique: async ({ where }: { where: { email: string } }) => {
      queriedEmail = where.email;
      return { preferencesToken: 'own-preferences-token', status: 'active' };
    } }
  } as unknown as PrismaClient);
  await app.register(jwt, { secret: 'test-secret-that-is-at-least-32-characters' });
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof ZodError ? 400 : 500).send({ message: error.message }));
  await app.register(publicAuthRoutes, { prefix: '/api' }); await app.ready();
  const headers = { authorization: `Bearer ${app.jwt.sign({ userId: member.id, email: 'stale@example.com', role: member.role, sessionVersion: 0 })}` };
  return { app, member, headers, queriedEmail: () => queriedEmail };
}
const details = { firstName: ' Nicolas ', lastName: '', phone: '', address: '', postalCode: '', city: '', country: '' };
test('profile requires a valid member session, trims and clears fields, rejects account field injection', async () => {
  const { app, headers, member } = await setup();
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/profile', payload: details })).statusCode, 401);
    for (const extra of [{ id: 'someone-else' }, { email: 'other@example.com' }, { role: 'ADMIN' }]) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/profile', headers, payload: { ...details, ...extra } })).statusCode, 400);
    }
    const saved = await app.inject({ method: 'POST', url: '/api/auth/profile', headers, payload: details });
    assert.equal(saved.statusCode, 200); assert.equal(member.firstName, 'Nicolas');
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/profile', headers, payload: { ...details, firstName: '' } })).statusCode, 200);
    assert.equal(member.firstName, null);
    member.sessionVersion = 1;
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/profile', headers, payload: details })).statusCode, 401);
  } finally { await app.close(); }
});
test('newsletter access requires email ownership and uses the current member email from the database', async () => {
  const { app, headers, member, queriedEmail } = await setup();
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/api/auth/newsletter' })).statusCode, 401);
    const unverified = await app.inject({ method: 'GET', url: '/api/auth/newsletter', headers });
    assert.equal(unverified.statusCode, 403); assert.equal(unverified.json().code, 'EMAIL_VERIFICATION_REQUIRED'); assert.equal(queriedEmail(), undefined);
    member.emailVerifiedAt = new Date();
    const verified = await app.inject({ method: 'GET', url: '/api/auth/newsletter?email=victim@example.com', headers });
    assert.equal(verified.statusCode, 200); assert.equal(queriedEmail(), member.email); assert.equal(verified.json().data.token, 'own-preferences-token');
  } finally { await app.close(); }
});
