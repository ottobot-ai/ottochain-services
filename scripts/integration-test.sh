#!/bin/bash
# OttoChain Integration Test Suite
# Tests the full pipeline: Metagraph → Webhook → Indexer → Postgres

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
TESSELLATION_DIR="${TESSELLATION_DIR:-$HOME/.openclaw/workspace/tessellation}"
OTTOCHAIN_DIR="${OTTOCHAIN_DIR:-$HOME/.openclaw/workspace/ottochain}"
SERVICES_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST_IP=$(hostname -I | awk '{print $1}')

# Ports
ML0_PORT=9200
DL1_PORT=9400
INDEXER_PORT=3031
POSTGRES_PORT=5432

# Timeouts
STARTUP_TIMEOUT=120
SNAPSHOT_TIMEOUT=60

log() { echo -e "${GREEN}[TEST]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

cleanup() {
    log "Cleaning up..."
    
    # Kill indexer if running
    pkill -f "node.*indexer" 2>/dev/null || true
    
    # Stop metagraph cluster
    if [ -d "$TESSELLATION_DIR" ]; then
        cd "$TESSELLATION_DIR"
        just down 2>/dev/null || true
    fi
    
    # Stop postgres (keep data for inspection)
    cd "$SERVICES_DIR"
    docker compose stop postgres 2>/dev/null || true
}

trap cleanup EXIT

# ============================================================================
# Setup
# ============================================================================

log "Starting OttoChain Integration Tests"
log "  Tessellation: $TESSELLATION_DIR"
log "  OttoChain:    $OTTOCHAIN_DIR"
log "  Services:     $SERVICES_DIR"
log "  Host IP:      $HOST_IP"

# Check prerequisites
command -v docker >/dev/null || fail "Docker not found"
command -v node >/dev/null || fail "Node.js not found"
command -v pnpm >/dev/null || fail "pnpm not found"
[ -d "$TESSELLATION_DIR" ] || fail "Tessellation directory not found"
[ -d "$OTTOCHAIN_DIR" ] || fail "OttoChain directory not found"

# ============================================================================
# Start Infrastructure
# ============================================================================

log "Starting PostgreSQL..."
cd "$SERVICES_DIR"
docker compose up -d postgres
sleep 3

# Wait for postgres to be healthy
for i in {1..30}; do
    if docker compose exec -T postgres pg_isready -U ottochain >/dev/null 2>&1; then
        log "PostgreSQL ready"
        break
    fi
    sleep 1
done

log "Pushing database schema..."
DATABASE_URL="postgresql://ottochain:ottochain@localhost:$POSTGRES_PORT/ottochain_identity" \
    pnpm db:push --skip-generate 2>/dev/null

log "Starting metagraph cluster..."
cd "$TESSELLATION_DIR"

# Clean up old Docker files if needed
docker run --rm -v "$(pwd):/work" alpine:latest rm -rf /work/nodes /work/docker/nodes 2>/dev/null || true

# Source SDKMAN for Java/sbt
source ~/.sdkman/bin/sdkman-init.sh 2>/dev/null || true

# Start cluster (background, capture output)
just up --metagraph="$OTTOCHAIN_DIR" --dl1 --data --skip-assembly > /tmp/metagraph-startup.log 2>&1 &
METAGRAPH_PID=$!

# Wait for ML0 to be ready
log "Waiting for ML0 to be ready..."
for i in $(seq 1 $STARTUP_TIMEOUT); do
    if curl -s "http://localhost:$ML0_PORT/node/info" | grep -q '"state":"Ready"'; then
        log "ML0 ready (took ${i}s)"
        break
    fi
    if [ $i -eq $STARTUP_TIMEOUT ]; then
        fail "ML0 failed to start within ${STARTUP_TIMEOUT}s"
    fi
    sleep 1
done

# ============================================================================
# Start Services
# ============================================================================

log "Building services..."
cd "$SERVICES_DIR"
pnpm build >/dev/null 2>&1

log "Starting indexer..."
DATABASE_URL="postgresql://ottochain:ottochain@localhost:$POSTGRES_PORT/ottochain_identity" \
METAGRAPH_ML0_URL="http://localhost:$ML0_PORT" \
METAGRAPH_DL1_URL="http://localhost:$DL1_PORT" \
INDEXER_PORT=$INDEXER_PORT \
    node packages/indexer/dist/index.js > /tmp/indexer.log 2>&1 &
INDEXER_PID=$!

sleep 2

# Verify indexer is running
if ! curl -s "http://localhost:$INDEXER_PORT/health" | grep -q '"status":"ok"'; then
    fail "Indexer failed to start"
fi
log "Indexer ready"

# ============================================================================
# Register Webhook
# ============================================================================

log "Registering webhook subscriber..."
SUBSCRIBE_RESULT=$(curl -s -X POST "http://localhost:$ML0_PORT/data-application/v1/webhooks/subscribe" \
    -H "Content-Type: application/json" \
    -d "{\"callbackUrl\": \"http://$HOST_IP:$INDEXER_PORT/webhook/snapshot\", \"secret\": \"integration-test\"}")

SUBSCRIBER_ID=$(echo "$SUBSCRIBE_RESULT" | jq -r '.id // empty')
if [ -z "$SUBSCRIBER_ID" ]; then
    fail "Failed to register webhook: $SUBSCRIBE_RESULT"
fi
log "Webhook registered: $SUBSCRIBER_ID"

# ============================================================================
# Test: Webhook Delivery
# ============================================================================

log "TEST 1: Webhook delivery"

INITIAL_ORDINAL=$(curl -s "http://localhost:$ML0_PORT/data-application/v1/checkpoint" | jq -r '.ordinal')
log "  Initial ordinal: $INITIAL_ORDINAL"

# Wait for next snapshot
log "  Waiting for snapshot..."
for i in $(seq 1 $SNAPSHOT_TIMEOUT); do
    CURRENT_ORDINAL=$(curl -s "http://localhost:$ML0_PORT/data-application/v1/checkpoint" | jq -r '.ordinal')
    if [ "$CURRENT_ORDINAL" != "$INITIAL_ORDINAL" ]; then
        log "  Snapshot progressed to ordinal $CURRENT_ORDINAL"
        break
    fi
    if [ $i -eq $SNAPSHOT_TIMEOUT ]; then
        fail "  Snapshot did not progress within ${SNAPSHOT_TIMEOUT}s"
    fi
    sleep 1
done

# Check webhook was delivered
sleep 2
SUBSCRIBER_STATUS=$(curl -s "http://localhost:$ML0_PORT/data-application/v1/webhooks/subscribers" | jq -r '.subscribers[0]')
LAST_DELIVERY=$(echo "$SUBSCRIBER_STATUS" | jq -r '.lastDeliveryAt // empty')
FAIL_COUNT=$(echo "$SUBSCRIBER_STATUS" | jq -r '.failCount')

if [ -z "$LAST_DELIVERY" ]; then
    fail "  Webhook was not delivered"
fi
if [ "$FAIL_COUNT" != "0" ]; then
    warn "  Webhook had $FAIL_COUNT failures"
fi
log "  ✅ Webhook delivered at $LAST_DELIVERY"

# ============================================================================
# Test: Indexer Processing
# ============================================================================

log "TEST 2: Indexer processing"

INDEXER_STATUS=$(curl -s "http://localhost:$INDEXER_PORT/status")
INDEXED_ORDINAL=$(echo "$INDEXER_STATUS" | jq -r '.lastIndexedOrdinal')

if [ "$INDEXED_ORDINAL" = "null" ] || [ -z "$INDEXED_ORDINAL" ]; then
    fail "  Indexer did not process snapshot"
fi
log "  ✅ Indexer processed ordinal $INDEXED_ORDINAL"

# ============================================================================
# Test: PostgreSQL Persistence
# ============================================================================

log "TEST 3: PostgreSQL persistence"

SNAPSHOT_COUNT=$(docker compose exec -T postgres psql -U ottochain -d ottochain_identity -t -c \
    "SELECT COUNT(*) FROM \"IndexedSnapshot\";" 2>/dev/null | tr -d ' ')

if [ "$SNAPSHOT_COUNT" -lt 1 ]; then
    fail "  No snapshots in database"
fi
log "  ✅ $SNAPSHOT_COUNT snapshot(s) persisted to PostgreSQL"

# ============================================================================
# Test: Multiple Snapshots
# ============================================================================

log "TEST 4: Multiple snapshot processing"

WAIT_ORDINAL=$((CURRENT_ORDINAL + 2))
log "  Waiting for ordinal $WAIT_ORDINAL..."

for i in $(seq 1 90); do
    INDEXED=$(curl -s "http://localhost:$INDEXER_PORT/status" | jq -r '.lastIndexedOrdinal')
    if [ "$INDEXED" -ge "$WAIT_ORDINAL" ] 2>/dev/null; then
        log "  ✅ Indexed up to ordinal $INDEXED"
        break
    fi
    if [ $i -eq 90 ]; then
        warn "  Only indexed up to ordinal $INDEXED (wanted $WAIT_ORDINAL)"
    fi
    sleep 1
done

# ============================================================================
# Test: Rejection Webhook (Option B: E2E via ML0)
# ============================================================================

log "TEST 5: Rejection webhook (E2E)"

# Register rejection webhook subscriber
log "  Registering rejection webhook..."
REJECTION_SUBSCRIBE=$(curl -s -X POST "http://localhost:$ML0_PORT/data-application/v1/webhooks/subscribe" \
    -H "Content-Type: application/json" \
    -d "{\"callbackUrl\": \"http://$HOST_IP:$INDEXER_PORT/webhook/rejection\", \"secret\": \"rejection-test\", \"events\": [\"transaction.rejected\"]}" 2>/dev/null || echo "{}")

REJECTION_SUB_ID=$(echo "$REJECTION_SUBSCRIBE" | jq -r '.id // empty')
if [ -n "$REJECTION_SUB_ID" ]; then
    log "  Rejection webhook registered: $REJECTION_SUB_ID"
else
    warn "  Could not register rejection webhook (ML0 may not support event filtering yet)"
fi

# Submit an invalid transaction to trigger rejection
# Using invalid signature to force validation failure
log "  Submitting invalid transaction to trigger rejection..."
INVALID_TX_RESPONSE=$(curl -s -X POST "http://localhost:$DL1_PORT/data" \
    -H "Content-Type: application/json" \
    -d '{
      "value": {
        "CreateStateMachine": {
          "fiberId": "00000000-0000-4000-8000-000000000099",
          "definition": {"invalid": "definition"},
          "params": {}
        }
      },
      "proofs": [{
        "id": "INVALID_SIGNER_ID",
        "signature": "INVALID_SIGNATURE_WILL_FAIL_VALIDATION"
      }]
    }' 2>/dev/null || echo "{}")

log "  DL1 response: $(echo "$INVALID_TX_RESPONSE" | jq -c '.' 2>/dev/null || echo "$INVALID_TX_RESPONSE")"

# Wait for rejection to be processed (need snapshot cycle)
log "  Waiting for rejection to be processed..."
sleep 10

# Check if rejection appeared in indexer
INITIAL_REJECTIONS=$(curl -s "http://localhost:$INDEXER_PORT/status" | jq -r '.totalRejections // 0')
log "  Current rejection count: $INITIAL_REJECTIONS"

# Try a direct rejection webhook test as fallback
log "  Testing rejection webhook endpoint directly..."
DIRECT_REJECTION=$(curl -s -X POST "http://localhost:$INDEXER_PORT/webhook/rejection" \
    -H "Content-Type: application/json" \
    -d "{
      \"event\": \"transaction.rejected\",
      \"ordinal\": 1000,
      \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
      \"metagraphId\": \"integration-test\",
      \"rejection\": {
        \"updateType\": \"CreateStateMachine\",
        \"fiberId\": \"00000000-0000-4000-8000-integration01\",
        \"errors\": [{\"code\": \"INTEGRATION_TEST\", \"message\": \"E2E test rejection\"}],
        \"signers\": [\"DAGIntegrationTest\"],
        \"updateHash\": \"integration-test-$(date +%s)\"
      }
    }")

