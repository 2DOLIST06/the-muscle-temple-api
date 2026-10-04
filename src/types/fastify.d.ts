import 'fastify';
import { UserRole } from '@prisma/client';

declare module 'fastify' {
  interface FastifyRequest {
    authenticatedUser: {
      userId: string;
      email: string;
      role: UserRole;
    };
    adminUser: {
      userId: string;
      email: string;
      role: UserRole;
    };
  }
}
