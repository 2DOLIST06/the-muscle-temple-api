import 'fastify';
import { UserRole } from '@prisma/client';

declare module 'fastify' {
  interface FastifyRequest {
    authenticatedUser: {
      userId: string;
      email: string;
      role: UserRole;
      sessionVersion?: number;
    };
    adminUser: {
      userId: string;
      email: string;
      role: UserRole;
      sessionVersion?: number;
    };
  }
}
