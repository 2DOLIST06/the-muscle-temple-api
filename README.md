# The Muscle Temple — Backend + Admin

Backend + admin **Node.js / TypeScript** pour alimenter un front Next.js externe (repo séparé), avec PostgreSQL + Prisma et déploiement Render.

## Stack
- API: Fastify
- ORM: Prisma
- DB: PostgreSQL
- Validation: Zod
- Auth admin: JWT Bearer
- Auth membres: JWT Bearer, séparée de l'authentification admin
- Admin panel: `/admin` (V1 simple)

## Structure
```txt
.
├─ prisma/
│  ├─ schema.prisma
│  └─ seed.ts
├─ src/
│  ├─ config/env.ts
│  ├─ db/client.ts
│  ├─ lib/
│  ├─ routes/
│  │  ├─ public/index.ts
│  │  └─ admin/{api.ts,panel.ts}
│  ├─ validation/
│  └─ server.ts
├─ .env.example
├─ render.yaml
└─ package.json
```

## Variables d’environnement
Copier `.env.example` en `.env`.

Variables nécessaires:
- `DATABASE_URL` (PostgreSQL)
- `JWT_SECRET` (>= 32 chars)
- `CORS_ORIGIN` (une ou plusieurs origines, séparées par virgule)
- `AUTH_DEBUG` (`true`/`false`, optionnel pour logs détaillés de rejet login admin)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `AWS_S3_BUCKET_NAME` / `AWS_CLOUDFRONT_URL` pour les uploads d’images S3 via CloudFront
- `AWS_S3_UPLOAD_MAX_BYTES` (par défaut `5242880`, soit 5 Mo)
- `PORT` (par défaut 4000)
- `APP_URL`
- `ADMIN_EMAIL` (seed)
- `ADMIN_PASSWORD` (seed)
- `SMTP_SERVER` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` / `MAIL_FROM` pour envoyer les notifications SMTP de newsletter
- `SMTP_EHLO_DOMAIN` (optionnel, par défaut `the-muscle-temple-api`)
- `NEWSLETTER_RECIPIENT_EMAIL` (par défaut `contact@2dolist.fr`)
- `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` pour l'e-mail transactionnel de bienvenue
- `FRONTEND_URL` (origine publique du front, utilisée pour les liens de préférences et de désinscription)
- `OPEN_FOOD_FACTS_USER_AGENT` (identification envoyée à Open Food Facts ; par défaut `BodyTrainingGuide/1.0 (contact@2dolist.fr)`)
- `OPEN_FOOD_FACTS_TIMEOUT_MS` (timeout fournisseur, par défaut `5000`)
- `OPEN_FOOD_FACTS_CACHE_TTL_HOURS` (validité du cache PostgreSQL, par défaut `168`, soit 7 jours)

Exemple multi-origines:
```env
CORS_ORIGIN="http://localhost:3000,https://my-blog.vercel.app"
```

## Scripts
- `npm run dev`: lance l’API en mode watch
- `npm run build`: compile TypeScript -> `dist/`
- `npm run start`: démarre `dist/server.js`
- `npm run prisma:generate`
- `npm run prisma:migrate`
- `npm run prisma:deploy`
- `npm run seed`

## Local setup
```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run seed
npm run dev
```

## Endpoints publics (`/api`)
- `GET /api/health`
- `POST /api/auth/register` : crée exclusivement un compte `USER`
- `POST /api/auth/login` : connecte exclusivement un compte `USER`
- `GET /api/auth/me` : retourne le profil du membre authentifié, sans données d'authentification internes
- `POST /api/newsletter/subscribe` : active immédiatement l'inscription avec consentement et tente d'envoyer l'e-mail de bienvenue Brevo
- `POST /api/newsletter/confirm` : confirme une inscription avec son `confirmation_token`
- `GET /api/newsletter/preferences?token=...` : lit le statut, la langue, les préférences et les objectifs associés au `preferences_token`
- `PUT /api/newsletter/preferences` : remplace les objectifs fournis et met à jour les préférences avec le `preferences_token`
- `POST /api/newsletter/unsubscribe` : désinscrit sans supprimer les données, avec le `preferences_token`
- `GET /api/posts`
- `GET /api/posts/:slug`
- `GET /api/categories`
- `GET /api/categories/:slug/posts`
- `GET /api/authors`
- `GET /api/authors/:slug/posts`
- `GET /api/seo/pages/:key`

### Produits alimentaires (Open Food Facts)

`GET /api/foods/barcode/:code` accepte un EAN-8, UPC-E, UPC-A ou EAN-13 valide (les espaces sont retirés). Une réponse `200` contient la fiche sous `data` et `meta.cached`. Les valeurs absentes restent `null`, `nutritionAvailable` distingue une fiche sans données nutritionnelles, et `nutritionBasis.unit` vaut toujours `g` ou `ml` sans conversion.

```json
{
  "data": {
    "barcode": "3017620422003",
    "name": "Produit",
    "brand": "Marque",
    "image": "https://images.openfoodfacts.org/example.jpg",
    "quantityLabel": "500 g",
    "servingSize": null,
    "nutritionBasis": { "amount": 100, "unit": "g" },
    "nutrition": {
      "caloriesKcal": 123, "energyKj": 515, "proteinG": 10.5,
      "carbohydratesG": 20, "sugarsG": 4, "fatG": 2,
      "saturatedFatG": 0.8, "fiberG": 3, "saltG": 0.5, "sodiumG": 0.2
    },
    "nutritionAvailable": true,
    "source": "open_food_facts",
    "sourceUrl": "https://world.openfoodfacts.org/product/3017620422003"
  },
  "meta": { "cached": false }
}
```

Une fiche trouvée sans nutrition conserve exactement la même structure (`nutritionAvailable: false` et chaque nutriment à `null`). Un code invalide produit `400`. Un produit absent produit `404` avec `{"code":"PRODUCT_NOT_FOUND","message":"Produit introuvable."}`. Une indisponibilité fournisseur produit `503` avec `{"code":"FOOD_DATA_PROVIDER_UNAVAILABLE","message":"Le service de données nutritionnelles est temporairement indisponible."}`.

`GET /api/foods/search?q=texte&limit=10` effectue une recherche explicite. `q` comporte 2 à 100 caractères et `limit` vaut 10 par défaut, 20 maximum. Une réponse `200` contient `{ "data": [{ "barcode", "name", "brand", "image", "quantityLabel", "source", "sourceUrl" }], "meta": { "query", "limit", "count" } }`. Les erreurs de validation et fournisseur utilisent respectivement `400` et `503`. La recherche n'est pas mise en cache ; la fiche sélectionnée l'est lors de sa récupération par code-barres.

Les données sont attribuées à Open Food Facts via `source` et `sourceUrl`. Elles sont mises en cache dans PostgreSQL pendant 7 jours par défaut, puis rafraîchies au prochain accès.

### Suivi nutritionnel authentifié

Toutes les routes ci-dessous exigent un JWT de rôle `USER`. Le propriétaire est toujours déterminé par `request.authenticatedUser.userId`; aucun `userId` client n'est accepté.

- `GET /api/nutrition/goals?date=YYYY-MM-DD` : objectif applicable à la date, ou `data: null`.
- `PUT /api/nutrition/goals` : crée ou remplace l'objectif de sa date d'effet.
- `GET /api/nutrition/goals/history` : historique décroissant des objectifs.
- `GET|POST /api/nutrition/personal-foods` : liste et création des aliments personnels.
- `GET|PATCH|DELETE /api/nutrition/personal-foods/:id` : gestion d'un aliment appartenant au membre.
- `GET /api/nutrition/diary?date=YYYY-MM-DD` : journal, objectif, totaux et restant.
- `POST /api/nutrition/diary/entries` : ajoute une consommation Open Food Facts ou personnelle.
- `PATCH|DELETE /api/nutrition/diary/entries/:id` : modifie la quantité/le repas ou supprime une entrée appartenant au membre.

Les quantités d'une entrée utilisent automatiquement l'unité de la source (`G` ou `ML`), sans conversion masse/volume. Les valeurs historiques sont calculées et conservées dans un snapshot. Les routes publiques `GET /api/nutrition/products/:barcode` et `GET /api/nutrition/search` restent accessibles sans authentification.

### Newsletter Body Training Guide

L'inscription attend le payload suivant. L'adresse est normalisée côté serveur et le consentement doit être explicite :

```json
{
  "email": "abonne@example.com",
  "language": "fr",
  "source": "footer",
  "consent": true,
  "consentTextVersion": "2026-09",
  "consentSource": "footer-checkbox"
}
```

La confirmation et la désinscription attendent `{ "token": "..." }`. Le token de confirmation est distinct du token de gestion des préférences. La lecture transmet ce dernier dans le paramètre de requête `token`. Une mise à jour de préférences accepte `token`, un objet `topics` utilisant les clés API `new_articles`, `strength_training`, `workout_programs`, `nutrition`, `supplements`, `equipment`, `tools`, `guides`, ainsi que `frequency` (`immediate`, `weekly`, `monthly`) et `goals` (`hypertrophy`, `fat_loss`, `strength`, `general_fitness`). Tous ces champs sont optionnels, mais au moins un doit être fourni. La lecture renvoie la même structure, complétée par `language` et le booléen `unsubscribed`.

La réponse publique d'inscription reste volontairement générique pour ne pas révéler l'existence d'une adresse. Une nouvelle adresse devient immédiatement `active` et reçoit un e-mail de bienvenue via l'API transactionnelle Brevo. Une adresse `unsubscribed` est réactivée en conservant son token et ses préférences, sans effacer ses données. Une adresse déjà `active` reste inchangée et ne reçoit pas de nouvel e-mail. Un échec Brevo est journalisé sans token et n'annule jamais l'inscription en base.

Les liens de l'e-mail ciblent le centre de préférences du front : `${FRONTEND_URL}/newsletter/preferences?token=...` en anglais et `${FRONTEND_URL}/fr/newsletter/preferences?token=...` en français. Le lien de désinscription ajoute `action=unsubscribe` à cette URL ; le centre existant effectue ensuite la désinscription via `POST /api/newsletter/unsubscribe`.

L'intégration utilise l'[API produit v2 officielle](https://openfoodfacts.github.io/openfoodfacts-server/api/ref-v2/#get-/api/v2/product/-barcode-) pour les codes-barres et le moteur [Search-a-licious](https://openfoodfacts.github.io/search-a-licious/) pour la recherche plein texte. La recherche appelle `https://search.openfoodfacts.org/search` avec le paramètre `q` ; `/api/v2/search` n'est pas utilisé pour une recherche libre. Les conditions de réutilisation et d'attribution sont détaillées sur la [page officielle des données Open Food Facts](https://world.openfoodfacts.org/data) ; `sourceUrl` permet au client d'afficher un lien d'attribution vers chaque fiche source.

