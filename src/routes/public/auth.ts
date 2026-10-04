import { Prisma, UserRole } from '@prisma/client';
import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { requireUserAuth } from '../../lib/auth.js';
import { publicLoginSchema, publicRegisterSchema } from '../../validation/auth.js';

const safeUserSelect = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  createdAt: true,
  updatedAt: true
} as const;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export const publicAuthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/auth/register', async (request, reply) => {
    const body = publicRegisterSchema.parse(request.body);
    const email = normalizeEmail(body.email);
    const existingUser = await fastify.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) return reply.code(409).send({ message: 'Email already in use' });
    const passwordHash = await bcrypt.hash(body.password, 10);

    try {
      const user = await fastify.prisma.user.create({
        data: {
          email,
          passwordHash,
          displayName: body.displayName,
          role: UserRole.USER
        },
        select: safeUserSelect
      });
      return reply.code(201).send({ data: user });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.code(409).send({ message: 'Email already in use' });
      }
      throw error;
    }
  });

  fastify.post('/auth/login', async (request, reply) => {
    const body = publicLoginSchema.parse(request.body);
    const email = normalizeEmail(body.email);
    const user = await fastify.prisma.user.findUnique({ where: { email } });
    const isValid = user ? await bcrypt.compare(body.password, user.passwordHash) : false;

    if (!user || !isValid || user.role !== UserRole.USER) {
      return reply.code(401).send({ message: 'Invalid credentials' });
    }

    const token = await reply.jwtSign(
      { userId: user.id, email: user.email, role: user.role },
      { expiresIn: '12h' }
    );
    return {
      token,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }
      }
    };
  });

  fastify.get('/auth/me', { preHandler: requireUserAuth }, async (request, reply) => {
    const user = await fastify.prisma.user.findFirst({
      where: { id: request.authenticatedUser.userId, role: UserRole.USER },
      select: safeUserSelect
    });
    if (!user) return reply.code(401).send({ message: 'Unauthorized' });
    return { data: user };
  });
};