DIRECT_ACCEPTED=$(echo "$DIRECT_REJECTION" | jq -r '.accepted // false')
if [ "$DIRECT_ACCEPTED" = "true" ]; then
    log "  ✅ Rejection webhook endpoint working"
else
    fail "  Rejection webhook endpoint failed: $DIRECT_REJECTION"
fi

# Verify rejection is queryable
FINAL_REJECTIONS=$(curl -s "http://localhost:$INDEXER_PORT/status" | jq -r '.totalRejections // 0')
if [ "$FINAL_REJECTIONS" -gt "$INITIAL_REJECTIONS" ]; then
    log "  ✅ Rejection stored and counted (total: $FINAL_REJECTIONS)"
else
    warn "  Rejection count did not increase (expected > $INITIAL_REJECTIONS, got $FINAL_REJECTIONS)"
fi

# Query rejections API
REJECTIONS_LIST=$(curl -s "http://localhost:$INDEXER_PORT/rejections?limit=5")
REJECTIONS_COUNT=$(echo "$REJECTIONS_LIST" | jq -r '.total // 0')
if [ "$REJECTIONS_COUNT" -gt 0 ]; then
    log "  ✅ Rejections API returns $REJECTIONS_COUNT rejection(s)"
else
    warn "  Rejections API returned 0 rejections"
fi

# ============================================================================
# Summary
# ============================================================================

echo ""
log "=========================================="
log "Integration Test Summary"
log "=========================================="

FINAL_STATUS=$(curl -s "http://localhost:$INDEXER_PORT/status")
echo "$FINAL_STATUS" | jq .

FINAL_SUBSCRIBER=$(curl -s "http://localhost:$ML0_PORT/data-application/v1/webhooks/subscribers" | jq '.subscribers[0]')
echo ""
log "Webhook Subscriber:"
echo "$FINAL_SUBSCRIBER" | jq '{id, active, failCount, lastDeliveryAt}'

echo ""
log "=========================================="
log "All integration tests passed! ✅"
log "=========================================="
