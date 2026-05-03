# Intégration de Payload CMS (préparation)

## Statut dans cet environnement

L'installation automatique via `npm install payload` a échoué avec une erreur `403 Forbidden` depuis le registre npm de l'environnement.

## Commandes à lancer sur un environnement npm autorisé

```bash
npm install payload @payloadcms/richtext-lexical
```

Puis initialiser Payload (si vous souhaitez l'app dédiée) :

```bash
npx create-payload-app@latest
```

## Recommandation pour ce repo (Fastify API existante)

- Garder cette API Fastify pour le métier.
- Démarrer Payload en service séparé (même base de données possible).
- Consommer les contenus blog via l'API Payload depuis le front.

## Collections minimales à créer

- `posts` (title, slug, excerpt, content, coverImage, publishedAt, status)
- `categories` (name, slug)
- `authors` (name, bio, avatar)

## Variables d'environnement minimales

- `PAYLOAD_SECRET`
- `DATABASE_URI`

## Étapes de bascule

1. Installer Payload dans un environnement npm autorisé.
2. Créer les collections blog.
3. Migrer 2-3 articles de test.
4. Connecter le front au nouvel endpoint blog.
5. Basculer la production.