## Endpoints admin (`/admin-api`)
- Auth: `POST /admin-api/auth/login`
- Dashboard: `GET /admin-api/dashboard`
- Newsletter: `GET /admin-api/newsletter-subscribers` pour récupérer la liste des inscrits enregistrés en base
- CRUD: posts / categories / authors
- Supporting: CRUD tags / CRUD media / upload media S3 (`POST /admin-api/media/upload`) / page SEO (GET, PUT, DELETE)

Toutes les routes admin hors login exigent un header:
```http
Authorization: Bearer <jwt>
```

Le login et les routes `/admin-api` sont strictement réservés aux rôles `ADMIN` et `EDITOR`. Un JWT de rôle `USER` est refusé. La création d'utilisateurs depuis le back-office reste réservée à `ADMIN`.

## Déploiement Render (Node Web Service)
**Root Directory**:
```txt
.
```

**Build Command**:
```bash
npm ci && npm run prisma:generate && npm run build
```

**Start Command**:
```bash
npm run prisma:deploy && npm run start
```

> Si tu utilises Yarn sur Render (`yarn install; yarn build`), c’est aussi compatible:
> - `yarn build` lance `prisma generate` automatiquement avant `tsc`.

**Health Check Path**:
```txt
/api/health
```

Variables Render obligatoires:
- `DATABASE_URL`
- `JWT_SECRET`
- `APP_URL`
- `CORS_ORIGIN`
- `SMTP_SERVER` / `SMTP_USERNAME` / `SMTP_PASSWORD` / `MAIL_FROM`

