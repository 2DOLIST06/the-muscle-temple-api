import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { requireUserAuth } from '../../lib/auth.js';
import { sendMemberLink } from '../../lib/email/member-link.js';
import {
  publicSubscriberSelect,
  serializePreferences,
  toDatabasePreferences,
} from '../../lib/newsletter-preferences.js';
import {
  newsletterSubscribeSchema,
  newsletterTopicsSchema,
  newsletterGoals,
} from '../../validation/newsletter.js';

const settingsSchema = z
  .object({
    topics: newsletterTopicsSchema,
    goals: z.array(z.enum(newsletterGoals)).max(4),
    frequency: z.enum(['immediate', 'weekly', 'monthly']),
    consent: z.literal(true),
    reactivate: z.boolean().optional(),
    language: z.enum(['fr', 'en']).optional(),
  })
  .strict();
const safe = (user: { id: string; email: string; displayName: string; role: UserRole }) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  role: user.role,
});
const defaults = () => ({
  language: 'fr',
  topics: {
    new_articles: true,
    strength_training: true,
    workout_programs: true,
    nutrition: true,
    supplements: true,
    equipment: true,
    tools: true,
    guides: true,
  },
  goals: [],
  frequency: 'weekly',
  unsubscribed: false,
  subscribed: false,
});

