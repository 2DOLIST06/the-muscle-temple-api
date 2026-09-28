import { env } from '../../config/env.js';

const BREVO_TRANSACTIONAL_EMAIL_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_TIMEOUT_MS = 10_000;

export type BrevoTransactionalEmail = {
  to: Array<{ email: string; name?: string }>;
  subject: string;
  htmlContent: string;
  textContent: string;
};

function assertBrevoConfigured() {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL || !env.BREVO_SENDER_NAME) {
    throw new Error('Brevo is not configured. Define BREVO_API_KEY, BREVO_SENDER_EMAIL and BREVO_SENDER_NAME.');
  }
}

export async function sendBrevoTransactionalEmail(email: BrevoTransactionalEmail) {
  assertBrevoConfigured();

  const response = await fetch(BREVO_TRANSACTIONAL_EMAIL_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': env.BREVO_API_KEY as string,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
      ...email
    }),
    signal: AbortSignal.timeout(BREVO_TIMEOUT_MS)
  });

  if (!response.ok) {
    // Deliberately do not include the response body: provider diagnostics may contain personal data.
    throw new Error(`Brevo transactional email request failed with status ${response.status}.`);
  }
}
