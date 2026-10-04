import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole } from '@prisma/client';
import { ZodError } from 'zod';
import { adminApiRoutes } from '../src/routes/admin/api.js';
import { publicAuthRoutes } from '../src/routes/public/auth.js';

const password = 'StrongPassword123!';

type TestUser = {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
};

function user(id: string, role: UserRole, passwordHash: string): TestUser {
  return {
    id,
    email: `${role.toLowerCase()}@example.com`,
    passwordHash,
    role,
    displayName: role,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z')
  };
}

function serializeUser(value: TestUser) {
  const { passwordHash: _passwordHash, ...safeUser } = value;
  return safeUser;
}

function buildPrisma(users: TestUser[]) {
  return {
    user: {
      async findUnique(args: { where: { email?: string; id?: string }; select?: object }) {
        const found = users.find((item) => item.email === args.where.email || item.id === args.where.id);
        if (!found) return null;
        return args.select ? serializeUser(found) : found;
      },
      async findFirst(args: { where: { id: string; role: UserRole } }) {
        const found = users.find((item) => item.id === args.where.id && item.role === args.where.role);
        return found ? serializeUser(found) : null;
      },
      async create(args: { data: { email: string; passwordHash: string; role: UserRole; displayName: string } }) {
        const created: TestUser = {
          id: `user-${users.length + 1}`,
          ...args.data,
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z')
        };
        users.push(created);
        return serializeUser(created);
      }
    }
  } as unknown as PrismaClient;
}

function configureApp(prisma: PrismaClient) {
  const app = Fastify({ logger: false });
  app.decorate('prisma', prisma);
  app.register(jwt, { secret: 'test-secret-that-is-at-least-32-characters' });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ message: error.issues[0]?.message });
    return reply.code(500).send({ message: 'Internal server error' });
  });
  return app;
}

test('admin authentication accepts ADMIN and EDITOR but rejects USER at login and guard', async () => {
  const passwordHash = await bcrypt.hash(password, 4);
  const users = [
    user('admin-1', UserRole.ADMIN, passwordHash),
    user('editor-1', UserRole.EDITOR, passwordHash),
    user('member-1', UserRole.USER, passwordHash)
  ];
  const app = configureApp(buildPrisma(users));
  await app.register(adminApiRoutes, { prefix: '/admin-api' });
  const tokens = new Map<UserRole, string>();

  for (const role of [UserRole.ADMIN, UserRole.EDITOR]) {
    const response = await app.inject({
      method: 'POST',
      url: '/admin-api/auth/login',
      payload: { email: `${role.toLowerCase()}@example.com`, password }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.user.role, role);
    assert.equal('passwordHash' in response.json().data.user, false);
    tokens.set(role, response.json().token);

    const me = await app.inject({
      method: 'GET',
      url: '/admin-api/me',
      headers: { authorization: `Bearer ${response.json().token}` }
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().data.role, role);
    assert.equal('passwordHash' in me.json().data, false);
  }

  const createdByAdmin = await app.inject({
    method: 'POST',
    url: '/admin-api/users',
    headers: { authorization: `Bearer ${tokens.get(UserRole.ADMIN)}` },
    payload: { email: 'second-editor@example.com', password, displayName: 'Second Editor', role: UserRole.EDITOR }
  });
  assert.equal(createdByAdmin.statusCode, 200);
  assert.equal('passwordHash' in createdByAdmin.json().data, false);

  const editorCreatingUser = await app.inject({
    method: 'POST',
    url: '/admin-api/users',
    headers: { authorization: `Bearer ${tokens.get(UserRole.EDITOR)}` },
    payload: { email: 'forbidden@example.com', password, displayName: 'Forbidden', role: UserRole.EDITOR }
  });
  assert.equal(editorCreatingUser.statusCode, 403);

  const memberLogin = await app.inject({
    method: 'POST',
    url: '/admin-api/auth/login',
    payload: { email: 'user@example.com', password }
  });
  assert.equal(memberLogin.statusCode, 401);
  assert.deepEqual(memberLogin.json(), { message: 'Invalid credentials' });

  const memberToken = app.jwt.sign({ userId: 'member-1', email: 'user@example.com', role: UserRole.USER });
  const guarded = await app.inject({
    method: 'GET',
    url: '/admin-api/me',
    headers: { authorization: `Bearer ${memberToken}` }
  });
  assert.equal(guarded.statusCode, 403);
  await app.close();
});

test('public authentication registers and authenticates only USER accounts without exposing password hashes', async () => {
  const passwordHash = await bcrypt.hash(password, 4);
  const users = [
    user('admin-1', UserRole.ADMIN, passwordHash),
    user('editor-1', UserRole.EDITOR, passwordHash)
  ];
  const app = configureApp(buildPrisma(users));
  await app.register(publicAuthRoutes, { prefix: '/api' });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: '  MEMBER@EXAMPLE.COM ', password, displayName: 'Member', role: UserRole.ADMIN }
  });
  assert.equal(registered.statusCode, 400, 'unknown role input must be rejected');

  const created = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: '  MEMBER@EXAMPLE.COM ', password, displayName: 'Member' }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().data.email, 'member@example.com');
  assert.equal(created.json().data.role, UserRole.USER);
  assert.equal('passwordHash' in created.json().data, false);

  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'member@example.com', password, displayName: 'Other' }
  });
  assert.equal(duplicate.statusCode, 409);

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'MEMBER@example.com', password }
  });
  assert.equal(login.statusCode, 200);
  const payload = app.jwt.decode<{ userId: string; email: string; role: UserRole }>(login.json().token);
  assert.equal(payload.userId, created.json().data.id);
  assert.equal(payload.email, 'member@example.com');
  assert.equal(payload.role, UserRole.USER);
  assert.equal('passwordHash' in login.json().data.user, false);

  const me = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: `Bearer ${login.json().token}` }
  });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().data.id, created.json().data.id);
  assert.equal('passwordHash' in me.json().data, false);

  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode, 401);
  assert.equal((await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { email: 'member@example.com', password: 'WrongPassword!' }
  })).statusCode, 401);

  for (const role of [UserRole.ADMIN, UserRole.EDITOR]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: `${role.toLowerCase()}@example.com`, password }
    });
    assert.equal(response.statusCode, 401);
  }
  await app.close();
});
