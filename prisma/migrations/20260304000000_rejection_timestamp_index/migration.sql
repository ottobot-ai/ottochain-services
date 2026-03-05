-- Add index for efficient date-range queries on RejectedTransaction timestamp
CREATE INDEX "RejectedTransaction_timestamp_idx" ON "RejectedTransaction"("timestamp" DESC);
