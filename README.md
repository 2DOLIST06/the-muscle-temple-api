# The Muscle Temple — Backend + Admin

Backend + admin **Node.js / TypeScript** pour alimenter un front Next.js externe (repo séparé), avec PostgreSQL + Prisma et déploiement Render.

## Stack
- API: Fastify
- ORM: Prisma
- DB: PostgreSQL
- Validation: Zod
- Auth admin: JWT Bearer
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
- `POST /api/newsletter` avec `{ "email": "abonne@example.com", "source": "footer" }` : enregistre l’adresse en base puis envoie une notification d’inscription à `NEWSLETTER_RECIPIENT_EMAIL` via le serveur SMTP configuré (reprise automatique si une notification précédente a échoué)
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
