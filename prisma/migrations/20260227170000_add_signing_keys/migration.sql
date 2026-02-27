-- CreateEnum
CREATE TYPE "SigningMode" AS ENUM ('SERVER', 'SELF');

-- CreateTable
CREATE TABLE "SigningKey" (
    "fiberId" VARCHAR(64) NOT NULL,
    "signingMode" "SigningMode" NOT NULL,
    "publicKey" VARCHAR(128) NOT NULL,
    "address" VARCHAR(64) NOT NULL,
    "encryptedKey" TEXT,
    "keyIv" VARCHAR(32),
    "keyTag" VARCHAR(32),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "SigningKey_pkey" PRIMARY KEY ("fiberId")
);

-- CreateIndex
CREATE INDEX "SigningKey_signingMode_idx" ON "SigningKey"("signingMode");

-- CreateIndex
CREATE INDEX "SigningKey_address_idx" ON "SigningKey"("address");
