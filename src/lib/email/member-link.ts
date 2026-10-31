import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { User } from '@prisma/client';
import { env } from '../../config/env.js';
import { sendBrevoTransactionalEmail } from './brevo.js';
import { buildNewsletterWelcomePayload } from './newsletter-welcome.js';

export const linkDigest = (raw: string) => createHash('sha256').update(raw).digest('hex');
export async function sendMemberLink(
  app: FastifyInstance,
  user: Pick<User, 'id' | 'email'>,
  locale: 'fr' | 'en',
  welcome?: { preferencesToken: string },
) {
  const now = new Date(),
    raw = randomBytes(32).toString('hex'),
    hash = linkDigest(raw);
  const claimed = await app.prisma.user.updateMany({
    where: {
      id: user.id,
      role: 'USER',
      OR: [
        { loginLinkRequestedAt: null },
        { loginLinkRequestedAt: { lt: new Date(now.getTime() - 60_000) } },
      ],
    },
    data: {
      loginTokenHash: hash,
      loginTokenExpiresAt: new Date(now.getTime() + 15 * 60_000),
      loginLinkRequestedAt: now,
    },
  });
  if (!claimed.count) return { code: 'LOGIN_LINK_COOLDOWN', status: 429 };
  try {
    if (!env.FRONTEND_URL) throw Error('Missing frontend origin');
    const proof = app.jwt.sign(
      { purpose: 'member-link-resend', userId: user.id, hash },
      { expiresIn: '90d' },
    );
    const url = new URL(locale === 'fr' ? '/fr/connexion/lien' : '/login/link', env.FRONTEND_URL);
    url.hash = raw + '~' + proof;
    const fr = locale === 'fr',
      label = fr ? 'Me connecter' : 'Sign in';
    const detail = fr
      ? 'Ce lien est valable 15 minutes et utilisable une seule fois. Si vous ne l’avez pas demandé, ignorez ce message.'
      : 'This link expires in 15 minutes and can only be used once. If you did not request it, ignore this message.';
    const escaped = url.toString().replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    await sendBrevoTransactionalEmail(
      welcome
        ? buildNewsletterWelcomePayload({
            email: user.email,
            language: locale,
            preferencesToken: welcome.preferencesToken,
            accountUrl: url.toString(),
          })
        : {
            to: [{ email: user.email }],
            subject: fr
              ? 'Votre lien de connexion Body Training Guide'
              : 'Your Body Training Guide sign-in link',
            htmlContent: `<p>Body Training Guide</p><p><a href="${escaped}">${label}</a></p><p>${detail}</p>`,
            textContent: `${label}: ${url}\n\n${detail}`,
          },
    );
    return null;
  } catch {
    await app.prisma.user.updateMany({
      where: { id: user.id, loginTokenHash: hash },
      data: { loginTokenHash: null, loginTokenExpiresAt: null, loginLinkRequestedAt: null },
    });
    return { code: 'LOGIN_LINK_DELIVERY_FAILED', status: 503 };
  }
}
