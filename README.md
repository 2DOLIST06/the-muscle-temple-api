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
- `PORT` (par défaut 4000)
- `APP_URL`
- `ADMIN_EMAIL` (seed)
- `ADMIN_PASSWORD` (seed)

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
- `GET /api/posts`
- `GET /api/posts/:slug`
- `GET /api/categories`
- `GET /api/categories/:slug/posts`
- `GET /api/authors`
- `GET /api/authors/:slug/posts`
- `GET /api/seo/pages/:key`

## Endpoints admin (`/admin-api`)
- Auth: `POST /admin-api/auth/login`
- Dashboard: `GET /admin-api/dashboard`
- CRUD: posts / categories / authors
- Supporting: tags / media / page SEO

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

## Notes de solidité
- `dotenv/config` est chargé au boot serveur et pour le seed.
- CORS valide explicitement les origines autorisées (front Next.js externe).
- Seed idempotent pour éviter les duplications majeures.
- Schéma Prisma avec slugs uniques, statuts de publication, SEO unifié, relations tags et articles liés.
