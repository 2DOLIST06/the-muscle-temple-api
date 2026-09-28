import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FRONTEND_URL = 'https://bodytrainingguide.com/base';
process.env.BREVO_API_KEY = 'test-api-key';
process.env.BREVO_SENDER_EMAIL = 'newsletter@bodytrainingguide.com';
process.env.BREVO_SENDER_NAME = 'Body Training Guide';

test('welcome payload localizes its copy and uses the public preferences centre', async () => {
  const { buildNewsletterWelcomePayload } = await import('../src/lib/email/newsletter-welcome.js');
  const token = '<private-token>&';
  const payload = buildNewsletterWelcomePayload({
    email: 'reader@example.com',
    language: 'fr',
    preferencesToken: token
  });

  assert.equal(payload.subject, 'Bienvenue sur Body Training Guide');
  assert.match(payload.textContent, /https:\/\/bodytrainingguide\.com\/fr\/newsletter\/preferences\?token=/);
  assert.match(payload.textContent, /action=unsubscribe/);
  assert.doesNotMatch(payload.htmlContent, /<private-token>/);
  assert.match(payload.htmlContent, /%3Cprivate-token%3E%26/);
});

test('Brevo client posts a transactional email without putting credentials in the body', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: url.toString(), init };
    return new Response(JSON.stringify({ messageId: 'test-message-id' }), { status: 201 });
  }) as typeof fetch;

  try {
    const { sendBrevoTransactionalEmail } = await import('../src/lib/email/brevo.js');
    await sendBrevoTransactionalEmail({
      to: [{ email: 'reader@example.com' }],
      subject: 'Welcome',
      htmlContent: '<p>Welcome</p>',
      textContent: 'Welcome'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(request?.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(request?.init?.method, 'POST');
  assert.equal((request?.init?.headers as Record<string, string>)['api-key'], 'test-api-key');
  assert.doesNotMatch(String(request?.init?.body), /test-api-key/);
  assert.deepEqual(JSON.parse(String(request?.init?.body)).sender, {
    email: 'newsletter@bodytrainingguide.com',
    name: 'Body Training Guide'
  });
});
