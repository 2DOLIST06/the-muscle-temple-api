-- Safe to run in DBeaver before prisma migrate deploy.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "newsletterSubscriberId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_newsletterSubscriberId_key" ON "User"("newsletterSubscriberId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_newsletterSubscriberId_fkey' AND conrelid = '"User"'::regclass) THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_newsletterSubscriberId_fkey"
    FOREIGN KEY ("newsletterSubscriberId") REFERENCES "newsletter_subscribers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END; $$;