## Notes de solidité
- `dotenv/config` est chargé au boot serveur et pour le seed.
- CORS valide explicitement les origines autorisées (front Next.js externe).
- Seed idempotent pour éviter les duplications majeures.
- Schéma Prisma avec slugs uniques, statuts de publication, SEO unifié, relations tags et articles liés.

## Bannières d’affiliation

`POST /admin-api/posts/affiliate-banner` exige le rôle `ADMIN` et accepte
`{ ids: string[], source: string, name?: string, mode?: "native" | "isolated" }`.
Limites : 200 identifiants, 100 000 caractères de code et 200 caractères de nom.
Le code source n’est ni extrait ni tronqué : il est stocké intégralement dans un
bloc `data-affiliate-block="banner"` à l’intérieur du contenu ordonné.

Le traitement relit chaque article, ajoute le bloc en fin de contenu ou remplace
l’unique bannière en conservant sa position. Les anciennes bannières multiples
sont signalées sans modification, afin de choisir le bloc depuis l’éditeur.
La réponse `data` contient `results` (id, status, message éventuel), `modified`,
`unchanged` et `failed`. Les relances sont idempotentes et les écritures
conditionnelles sur `updatedAt` protègent les modifications concurrentes.
Seuls les champs du corps et `updatedAt` changent ; les autres traductions,
statuts et métadonnées sont préservés.

