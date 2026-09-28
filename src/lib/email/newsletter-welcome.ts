import { env } from '../../config/env.js';
import { BrevoTransactionalEmail, sendBrevoTransactionalEmail } from './brevo.js';

type NewsletterLanguage = 'fr' | 'en';

type NewsletterWelcomeEmail = {
  email: string;
  language: NewsletterLanguage;
  preferencesToken: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildNewsletterPreferencesUrl(language: NewsletterLanguage, preferencesToken: string) {
  if (!env.FRONTEND_URL) throw new Error('FRONTEND_URL is not configured.');

  const path = language === 'fr' ? '/fr/newsletter/preferences' : '/newsletter/preferences';
  const url = new URL(path, env.FRONTEND_URL);
  url.searchParams.set('token', preferencesToken);
  return url.toString();
}

export function buildNewsletterWelcomePayload(input: NewsletterWelcomeEmail): BrevoTransactionalEmail {
  const preferencesUrl = buildNewsletterPreferencesUrl(input.language, input.preferencesToken);
  // The existing preferences centre owns unsubscription and calls POST /api/newsletter/unsubscribe.
  const unsubscribeUrl = new URL(preferencesUrl);
  unsubscribeUrl.searchParams.set('action', 'unsubscribe');

  const isFrench = input.language === 'fr';
  const copy = isFrench
    ? {
        subject: 'Bienvenue sur Body Training Guide',
        greeting: 'Bonjour,',
        confirmation: 'Votre inscription à Body Training Guide a bien été prise en compte.',
        preferences: 'Vous pouvez choisir les contenus que vous souhaitez recevoir et modifier vos préférences à tout moment.',
        button: 'Modifier mes préférences',
        unsubscribe: 'Se désabonner'
      }
    : {
        subject: 'Welcome to Body Training Guide',
        greeting: 'Hello,',
        confirmation: 'Your subscription to Body Training Guide has been successfully registered.',
        preferences: 'You can choose the content you would like to receive and change your preferences at any time.',
        button: 'Manage my preferences',
        unsubscribe: 'Unsubscribe'
      };

  const safePreferencesUrl = escapeHtml(preferencesUrl);
  const safeUnsubscribeUrl = escapeHtml(unsubscribeUrl.toString());
  const textContent = [
    copy.greeting,
    '',
    copy.confirmation,
    '',
    copy.preferences,
    '',
    `${copy.button}: ${preferencesUrl}`,
    `${copy.unsubscribe}: ${unsubscribeUrl.toString()}`
  ].join('\n');

  return {
    to: [{ email: input.email }],
    subject: copy.subject,
    textContent,
    htmlContent: `<!doctype html>
<html lang="${isFrench ? 'fr' : 'en'}">
  <body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#171717">
    <div style="max-width:600px;margin:0 auto;padding:40px 24px;background:#ffffff">
      <h1 style="font-size:24px;margin:0 0 24px">Body Training Guide</h1>
      <p>${copy.greeting}</p>
      <p>${copy.confirmation}</p>
      <p>${copy.preferences}</p>
      <p style="margin:32px 0"><a href="${safePreferencesUrl}" style="background:#171717;color:#fff;padding:14px 20px;text-decoration:none;border-radius:4px">${copy.button}</a></p>
      <p style="margin-top:40px;font-size:12px;color:#666"><a href="${safeUnsubscribeUrl}" style="color:#666">${copy.unsubscribe}</a></p>
    </div>
  </body>
</html>`
  };
}

export async function sendNewsletterWelcomeEmail(input: NewsletterWelcomeEmail) {
  await sendBrevoTransactionalEmail(buildNewsletterWelcomePayload(input));
}
