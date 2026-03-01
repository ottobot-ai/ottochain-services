-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('CREATE_STATE_MACHINE', 'TRANSITION_STATE_MACHINE', 'ARCHIVE_STATE_MACHINE', 'CREATE_SCRIPT', 'INVOKE_SCRIPT');

-- CreateTable
CREATE TABLE "OttochainEvent" (
    "id" SERIAL NOT NULL,
    "snapshotOrdinal" BIGINT NOT NULL,
    "snapshotHash" VARCHAR(64) NOT NULL,
    "blockRoundId" INTEGER,
    "transactionHash" VARCHAR(128) NOT NULL,
    "messageType" "MessageType" NOT NULL,
    "fiberId" VARCHAR(64) NOT NULL,
    "signer" VARCHAR(128) NOT NULL,
    "payload" JSONB NOT NULL,
    "eventName" VARCHAR(64),
    "targetSeqNum" INTEGER,
    "method" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OttochainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OttochainEvent_snapshotOrdinal_idx" ON "OttochainEvent"("snapshotOrdinal");
CREATE INDEX "OttochainEvent_snapshotHash_idx" ON "OttochainEvent"("snapshotHash");
CREATE INDEX "OttochainEvent_fiberId_idx" ON "OttochainEvent"("fiberId");
CREATE INDEX "OttochainEvent_messageType_idx" ON "OttochainEvent"("messageType");
CREATE INDEX "OttochainEvent_signer_idx" ON "OttochainEvent"("signer");
CREATE UNIQUE INDEX "OttochainEvent_transactionHash_key" ON "OttochainEvent"("transactionHash");
