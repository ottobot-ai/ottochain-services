-- CreateEnum
CREATE TYPE "FiberStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'FAILED');

-- CreateEnum
CREATE TYPE "SnapshotStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ORPHANED');

-- CreateEnum
CREATE TYPE "AgentState" AS ENUM ('UNSPECIFIED', 'REGISTERED', 'ACTIVE', 'CHALLENGED', 'SUSPENDED', 'PROBATION', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('DISCORD', 'TELEGRAM', 'TWITTER', 'GITHUB', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AttestationType" AS ENUM ('COMPLETION', 'VOUCH', 'VIOLATION', 'BEHAVIORAL');

-- CreateEnum
CREATE TYPE "ContractState" AS ENUM ('UNSPECIFIED', 'PROPOSED', 'ACTIVE', 'COMPLETED', 'REJECTED', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StatsGranularity" AS ENUM ('FIVE_MIN', 'HOURLY', 'DAILY');

-- CreateEnum
CREATE TYPE "MonitoringEventType" AS ENUM ('RESTART', 'ALERT', 'RESOLVED', 'MONITORING_START', 'MONITORING_STOP');

-- CreateEnum
CREATE TYPE "MonitoringSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MonitoringScope" AS ENUM ('INDIVIDUAL_NODE', 'FULL_LAYER', 'FULL_METAGRAPH');

-- CreateTable
CREATE TABLE "Agent" (
    "id" SERIAL NOT NULL,
    "address" VARCHAR(64) NOT NULL,
    "publicKey" VARCHAR(128) NOT NULL,
    "displayName" VARCHAR(255),
    "reputation" INTEGER NOT NULL DEFAULT 10,
    "state" "AgentState" NOT NULL DEFAULT 'REGISTERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fiberId" VARCHAR(64),
    "snapshotOrdinal" BIGINT NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformLink" (
    "id" SERIAL NOT NULL,
    "agentId" INTEGER NOT NULL,
    "platform" "Platform" NOT NULL,
    "platformUserId" VARCHAR(128) NOT NULL,
    "platformUsername" VARCHAR(255),
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PlatformLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attestation" (
    "id" SERIAL NOT NULL,
    "agentId" INTEGER NOT NULL,
    "type" "AttestationType" NOT NULL,
    "issuerId" INTEGER,
    "issuerPlatform" "Platform",
    "delta" INTEGER NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "txHash" VARCHAR(64) NOT NULL,
    "snapshotOrdinal" BIGINT NOT NULL,

    CONSTRAINT "Attestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" SERIAL NOT NULL,
    "contractId" VARCHAR(64) NOT NULL,
    "proposerId" INTEGER NOT NULL,
    "counterpartyId" INTEGER NOT NULL,
    "state" "ContractState" NOT NULL,
    "terms" JSONB NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "fiberId" VARCHAR(64) NOT NULL,
    "snapshotOrdinal" BIGINT NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReputationHistory" (
    "id" SERIAL NOT NULL,
    "agentId" INTEGER NOT NULL,
    "reputation" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL DEFAULT 0,
    "reason" VARCHAR(255),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotOrdinal" BIGINT NOT NULL,

    CONSTRAINT "ReputationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fiber" (
    "fiberId" VARCHAR(64) NOT NULL,
    "workflowType" VARCHAR(128) NOT NULL,
    "workflowDesc" VARCHAR(512),
    "currentState" VARCHAR(64) NOT NULL,
    "status" "FiberStatus" NOT NULL DEFAULT 'ACTIVE',
    "owners" TEXT[],
    "stateData" JSONB NOT NULL,
    "definition" JSONB NOT NULL,
    "sequenceNumber" INTEGER NOT NULL DEFAULT 0,
    "createdOrdinal" BIGINT NOT NULL,
    "updatedOrdinal" BIGINT NOT NULL,
    "createdGl0Ordinal" BIGINT,
    "updatedGl0Ordinal" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fiber_pkey" PRIMARY KEY ("fiberId")
);

-- CreateTable
CREATE TABLE "FiberTransition" (
    "id" SERIAL NOT NULL,
    "fiberId" VARCHAR(64) NOT NULL,
    "eventName" VARCHAR(64) NOT NULL,
    "fromState" VARCHAR(64) NOT NULL,
    "toState" VARCHAR(64) NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "gasUsed" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "snapshotOrdinal" BIGINT NOT NULL,
    "gl0Ordinal" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiberTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexedSnapshot" (
    "ordinal" BIGINT NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "status" "SnapshotStatus" NOT NULL DEFAULT 'PENDING',
    "gl0Ordinal" BIGINT,
    "confirmedAt" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentsUpdated" INTEGER NOT NULL DEFAULT 0,
    "contractsUpdated" INTEGER NOT NULL DEFAULT 0,
    "fibersUpdated" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IndexedSnapshot_pkey" PRIMARY KEY ("ordinal")
);

-- CreateTable
CREATE TABLE "SnapshotSubscriber" (
    "id" SERIAL NOT NULL,
    "callbackUrl" VARCHAR(512) NOT NULL,
    "secret" VARCHAR(128),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPingAt" TIMESTAMP(3),
    "failCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SnapshotSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatsSnapshot" (
    "id" SERIAL NOT NULL,
    "bucketTime" TIMESTAMP(3) NOT NULL,
    "granularity" "StatsGranularity" NOT NULL DEFAULT 'FIVE_MIN',
    "totalAgents" INTEGER NOT NULL,
    "activeAgents" INTEGER NOT NULL,
    "totalContracts" INTEGER NOT NULL,
    "completedContracts" INTEGER NOT NULL,
    "totalAttestations" INTEGER NOT NULL,
    "totalFibers" INTEGER NOT NULL,
    "snapshotOrdinal" BIGINT NOT NULL,
    "snapshotsInPeriod" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RejectedTransaction" (
    "id" SERIAL NOT NULL,
    "ordinal" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "updateType" VARCHAR(64) NOT NULL,
    "fiberId" VARCHAR(64) NOT NULL,
    "updateHash" VARCHAR(64) NOT NULL,
    "errors" JSONB NOT NULL,
    "signers" TEXT[],
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RejectedTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatsDelta" (
    "id" SERIAL NOT NULL,
    "period" VARCHAR(16) NOT NULL,
    "agentsDelta" INTEGER NOT NULL DEFAULT 0,
    "contractsDelta" INTEGER NOT NULL DEFAULT 0,
    "attestationsDelta" INTEGER NOT NULL DEFAULT 0,
    "fibersDelta" INTEGER NOT NULL DEFAULT 0,
    "agentsPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contractsPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "successRatePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgSnapshotsPerHour" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatsDelta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringEvent" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" "MonitoringEventType" NOT NULL,
    "condition" VARCHAR(64),
    "severity" "MonitoringSeverity",
    "scope" "MonitoringScope",
    "affectedNodes" TEXT[],
    "affectedLayers" TEXT[],
    "success" BOOLEAN,
    "message" VARCHAR(512),
    "details" JSONB,

    CONSTRAINT "MonitoringEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_address_key" ON "Agent"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_fiberId_key" ON "Agent"("fiberId");

-- CreateIndex
CREATE INDEX "Agent_reputation_idx" ON "Agent"("reputation" DESC);

-- CreateIndex
CREATE INDEX "Agent_state_idx" ON "Agent"("state");

-- CreateIndex
CREATE INDEX "Agent_createdAt_idx" ON "Agent"("createdAt");

-- CreateIndex
CREATE INDEX "PlatformLink_agentId_idx" ON "PlatformLink"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformLink_platform_platformUserId_key" ON "PlatformLink"("platform", "platformUserId");

-- CreateIndex
CREATE INDEX "Attestation_agentId_idx" ON "Attestation"("agentId");

-- CreateIndex
CREATE INDEX "Attestation_type_idx" ON "Attestation"("type");

-- CreateIndex
CREATE INDEX "Attestation_createdAt_idx" ON "Attestation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_contractId_key" ON "Contract"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_fiberId_key" ON "Contract"("fiberId");

-- CreateIndex
CREATE INDEX "Contract_proposerId_idx" ON "Contract"("proposerId");

-- CreateIndex
CREATE INDEX "Contract_counterpartyId_idx" ON "Contract"("counterpartyId");

-- CreateIndex
CREATE INDEX "Contract_state_idx" ON "Contract"("state");

-- CreateIndex
CREATE INDEX "ReputationHistory_agentId_recordedAt_idx" ON "ReputationHistory"("agentId", "recordedAt");

-- CreateIndex
CREATE INDEX "ReputationHistory_recordedAt_idx" ON "ReputationHistory"("recordedAt");

-- CreateIndex
CREATE INDEX "Fiber_workflowType_idx" ON "Fiber"("workflowType");

-- CreateIndex
CREATE INDEX "Fiber_status_idx" ON "Fiber"("status");

-- CreateIndex
CREATE INDEX "Fiber_currentState_idx" ON "Fiber"("currentState");

-- CreateIndex
CREATE INDEX "Fiber_createdAt_idx" ON "Fiber"("createdAt");

-- CreateIndex
CREATE INDEX "Fiber_owners_idx" ON "Fiber"("owners");

-- CreateIndex
CREATE INDEX "FiberTransition_fiberId_createdAt_idx" ON "FiberTransition"("fiberId", "createdAt");

-- CreateIndex
CREATE INDEX "FiberTransition_eventName_idx" ON "FiberTransition"("eventName");

-- CreateIndex
CREATE INDEX "FiberTransition_snapshotOrdinal_idx" ON "FiberTransition"("snapshotOrdinal");

-- CreateIndex
CREATE INDEX "IndexedSnapshot_status_idx" ON "IndexedSnapshot"("status");

-- CreateIndex
CREATE INDEX "IndexedSnapshot_hash_idx" ON "IndexedSnapshot"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "SnapshotSubscriber_callbackUrl_key" ON "SnapshotSubscriber"("callbackUrl");

-- CreateIndex
CREATE INDEX "SnapshotSubscriber_active_idx" ON "SnapshotSubscriber"("active");

-- CreateIndex
CREATE INDEX "StatsSnapshot_bucketTime_idx" ON "StatsSnapshot"("bucketTime");

-- CreateIndex
CREATE INDEX "StatsSnapshot_granularity_bucketTime_idx" ON "StatsSnapshot"("granularity", "bucketTime");

-- CreateIndex
CREATE UNIQUE INDEX "StatsSnapshot_bucketTime_granularity_key" ON "StatsSnapshot"("bucketTime", "granularity");

-- CreateIndex
CREATE UNIQUE INDEX "RejectedTransaction_updateHash_key" ON "RejectedTransaction"("updateHash");

-- CreateIndex
CREATE INDEX "RejectedTransaction_fiberId_idx" ON "RejectedTransaction"("fiberId");

-- CreateIndex
CREATE INDEX "RejectedTransaction_ordinal_idx" ON "RejectedTransaction"("ordinal" DESC);

-- CreateIndex
CREATE INDEX "RejectedTransaction_updateType_idx" ON "RejectedTransaction"("updateType");

-- CreateIndex
CREATE INDEX "RejectedTransaction_createdAt_idx" ON "RejectedTransaction"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "RejectedTransaction_timestamp_idx" ON "RejectedTransaction"("timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "StatsDelta_period_key" ON "StatsDelta"("period");

-- CreateIndex
CREATE INDEX "MonitoringEvent_timestamp_idx" ON "MonitoringEvent"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "MonitoringEvent_eventType_idx" ON "MonitoringEvent"("eventType");

-- CreateIndex
CREATE INDEX "MonitoringEvent_condition_idx" ON "MonitoringEvent"("condition");

-- AddForeignKey
ALTER TABLE "PlatformLink" ADD CONSTRAINT "PlatformLink_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attestation" ADD CONSTRAINT "Attestation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attestation" ADD CONSTRAINT "Attestation_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReputationHistory" ADD CONSTRAINT "ReputationHistory_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiberTransition" ADD CONSTRAINT "FiberTransition_fiberId_fkey" FOREIGN KEY ("fiberId") REFERENCES "Fiber"("fiberId") ON DELETE CASCADE ON UPDATE CASCADE;

