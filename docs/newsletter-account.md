# Unified newsletter account

New newsletter signups create the subscriber, preferences and USER account in one transaction. The account points to its subscriber through `User.newsletterSubscriberId`. Email verification is not faked: `emailVerifiedAt` remains null until the email sign-in link is consumed. A random, unknown password hash is stored until the member sets their own password through an authenticated session.

`POST /api/auth/newsletter/start` returns a 12-hour member JWT only if both identities were created in that transaction. Next stores that JWT in the site's HttpOnly cookie and removes it from the browser-visible response. Known users and historical newsletter subscribers receive `status: existing` with no session or saved preferences; they authenticate with their own password or an email link. Historical newsletter-only subscribers acquire one USER account when requesting their login email.

The authenticated newsletter settings endpoints use the database account email, never a client-supplied email or subscriber ID. Access to historical preferences requires verified email ownership, or the explicit subscriber relation established by new signup. Password registration cannot claim an existing newsletter subscription. Goals, subjects and frequencies remain unchanged unless explicitly saved. Unsubscription preserves preferences; reactivation is explicit and cannot reactivate bounced/complained subscribers.

New welcome emails link to the same account via the existing one-use, 15-minute login token. A separate signed capability permits requesting a fresh login email after expiry; it cannot authenticate a member. Old preferences links can request an account email and still unsubscribe. They cannot open a full account session directly.

## Migration and deployment

Run `prisma/migrations/202610310001_newsletter_account/migration.sql` against the BTG database before deploying this API, then deploy the frontend. The SQL is idempotent so a manual DBeaver run and a subsequent `prisma migrate deploy` are compatible. Existing rows remain unlinked; ownership is never inferred silently for historical addresses. No bulk preference rewrite and no automatic newsletter delivery are included.

Validation: `npm run build`; `npm test`. In environments that prohibit tsx's IPC socket, use `node --import tsx --test test/*.test.ts` with the same test DATABASE_URL and JWT_SECRET as the npm test script. Database operations in unit tests use isolated in-memory Prisma fixtures; the migration has not been applied to a production database.
