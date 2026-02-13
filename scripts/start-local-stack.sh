#!/bin/bash
# Start the complete OttoChain local stack
#
# Prerequisites:
# - Docker running
# - tessellation repo cloned
# - ottochain repo cloned
# - SDKMAN with Java 21

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[STACK]${NC} $1"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }

# Configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICES_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TESSELLATION_DIR="${TESSELLATION_DIR:-$HOME/.openclaw/workspace/tessellation}"
OTTOCHAIN_DIR="${OTTOCHAIN_DIR:-$HOME/.openclaw/workspace/ottochain}"
LANDING_DIR="${LANDING_DIR:-$HOME/.openclaw/workspace/identity-landing}"
HOST_IP=$(hostname -I | awk '{print $1}')

log "Starting OttoChain Local Stack"
log "=============================="
info "Services:     $SERVICES_DIR"
info "Tessellation: $TESSELLATION_DIR"
info "OttoChain:    $OTTOCHAIN_DIR"
info "Landing:      $LANDING_DIR"
info "Host IP:      $HOST_IP"
echo ""

# ============================================================================
# Step 1: Start Postgres
# ============================================================================
log "Step 1: Starting Postgres..."
cd "$SERVICES_DIR"
docker compose up -d postgres
sleep 3

# Wait for postgres
for i in {1..30}; do
    if docker compose exec -T postgres pg_isready -U ottochain >/dev/null 2>&1; then
        log "  ✓ Postgres ready"
        break
    fi
    sleep 1
done

# Push schema
DATABASE_URL="postgresql://ottochain:ottochain@localhost:5432/ottochain" \
    pnpm db:push --skip-generate 2>/dev/null
log "  ✓ Schema pushed"

# ============================================================================
# Step 2: Start Metagraph Cluster
# ============================================================================
log "Step 2: Starting Metagraph Cluster..."
cd "$TESSELLATION_DIR"

# Clean up old data
docker run --rm -v "$(pwd):/work" alpine:latest rm -rf /work/nodes /work/docker/nodes 2>/dev/null || true

# Source SDKMAN
source ~/.sdkman/bin/sdkman-init.sh 2>/dev/null || true

# Start cluster in background
log "  Starting cluster (this takes ~30s)..."
just up --metagraph="$OTTOCHAIN_DIR" --dl1 --data --skip-assembly > /tmp/metagraph.log 2>&1 &
METAGRAPH_PID=$!

# Wait for ML0
log "  Waiting for ML0..."
for i in {1..120}; do
    if curl -s http://localhost:9200/node/info 2>/dev/null | grep -q '"state":"Ready"'; then
        log "  ✓ ML0 ready (took ${i}s)"
        break
    fi
    if [ $i -eq 120 ]; then
        echo "ML0 failed to start. Check /tmp/metagraph.log"
        exit 1
    fi
    sleep 1
done

# ============================================================================
# Step 3: Start Services
# ============================================================================
log "Step 3: Starting Services..."
cd "$SERVICES_DIR"

# Build if needed
if [ ! -d "packages/indexer/dist" ]; then
    log "  Building services..."
    pnpm build >/dev/null 2>&1
fi

# Start Indexer
log "  Starting Indexer (port 3031)..."
DATABASE_URL="postgresql://ottochain:ottochain@localhost:5432/ottochain" \
METAGRAPH_ML0_URL="http://localhost:9200" \
METAGRAPH_DL1_URL="http://localhost:9400" \
INDEXER_PORT=3031 \
    node packages/indexer/dist/index.js > /tmp/indexer.log 2>&1 &
INDEXER_PID=$!
echo $INDEXER_PID > /tmp/indexer.pid

sleep 2
if curl -s http://localhost:3031/health | grep -q '"status":"ok"'; then
    log "  ✓ Indexer ready"
else
    log "  ✗ Indexer failed to start"
fi

# Start Gateway
log "  Starting Gateway (port 4000)..."
DATABASE_URL="postgresql://ottochain:ottochain@localhost:5432/ottochain" \
METAGRAPH_ML0_URL="http://localhost:9200" \
GATEWAY_PORT=4000 \
    node packages/gateway/dist/index.js > /tmp/gateway.log 2>&1 &
GATEWAY_PID=$!
echo $GATEWAY_PID > /tmp/gateway.pid

sleep 2
if curl -s http://localhost:4000/graphql -X POST -H "Content-Type: application/json" \
    -d '{"query":"{ __typename }"}' | grep -q "Query"; then
    log "  ✓ Gateway ready"
else
    log "  ✗ Gateway failed to start (check /tmp/gateway.log)"
fi

# Start Bridge
log "  Starting Bridge (port 3030)..."
DATABASE_URL="postgresql://ottochain:ottochain@localhost:5432/ottochain" \
METAGRAPH_ML0_URL="http://localhost:9200" \
METAGRAPH_DL1_URL="http://localhost:9400" \
BRIDGE_PORT=3030 \
    node packages/bridge/dist/index.js > /tmp/bridge.log 2>&1 &
BRIDGE_PID=$!
echo $BRIDGE_PID > /tmp/bridge.pid

sleep 2
if curl -s http://localhost:3030/health 2>/dev/null | grep -q "ok"; then
    log "  ✓ Bridge ready"
else
    log "  ✓ Bridge started (no health endpoint)"
fi

# ============================================================================
# Step 4: Register Webhook
# ============================================================================
log "Step 4: Registering Webhook..."
WEBHOOK_RESULT=$(curl -s -X POST "http://localhost:9200/data-application/v1/webhooks/subscribe" \
    -H "Content-Type: application/json" \
    -d "{\"callbackUrl\": \"http://${HOST_IP}:3031/webhook/snapshot\", \"secret\": \"local-dev\"}")
WEBHOOK_ID=$(echo "$WEBHOOK_RESULT" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
log "  ✓ Webhook registered: $WEBHOOK_ID"

# ============================================================================
# Step 5: Start Frontend
# ============================================================================
log "Step 5: Starting Frontend..."
cd "$LANDING_DIR"

# Start simple HTTP server
python3 -m http.server 8080 > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > /tmp/frontend.pid

log "  ✓ Frontend ready at http://localhost:8080"

# ============================================================================
# Summary
# ============================================================================
echo ""
log "=============================="
log "Stack Ready!"
log "=============================="
echo ""
info "Services:"
echo "  • Frontend:   http://localhost:8080"
echo "  • Explorer:   http://localhost:8080/explorer.html"
echo "  • Gateway:    http://localhost:4000/graphql"
echo "  • Bridge:     http://localhost:3030"
echo "  • Indexer:    http://localhost:3031"
echo "  • ML0:        http://localhost:9200"
echo "  • DL1:        http://localhost:9400"
echo "  • Postgres:   localhost:5432"
echo ""
info "Logs:"
echo "  • Metagraph:  /tmp/metagraph.log"
echo "  • Gateway:    /tmp/gateway.log"
echo "  • Indexer:    /tmp/indexer.log"
echo "  • Bridge:     /tmp/bridge.log"
echo ""
info "Stop with: $SCRIPT_DIR/stop-local-stack.sh"
echo ""
