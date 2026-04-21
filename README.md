# The Muscle Temple — Backend + Admin

Base professionnelle **Node.js + TypeScript** pour un blog fitness/musculation, pensée pour alimenter un front Next.js externe.

## Stack retenue
- **API**: Fastify + TypeScript
- **ORM / DB**: Prisma + PostgreSQL
- **Validation**: Zod
- **Auth admin**: JWT (Bearer)
- **Admin panel**: interface web intégrée (route `/admin`) connectée à l’API admin
- **Déploiement cible back**: Render

## Architecture
```txt
.
├─ prisma/
│  ├─ schema.prisma
│  └─ seed.ts
├─ src/
│  ├─ config/env.ts
│  ├─ db/client.ts
│  ├─ lib/
│  │  ├─ auth.ts
│  │  └─ slug.ts
│  ├─ routes/
│  │  ├─ public/index.ts      # API publique (front Next.js)
│  │  └─ admin/
│  │     ├─ api.ts            # API admin sécurisée
│  │     └─ panel.ts          # Interface admin web
│  └─ validation/
│     ├─ common.ts
│     └─ admin.ts
├─ .env.example
├─ render.yaml
└─ package.json
```

## Modèle de données (PostgreSQL)
Tables principales:
- `users` (admin/editor)
- `authors`
- `categories`
- `posts`
- `tags`
- `post_tags`
- `seo_metadata`
- `media`
- `post_relation` (articles liés)

Points clés:
- slugs uniques (`posts`, `authors`, `categories`, `tags`)
- statuts `DRAFT` / `PUBLISHED` / `ARCHIVED`
- SEO unifié (posts / catégories / auteurs / pages)
- relation N-N tags et relation d’articles liés

## Variables d’environnement
Copier `.env.example` vers `.env`:

```bash
cp .env.example .env
```

Variables:
- `DATABASE_URL` (PostgreSQL)
- `PORT` (par défaut 4000)
- `JWT_SECRET` (>= 16 chars)
- `APP_URL`
- `CORS_ORIGIN` (URL du front Next.js)
- `ADMIN_EMAIL` (pour seed)
- `ADMIN_PASSWORD` (pour seed)

## Installation & démarrage local
```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run seed
npm run dev
```

API disponible sur `http://localhost:4000`.

## Build & run production
```bash
npm run build
npm run start
```

## Endpoints publics (front Next.js)
Préfixe: `/api`

- `GET /api/posts` → liste des articles publiés
- `GET /api/posts/:slug` → article + SEO + tags + articles liés
- `GET /api/categories`
- `GET /api/categories/:slug/posts`
- `GET /api/authors`
- `GET /api/authors/:slug/posts`
- `GET /api/seo/pages/:key`

## Endpoints admin (JWT requis)
Préfixe: `/admin-api`

Auth:
- `POST /admin-api/auth/login`

Dashboard:
- `GET /admin-api/dashboard`

CRUD:
- Posts: `GET/POST/PUT/DELETE /admin-api/posts...`
- Categories: `GET/POST/PUT/DELETE /admin-api/categories...`
- Authors: `GET/POST/PUT/DELETE /admin-api/authors...`
- Tags: `GET/POST /admin-api/tags`
- Media: `GET/POST /admin-api/media`
- SEO page: `GET/PUT /admin-api/seo/page/:key`

## Admin panel
- Login: `GET /admin`
- Dashboard: `GET /admin/dashboard`

Cette V1 admin est volontairement sobre, mais exploitable immédiatement pour:
- visualiser les stats
- créer des articles
- voir posts/catégories/auteurs

## Créer le premier admin
Le script seed crée/met à jour automatiquement le compte admin à partir de:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Commande:
```bash
npm run seed
```

## Déploiement Render
Le fichier `render.yaml` est prêt.

Variables à configurer dans Render:
- `DATABASE_URL`
- `JWT_SECRET`
- `APP_URL`
- `CORS_ORIGIN`

Build command:
```bash
npm ci && npm run prisma:generate && npm run build
```

Start command:
```bash
npm run prisma:deploy && npm run start
```

## Connexion avec le front Next.js (repo séparé)
Le front doit pointer vers l’URL Render du backend et consommer les endpoints `/api/*`.

Exemple côté Next.js:
- Liste articles: `GET ${API_URL}/api/posts`
- Détail article: `GET ${API_URL}/api/posts/[slug]`
- Catégorie: `GET ${API_URL}/api/categories/[slug]/posts`
- Auteur: `GET ${API_URL}/api/authors/[slug]/posts`

## Évolutions prévues (roadmap)
- upload média (S3/Cloudinary) via signed URLs
- éditeur block JSON enrichi
- audit log
- scheduling publication avancée
- multi-tenant pour réutilisation multi blogs