Les routes classiques de création/édition contrôlent aussi l’ajout de code actif
pour empêcher un rôle `EDITOR` de contourner cette restriction. Les copies du
format dans `src/lib/affiliate.ts` (API) et `lib/content/affiliate.ts` (front)
doivent évoluer ensemble. Aucun changement de schéma ou migration n’est requis.
Installer la dépendance `parse5`, puis générer le client Prisma et compiler
normalement. Tests : `npm test`, dont `test/affiliate.test.ts`.

Les sauvegardes du formulaire transmettent aussi `expectedUpdatedAt` : une copie périmée reçoit `409`, et l’écriture vérifie atomiquement la révision lue. Les clients API existants peuvent omettre ce champ ; ils doivent le transmettre pour détecter une copie datant d’avant la requête. Les routes de création/édition autorisent un corps HTTP de 4 Mo pour les codes encodés, sans troncature.


### Tests d’affiliation avec PostgreSQL réel

Le test `test/affiliate-postgres.integration.ts` n’utilise jamais la connexion de production. Fournir explicitement `AFFILIATE_TEST_DATABASE_URL` vers une base locale isolée nommée `btg_affiliate_test` (ou suffixée), ainsi que `ALLOW_AFFILIATE_POSTGRES_TESTS=1`, puis exécuter `npm run test:postgres`. Appliquer auparavant les migrations existantes uniquement sur cette base. La suite vérifie persistance/relecture, position, concurrence réelle (200/409), reprise d’un lot après une sauvegarde concurrente et erreur SQL partielle injectée par un trigger temporaire, suivie d’une reprise idempotente. Elle nettoie ses lignes et son trigger.

La CI fournit son propre service PostgreSQL 16 et utilise le verrou npm suivi ; elle ne contacte aucune base distante et ne déploie pas l’application.

### Member email sign-in

Deploy the API and its migration before the frontend. Existing sessions remain valid until a password change.

Reuses Brevo (`BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`). `FRONTEND_URL` must be the canonical frontend origin, e.g. `https://www.bodytrainingguide.com`. Verify delivery after deployment; tests stub Brevo.

Login links use a random 256-bit token, stored only as SHA-256, expire after 15 minutes and are consumed atomically once. The URL fragment is removed on page load. A button consumes the link so mail scanners cannot consume it via GET. Unknown addresses return ACCOUNT_NOT_FOUND (404); non-member accounts return MEMBER_ACCOUNT_REQUIRED (403), as explicitly requested for the login form. Delivery failures return LOGIN_LINK_DELIVERY_FAILED (503); cooldown returns LOGIN_LINK_COOLDOWN (429). A shared database cooldown allows one mail per account per minute; a bounded process-local IP limiter allows 300 requests per 15 minutes (frontend proxy clients may share an IP). Delivery failures invalidate the token and log a generic error.

Authenticated members can change their password without the old one (10 characters minimum, 72 UTF-8 bytes maximum). This invalidates previous member sessions and outstanding login links; the current browser receives a replacement HttpOnly session. Admin authentication is unchanged. Frontend write proxies check Origin.

Account pages: `/fr/mon-compte`, `/account`. Link landing pages: `/fr/connexion/lien`, `/login/link`. API endpoints: POST `/api/auth/login-link` with `{ email, locale }`, POST `/api/auth/login-link/consume` with `{ token }`, authenticated POST `/api/auth/password` with `{ password }`.