export const newsletterAccountRoutes: FastifyPluginAsync = async (app) => {
  const attempts = new Map<string, { count: number; until: number }>();
  const limited = (ip: string) => {
    const now = Date.now();
    for (const [key, v] of attempts) if (v.until < now) attempts.delete(key);
    const v = attempts.get(ip);
    if (v) return ++v.count > 100;
    if (attempts.size >= 10000) return true;
    attempts.set(ip, { count: 1, until: now + 15 * 60_000 });
    return false;
  };
  app.post('/auth/newsletter/start', async (request, reply) => {
    const input = newsletterSubscribeSchema.parse(request.body);
    if (limited(request.ip)) return reply.code(429).send({ code: 'TOO_MANY_ATTEMPTS' });
    // Existing identities never disclose preferences or open a session from email alone.
    try {
      const result = await app.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { email: input.email } });
        const subscriber = await tx.newsletterSubscriber.findUnique({ where: { email: input.email } });
        if (user || subscriber) return { existing: true as const };
        const sub = await tx.newsletterSubscriber.create({
          data: {
            email: input.email,
            language: input.language,
            source: input.source,
            status: 'active',
            consentAt: new Date(),
            confirmedAt: new Date(),
            consentTextVersion: 'v2-newsletter-button',
            consentSource: input.source,
            confirmationToken: randomBytes(32).toString('base64url'),
            preferencesToken: randomBytes(32).toString('base64url'),
            preferences: { create: {} },
          },
        });
        const member = await tx.user.create({
          data: {
            email: input.email,
            displayName: '',
            role: UserRole.USER,
            passwordHash: await bcrypt.hash(randomBytes(48).toString('hex'), 10),
            newsletterSubscriberId: sub.id,
          },
        });
        return { existing: false as const, user: member, subscriber: sub };
      });
      if (result.existing) return { status: 'existing', authenticated: false };
      const token = await reply.jwtSign(
        {
          userId: result.user.id,
          email: result.user.email,
          role: result.user.role,
          sessionVersion: result.user.sessionVersion,
        },
        { expiresIn: '12h' },
      );
      // Delivery failure never rolls back an active subscription or its session.
      const mail = await sendMemberLink(app, result.user, input.language, {
        preferencesToken: result.subscriber.preferencesToken,
      });
      return reply
        .code(201)
        .send({ status: 'active', authenticated: true, token, user: safe(result.user), email_sent: !mail });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        return { status: 'existing', authenticated: false };
      throw error;
    }
  });
  async function owned(userId: string) {
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const sub = await app.prisma.newsletterSubscriber.findUnique({
      where: { email: user.email },
      select: { ...publicSubscriberSelect, id: true },
    });
    return {
      user,
      sub,
      allowed: !sub || Boolean(user.emailVerifiedAt) || user.newsletterSubscriberId === sub.id,
    };
  }
  app.get('/auth/newsletter/settings', { preHandler: requireUserAuth }, async (request, reply) => {
    const value = await owned(request.authenticatedUser.userId);
    if (!value.allowed) return reply.code(403).send({ code: 'EMAIL_VERIFICATION_REQUIRED' });
    return {
      data: value.sub
        ? { ...serializePreferences(value.sub), subscribed: true, status: value.sub.status }
        : defaults(),
    };
  });
  app.post('/auth/newsletter/settings', { preHandler: requireUserAuth }, async (request, reply) => {
    const input = settingsSchema.parse(request.body);
    const result = await app.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: request.authenticatedUser.userId } });
      let sub = await tx.newsletterSubscriber.findUnique({ where: { email: user.email } });
      if (sub && !user.emailVerifiedAt && user.newsletterSubscriberId !== sub.id)
        return { error: 'EMAIL_VERIFICATION_REQUIRED', status: 403 };
      if (sub && ['bounced', 'complained'].includes(sub.status))
        return { error: 'NEWSLETTER_UNAVAILABLE', status: 409 };
      if (sub?.status === 'unsubscribed' && !input.reactivate)
        return { error: 'REACTIVATION_REQUIRED', status: 409 };
      if (!sub) {
        sub = await tx.newsletterSubscriber.create({
          data: {
            email: user.email,
            status: 'active',
            language: input.language ?? 'en',
            source: 'account',
            consentAt: new Date(),
            confirmedAt: new Date(),
            consentTextVersion: 'v2-newsletter-button',
            consentSource: 'account',
            confirmationToken: randomBytes(32).toString('base64url'),
            preferencesToken: randomBytes(32).toString('base64url'),
          },
        });
        await tx.user.update({ where: { id: user.id }, data: { newsletterSubscriberId: sub.id } });
      } else if (sub.status !== 'active')
        sub = await tx.newsletterSubscriber.update({
          where: { id: sub.id },
          data: {
            status: 'active',
            unsubscribedAt: null,
            consentAt: new Date(),
            consentSource: 'account',
            consentTextVersion: 'v2-newsletter-button',
          },
        });
      const preferences = { ...toDatabasePreferences(input.topics), frequency: input.frequency };
      await tx.newsletterPreference.upsert({
        where: { subscriberId: sub.id },
        create: { subscriberId: sub.id, ...preferences },
        update: preferences,
      });
      await tx.newsletterSubscriberGoal.deleteMany({ where: { subscriberId: sub.id } });
      if (input.goals.length)
        await tx.newsletterSubscriberGoal.createMany({
          data: [...new Set(input.goals)].map((goal) => ({ subscriberId: sub!.id, goal })),
        });
      const latest = await tx.newsletterSubscriber.findUniqueOrThrow({
        where: { id: sub.id },
        select: publicSubscriberSelect,
      });
      return { data: { ...serializePreferences(latest), subscribed: true, status: latest.status } };
    });
    return 'error' in result ? reply.code(result.status!).send({ code: result.error }) : result;
  });
  app.post('/auth/newsletter/unsubscribe', { preHandler: requireUserAuth }, async (request, reply) => {
    const value = await owned(request.authenticatedUser.userId);
    if (!value.allowed) return reply.code(403).send({ code: 'EMAIL_VERIFICATION_REQUIRED' });
    if (value.sub)
      await app.prisma.newsletterSubscriber.update({
        where: { id: value.sub.id },
        data: { status: 'unsubscribed', unsubscribedAt: new Date() },
      });
    return { ok: true };
  });
  app.post('/auth/newsletter/account-link', async (request, reply) => {
    const { token, locale } = z
      .object({ token: z.string().min(32).max(200), locale: z.enum(['fr', 'en']) })
      .strict()
      .parse(request.body);
    if (limited(request.ip)) return reply.code(429).send({ code: 'TOO_MANY_ATTEMPTS' });
    const sub = await app.prisma.newsletterSubscriber.findUnique({ where: { preferencesToken: token } });
    if (!sub) return reply.code(404).send({ code: 'INVALID_PREFERENCES_TOKEN' });
    const user = await app.prisma.user.upsert({
      where: { email: sub.email },
      update: {},
      create: {
        email: sub.email,
        displayName: '',
        role: UserRole.USER,
        passwordHash: await bcrypt.hash(randomBytes(48).toString('hex'), 10),
      },
    });
    if (user.role !== UserRole.USER) return reply.code(403).send({ code: 'MEMBER_ACCOUNT_REQUIRED' });
    const error = await sendMemberLink(app, user, locale);
    return error ? reply.code(error.status).send({ code: error.code }) : { ok: true };
  });
};
