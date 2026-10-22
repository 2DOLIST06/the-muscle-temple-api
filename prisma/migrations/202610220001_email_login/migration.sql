ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "loginTokenHash" TEXT, ADD COLUMN "loginTokenExpiresAt" TIMESTAMP(3), ADD COLUMN "loginLinkRequestedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_loginTokenHash_key" ON "User"("loginTokenHash");
