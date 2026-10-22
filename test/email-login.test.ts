import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole } from '@prisma/client';
import { ZodError } from 'zod';
import { publicAuthRoutes } from '../src/routes/public/auth.js';
import { env } from '../src/config/env.js';

test('email login is single-use, expires, excludes admins and rotates password sessions', async () => {
  Object.assign(env, { FRONTEND_URL: 'https://www.bodytrainingguide.com', BREVO_API_KEY: 'test', BREVO_SENDER_EMAIL: 'test@example.com', BREVO_SENDER_NAME: 'BTG' });
  const member = { id: 'member', email: 'user@example.com', role: UserRole.USER, sessionVersion: 0, passwordHash: await bcrypt.hash('OriginalPassword!', 4), loginTokenHash: null as string | null, loginTokenExpiresAt: null as Date | null, loginLinkRequestedAt: null as Date | null };
  const admin = { ...member, id: 'admin', email: 'admin@example.com', role: UserRole.ADMIN };
  const users = [member, admin];
  const user = {
    async findUnique({ where }: any) { return users.find(u => Object.entries(where).every(([key, value]) => (u as any)[key] === value)) ?? null; },
    async findFirst({ where }: any) { return this.findUnique({ where }); },
    async updateMany({ where, data }: any) {
      const found = users.find(u => (!where.id || u.id === where.id) && (!where.role || u.role === where.role) && (where.sessionVersion === undefined || u.sessionVersion === where.sessionVersion) && (!where.loginTokenHash || u.loginTokenHash === where.loginTokenHash) && (!where.loginTokenExpiresAt || (u.loginTokenExpiresAt && u.loginTokenExpiresAt > where.loginTokenExpiresAt.gt)) && (!where.OR || !u.loginLinkRequestedAt || u.loginLinkRequestedAt < where.OR[1].loginLinkRequestedAt.lt));
      if (!found) return { count: 0 };
      const version = found.sessionVersion;
      Object.assign(found, data);
      if (data.sessionVersion) found.sessionVersion = version + data.sessionVersion.increment;
      return { count: 1 };
    }
  };
  const prisma = { user, async $transaction(callback: any) { return callback({ user }); } } as unknown as PrismaClient;
  const app = Fastify(); app.decorate('prisma', prisma);
  await app.register(jwt, { secret: 'test-secret-that-is-at-least-32-characters' });
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof ZodError ? 400 : 500).send({ message: error.message }));
  await app.register(publicAuthRoutes, { prefix: '/api' });
  const originalFetch = globalThis.fetch; const messages: any[] = [];
  globalThis.fetch = async (_url, init) => { messages.push(JSON.parse(init!.body as string)); return new Response('{}', { status: 201 }); };
  try {
    const post = (path: string, payload: any, token?: string) => app.inject({ method: 'POST', url: `/api/auth/${path}`, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
    const login = await post('login', { email: member.email, password: 'OriginalPassword!' });
    const oldSession = login.json().token;
    for (const email of ['missing@example.com', admin.email, member.email]) assert.deepEqual((await post('login-link', { email, locale: 'fr' })).json(), { ok: true });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].subject, 'Votre lien de connexion Body Training Guide');
    const link = messages[0].textContent.split('\n')[0].replace('Me connecter: ', '');
    const token = new URL(link).hash.slice(1);
    assert.equal(member.loginTokenHash, createHash('sha256').update(token).digest('hex'));
    assert.notEqual(member.loginTokenHash, token);
    await post('login-link', { email: member.email }); assert.equal(messages.length, 1, 'cooldown');
    assert.equal((await post('login-link/consume', { token: '0'.repeat(64) })).statusCode, 401);
    const consumed = await post('login-link/consume', { token }); assert.equal(consumed.statusCode, 200);
    assert.equal((await post('login-link/consume', { token })).statusCode, 401, 'replay rejected');
    const session = consumed.json().token;
    assert.equal((await post('password', { password: 'NewPassword123!' })).statusCode, 401);
    assert.equal((await post('password', { password: 'short' }, session)).statusCode, 400);
    const changed = await post('password', { password: 'NewPassword123!' }, session); assert.equal(changed.statusCode, 200);
    assert.equal(await bcrypt.compare('NewPassword123!', member.passwordHash), true);
    for (const t of [oldSession, session]) assert.equal((await app.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${t}` } })).statusCode, 401);
    assert.equal((await app.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${changed.json().token}` } })).statusCode, 200);
    assert.equal((await post('login', { email: member.email, password: 'OriginalPassword!' })).statusCode, 401);
    member.loginLinkRequestedAt = null;
    await post('login-link', { email: member.email, locale: 'en' });
    const expired = new URL(messages[1].textContent.split('\n')[0].replace('Sign in: ', '')).hash.slice(1);
    member.loginTokenExpiresAt = new Date(0);
    assert.equal((await post('login-link/consume', { token: expired })).statusCode, 401);
    member.loginLinkRequestedAt = null;
    globalThis.fetch = async () => { throw new Error('provider unavailable'); };
    assert.equal((await post('login-link', { email: member.email })).statusCode, 200);
    assert.equal(member.loginTokenHash, null, 'failed sends invalidate the token');
  } finally { globalThis.fetch = originalFetch; await app.close(); }
});
