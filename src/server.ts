import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { env } from './config/env.js';
import { prisma } from './db/client.js';
import { publicRoutes } from './routes/public/index.js';
import { adminApiRoutes } from './routes/admin/api.js';
import { adminPanelRoutes } from './routes/admin/panel.js';

const app = Fastify({ logger: true });

app.decorate('prisma', prisma);

app.register(cors, { origin: env.CORS_ORIGIN });
app.register(cookie);
app.register(jwt, { secret: env.JWT_SECRET });

app.register(publicRoutes, { prefix: '/api' });
app.register(adminApiRoutes, { prefix: '/admin-api' });
app.register(adminPanelRoutes);

app.addHook('onClose', async () => {
  await prisma.$disconnect();
});

const start = async () => {
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
