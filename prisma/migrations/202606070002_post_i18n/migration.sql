-- Add multilingual fields safely: existing posts are English and grouped by their own id.
ALTER TABLE "Post" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "Post" ADD COLUMN "translationGroupId" TEXT;

UPDATE "Post" SET "translationGroupId" = "id" WHERE "translationGroupId" IS NULL;

ALTER TABLE "Post" ALTER COLUMN "translationGroupId" SET NOT NULL;

DROP INDEX IF EXISTS "Post_slug_key";

CREATE UNIQUE INDEX "Post_locale_slug_key" ON "Post"("locale", "slug");
CREATE UNIQUE INDEX "Post_translationGroupId_locale_key" ON "Post"("translationGroupId", "locale");
CREATE INDEX "Post_translationGroupId_idx" ON "Post"("translationGroupId");
CREATE INDEX "Post_locale_status_publishedAt_idx" ON "Post"("locale", "status", "publishedAt");
