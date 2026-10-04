import { FastifyReply, FastifyRequest } from 'fastify';
import { UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: UserRole;
}

async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<AuthenticatedUser | null> {
  try {
    const payload = await request.jwtVerify<AuthenticatedUser>();
    request.authenticatedUser = payload;
    return payload;
  } catch {
    reply.code(401).send({ message: 'Unauthorized' });
    return null;
  }
}

export async function requireAdminAuth(request: FastifyRequest, reply: FastifyReply) {
  const user = await authenticate(request, reply);
  if (!user) return;
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  request.adminUser = user;
}

export async function requireUserAuth(request: FastifyRequest, reply: FastifyReply) {
  const user = await authenticate(request, reply);
  if (!user) return;
  if (user.role !== UserRole.USER) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
}

export function requireRole(roles: UserRole[]) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply) {
    if (!roles.includes(request.adminUser.role)) {
      return reply.code(403).send({ message: 'Forbidden' });
    }
  };
}
