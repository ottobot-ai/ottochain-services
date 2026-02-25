-- CreateEnum
CREATE TYPE "MonitoringEventType" AS ENUM ('RESTART', 'ALERT', 'RESOLVED', 'MONITORING_START', 'MONITORING_STOP');

-- CreateEnum
CREATE TYPE "MonitoringSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MonitoringScope" AS ENUM ('INDIVIDUAL_NODE', 'FULL_LAYER', 'FULL_METAGRAPH');

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
CREATE INDEX "MonitoringEvent_timestamp_idx" ON "MonitoringEvent"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "MonitoringEvent_eventType_idx" ON "MonitoringEvent"("eventType");

-- CreateIndex
CREATE INDEX "MonitoringEvent_condition_idx" ON "MonitoringEvent"("condition");
