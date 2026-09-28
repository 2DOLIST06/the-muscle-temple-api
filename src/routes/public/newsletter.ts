import { randomBytes } from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { NewsletterFrequency, NewsletterGoalType, NewsletterStatus, Prisma } from '@prisma/client';
import {
  newsletterPreferencesUpdateSchema,
  newsletterSubscribeSchema,
  newsletterTokenBodySchema,
  newsletterTokenQuerySchema
} from '../../validation/newsletter.js';
import { sendNewsletterWelcomeEmail } from '../../lib/email/newsletter-welcome.js';

const createToken = () => randomBytes(32).toString('base64url');

const preferenceSelect = {
  newArticles: true,
  strengthTraining: true,
  workoutPrograms: true,
  nutrition: true,
  supplements: true,
  equipment: true,
  tools: true,
  guides: true,
  frequency: true
} as const;

const publicSubscriberSelect = {
  status: true,
  language: true,
  preferences: { select: preferenceSelect },
  goals: { select: { goal: true }, orderBy: { createdAt: 'asc' as const } }
} as const;

function serializePreferences(subscriber: Prisma.NewsletterSubscriberGetPayload<{ select: typeof publicSubscriberSelect }>) {
  return {
    status: subscriber.status,
    language: subscriber.language,
    ...(subscriber.preferences ?? {
      newArticles: true,
      strengthTraining: true,
      workoutPrograms: true,
      nutrition: true,
      supplements: true,
      equipment: true,
      tools: true,
      guides: true,
      frequency: NewsletterFrequency.weekly
    }),
    goals: subscriber.goals.map(({ goal }) => goal)
  };
}

export const newsletterRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/newsletter/subscribe', async (request, reply) => {
    const input = newsletterSubscribeSchema.parse(request.body);
    const now = new Date();

    const welcomeRecipient = await fastify.prisma.$transaction(async (tx) => {
      const consentSource = input.consentSource ?? input.source;
      const existingSubscriber = await tx.newsletterSubscriber.findUnique({ where: { email: input.email } });
      const shouldActivate = existingSubscriber?.status === NewsletterStatus.unsubscribed
        || existingSubscriber?.status === NewsletterStatus.pending;
      const shouldSendWelcome = !existingSubscriber || shouldActivate;
      const activeSubscriber = !existingSubscriber
        ? await tx.newsletterSubscriber.create({
            data: {
              email: input.email,
              status: NewsletterStatus.active,
              language: input.language,
              source: input.source,
              consentAt: now,
              consentTextVersion: input.consentTextVersion,
              consentSource,
              confirmedAt: now,
              confirmationToken: createToken(),
              preferencesToken: createToken()
            }
          })
        : shouldActivate
          ? await tx.newsletterSubscriber.update({
              where: { id: existingSubscriber.id },
              data: {
                status: NewsletterStatus.active,
                language: input.language,
                source: input.source,
                consentAt: now,
                consentTextVersion: input.consentTextVersion,
                consentSource,
                confirmedAt: now,
                unsubscribedAt: null,
                confirmationToken: createToken(),
                preferencesToken: createToken()
              }
            })
          : existingSubscriber;

      await tx.newsletterPreference.upsert({
        where: { subscriberId: activeSubscriber.id },
        create: { subscriberId: activeSubscriber.id },
        update: {}
      });

      return shouldSendWelcome
        ? { email: activeSubscriber.email, language: activeSubscriber.language, preferencesToken: activeSubscriber.preferencesToken }
        : null;
    });

    if (welcomeRecipient) {
      try {
        await sendNewsletterWelcomeEmail(welcomeRecipient);
      } catch (error) {
        request.log.error({ err: error }, 'Unable to send newsletter welcome email via Brevo');
      }
    }

    return reply.code(200).send({
      message: 'Si cette adresse peut être inscrite, son inscription est prise en compte.'
    });
  });

  fastify.post('/newsletter/confirm', async (request, reply) => {
    const { token } = newsletterTokenBodySchema.parse(request.body);
    const subscriber = await fastify.prisma.newsletterSubscriber.findUnique({
      where: { confirmationToken: token },
      select: { id: true, status: true }
    });

    if (!subscriber || (subscriber.status !== NewsletterStatus.pending && subscriber.status !== NewsletterStatus.active)) {
      return reply.code(400).send({ message: 'Token invalide.' });
    }

    if (subscriber.status === NewsletterStatus.pending) {
      await fastify.prisma.newsletterSubscriber.update({
        where: { id: subscriber.id },
        data: { status: NewsletterStatus.active, confirmedAt: new Date(), unsubscribedAt: null }
      });
    }

    return { message: 'Inscription confirmée.' };
  });

  fastify.get('/newsletter/preferences', async (request, reply) => {
    const { token } = newsletterTokenQuerySchema.parse(request.query);
    const subscriber = await fastify.prisma.newsletterSubscriber.findUnique({
      where: { preferencesToken: token },
      select: publicSubscriberSelect
    });

    if (!subscriber) return reply.code(404).send({ message: 'Token invalide.' });
    return { data: serializePreferences(subscriber) };
  });

  fastify.put('/newsletter/preferences', async (request, reply) => {
    const input = newsletterPreferencesUpdateSchema.parse(request.body);
    const subscriber = await fastify.prisma.newsletterSubscriber.findUnique({
      where: { preferencesToken: input.token },
      select: { id: true }
    });
    if (!subscriber) return reply.code(404).send({ message: 'Token invalide.' });

    const { token: _token, goals, ...preferences } = input;
    const updated = await fastify.prisma.$transaction(async (tx) => {
      await tx.newsletterPreference.upsert({
        where: { subscriberId: subscriber.id },
        create: { subscriberId: subscriber.id, ...preferences },
        update: preferences
      });

      if (goals) {
        await tx.newsletterSubscriberGoal.deleteMany({ where: { subscriberId: subscriber.id } });
        if (goals.length) {
          await tx.newsletterSubscriberGoal.createMany({
            data: [...new Set(goals)].map((goal) => ({
              subscriberId: subscriber.id,
              goal: goal as NewsletterGoalType
            })),
            skipDuplicates: true
          });
        }
      }

      return tx.newsletterSubscriber.findUniqueOrThrow({
        where: { id: subscriber.id },
        select: publicSubscriberSelect
      });
    });

    return { message: 'Préférences mises à jour.', data: serializePreferences(updated) };
  });

  fastify.post('/newsletter/unsubscribe', async (request, reply) => {
    const { token } = newsletterTokenBodySchema.parse(request.body);
    const subscriber = await fastify.prisma.newsletterSubscriber.findUnique({
      where: { preferencesToken: token },
      select: { id: true, status: true }
    });
    if (!subscriber) return reply.code(400).send({ message: 'Token invalide.' });

    if (subscriber.status !== NewsletterStatus.unsubscribed) {
      await fastify.prisma.newsletterSubscriber.update({
        where: { id: subscriber.id },
        data: { status: NewsletterStatus.unsubscribed, unsubscribedAt: new Date() }
      });
    }

    return { message: 'Désinscription enregistrée.' };
  });
};
