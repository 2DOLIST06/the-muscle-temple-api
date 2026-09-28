import assert from 'node:assert/strict';
import test from 'node:test';
import {
  newsletterPreferencesUpdateSchema,
  newsletterSubscribeSchema,
  newsletterTokenBodySchema
} from '../src/validation/newsletter.js';

test('newsletter subscription normalizes email and validates consent and locale', () => {
  const parsed = newsletterSubscribeSchema.parse({
    email: '  PERSON@Example.COM ',
    language: 'fr',
    source: 'footer',
    consent: true,
    consentTextVersion: '2026-09'
  });
  assert.equal(parsed.email, 'person@example.com');
  assert.equal(parsed.language, 'fr');
  assert.throws(() => newsletterSubscribeSchema.parse({ ...parsed, language: 'de' }));
  assert.throws(() => newsletterSubscribeSchema.parse({ ...parsed, consent: false }));
});

test('newsletter preference validation accepts supported values and rejects unknown input', () => {
  const token = 'a'.repeat(43);
  const parsed = newsletterPreferencesUpdateSchema.parse({
    token,
    topics: {
      new_articles: true,
      strength_training: false,
      workout_programs: true,
      nutrition: false,
      supplements: true,
      equipment: false,
      tools: true,
      guides: false
    },
    frequency: 'monthly',
    goals: ['hypertrophy', 'strength']
  });
  assert.deepEqual(parsed.goals, ['hypertrophy', 'strength']);
  assert.equal(parsed.topics?.strength_training, false);
  assert.throws(() => newsletterPreferencesUpdateSchema.parse({ token, frequency: 'daily' }));
  assert.throws(() => newsletterPreferencesUpdateSchema.parse({ token, unknown: true }));
  assert.throws(() => newsletterPreferencesUpdateSchema.parse({ token, topics: {} }));
  assert.throws(() => newsletterPreferencesUpdateSchema.parse({ token, topics: { newArticles: true } }));
  assert.throws(() => newsletterPreferencesUpdateSchema.parse({ token }));
});

test('public tokens must have sufficient entropy-sized input', () => {
  assert.equal(newsletterTokenBodySchema.parse({ token: 'x'.repeat(43) }).token.length, 43);
  assert.throws(() => newsletterTokenBodySchema.parse({ token: 'short' }));
});
