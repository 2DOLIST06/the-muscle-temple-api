import { createHash, randomBytes } from 'node:crypto';
import { Prisma, UserRole } from '@prisma/client';
import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { sendMemberLink } from '../../lib/email/member-link.js';
import { requireUserAuth } from '../../lib/auth.js';
import { publicLoginSchema, publicRegisterSchema, loginLinkSchema, consumeLoginLinkSchema, changePasswordSchema, profileSchema } from '../../validation/auth.js';

const safeUserSelect = {
  id: true,
  email: true,
  displayName: true,
  firstName: true,
  lastName: true,
  phone: true,
  address: true,
  postalCode: true,
  city: true,
  country: true,
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
      const token=await reply.jwtSign({userId:user.id,email:user.email,role:user.role,sessionVersion:0},{expiresIn:'12h'});
      return reply.code(201).send({ token, data: user });
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
      { userId: user.id, email: user.email, role: user.role, sessionVersion: user.sessionVersion ?? 0 },
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

  // Bounded, per-process IP limiter; the per-account cooldown below is shared in PostgreSQL.
  const attempts = new Map<string, { count: number; until: number }>();
  const limited = (ip: string) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const entry = attempts.get(ip);
    if (entry) return ++entry.count > 300;
    if (attempts.size >= 10000) return true;
    attempts.set(ip, { count: 1, until: now + 15 * 60_000 });
    return false;
  };
  fastify.post('/auth/login-link', async (request, reply) => {
    const body = loginLinkSchema.parse(request.body);
    if (limited(request.ip)) return reply.code(429).send({ message: 'Please try again later' });
    let user = await fastify.prisma.user.findUnique({ where: { email: body.email } });
    if (!user && await fastify.prisma.newsletterSubscriber.findUnique({where:{email:body.email}})) {
      user = await fastify.prisma.user.upsert({where:{email:body.email},update:{},create:{email:body.email,displayName:'',passwordHash:await bcrypt.hash(randomBytes(48).toString('hex'),10),role:UserRole.USER}});
    }
    const generic = { ok: true };
    if (!user) return reply.code(404).send({ code: 'ACCOUNT_NOT_FOUND', message: 'No account with this email address' });
    if (user.role !== UserRole.USER) return reply.code(403).send({ code: 'MEMBER_ACCOUNT_REQUIRED', message: 'This address is not a member account' });
    const error = await sendMemberLink(fastify, user, body.locale);
    if (error) return reply.code(error.status).send({code:error.code,message:error.code});
    return generic;
  });
  fastify.post('/auth/login-link/resend', async (request, reply) => {
    const {token,locale} = loginLinkSchema.pick({locale:true}).merge(consumeLoginLinkSchema).parse(request.body);
    if (limited(request.ip)) return reply.code(429).send({code:'LOGIN_LINK_COOLDOWN'});
    let userId: string | undefined;
    try {
      const proof=fastify.jwt.verify<{purpose:string;userId:string;hash:string}>(token.split('~')[1] || '');
      if(proof.purpose==='member-link-resend' && proof.hash===createHash('sha256').update(token.split('~')[0]).digest('hex')) userId=proof.userId;
    } catch { /* Old tokens can still resend while their digest remains stored. */ }
    const user=await fastify.prisma.user.findUnique({where:userId?{id:userId}:{loginTokenHash:createHash('sha256').update(token.split('~')[0]).digest('hex')}});
    if(!user || user.role!==UserRole.USER) return reply.code(400).send({code:'RESEND_EMAIL_REQUIRED'});
    const error=await sendMemberLink(fastify,user,locale);
    return error?reply.code(error.status).send({code:error.code}):{ok:true};
  });
  fastify.post('/auth/login-link/consume', async (request, reply) => {
    const { token } = consumeLoginLinkSchema.parse(request.body);
    if (limited(request.ip)) return reply.code(429).send({ message: 'Please try again later' });
    const hash = createHash('sha256').update(token.split('~')[0]).digest('hex');
    const user = await fastify.prisma.$transaction(async tx => {
      const found = await tx.user.findUnique({ where: { loginTokenHash: hash } });
      if (!found || found.role !== UserRole.USER) return null;
      const consumed = await tx.user.updateMany({ where: { id: found.id, role: UserRole.USER, loginTokenHash: hash, loginTokenExpiresAt: { gt: new Date() } }, data: { loginTokenHash: null, loginTokenExpiresAt: null, emailVerifiedAt: new Date() } });
      return consumed.count === 1 ? found : null;
    });
    if (!user) return reply.code(401).send({ message: 'Invalid or expired link' });
    const session = await reply.jwtSign({ userId: user.id, email: user.email, role: user.role, sessionVersion: user.sessionVersion }, { expiresIn: '12h' });
    return { token: session };
  });
  fastify.post('/auth/password', { preHandler: requireUserAuth }, async (request, reply) => {
    const { password } = changePasswordSchema.parse(request.body);
    const passwordHash = await bcrypt.hash(password, 10);
    const updated = await fastify.prisma.user.updateMany({
      where: { id: request.authenticatedUser.userId, role: UserRole.USER, sessionVersion: request.authenticatedUser.sessionVersion ?? 0 },
      data: { passwordHash, sessionVersion: { increment: 1 }, loginTokenHash: null, loginTokenExpiresAt: null }
    });
    if (updated.count !== 1) return reply.code(401).send({ message: 'Unauthorized' });
    const user = request.authenticatedUser;
    const token = await reply.jwtSign({ userId: user.userId, email: user.email, role: user.role, sessionVersion: (user.sessionVersion ?? 0) + 1 }, { expiresIn: '12h' });
    return { token };
  });

  fastify.post('/auth/profile', { preHandler: requireUserAuth }, async (request) => {
    const body = profileSchema.parse(request.body);
    const data = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, value || null]));
    const user = await fastify.prisma.user.update({
      where: { id: request.authenticatedUser.userId }, data, select: safeUserSelect
    });
    return { data: user };
  });

  fastify.get('/auth/newsletter', { preHandler: requireUserAuth }, async (request, reply) => {
    const user = await fastify.prisma.user.findUniqueOrThrow({
      where: { id: request.authenticatedUser.userId }, select: { email: true, emailVerifiedAt: true }
    });
    // Password registration alone does not prove ownership of an existing newsletter address.
    if (!user.emailVerifiedAt) return reply.code(403).send({ code: 'EMAIL_VERIFICATION_REQUIRED' });
    const subscriber = await fastify.prisma.newsletterSubscriber.findUnique({
      where: { email: user.email }, select: { preferencesToken: true, status: true }
    });
    return { data: { token: subscriber?.preferencesToken ?? null, status: subscriber?.status ?? null } };
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
