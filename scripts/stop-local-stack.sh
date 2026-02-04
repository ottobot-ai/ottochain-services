#!/bin/bash
# Stop the OttoChain local stack

set -e

GREEN='\033[0;32m'
NC='\033[0m'

log() { echo -e "${GREEN}[STACK]${NC} $1"; }

log "Stopping OttoChain Local Stack..."

# Stop frontend
if [ -f /tmp/frontend.pid ]; then
    kill $(cat /tmp/frontend.pid) 2>/dev/null || true
    rm /tmp/frontend.pid
    log "  ✓ Frontend stopped"
fi

# Stop bridge
if [ -f /tmp/bridge.pid ]; then
    kill $(cat /tmp/bridge.pid) 2>/dev/null || true
    rm /tmp/bridge.pid
    log "  ✓ Bridge stopped"
fi

# Stop gateway
if [ -f /tmp/gateway.pid ]; then
    kill $(cat /tmp/gateway.pid) 2>/dev/null || true
    rm /tmp/gateway.pid
    log "  ✓ Gateway stopped"
fi

# Stop indexer
if [ -f /tmp/indexer.pid ]; then
    kill $(cat /tmp/indexer.pid) 2>/dev/null || true
    rm /tmp/indexer.pid
    log "  ✓ Indexer stopped"
fi

# Stop metagraph
TESSELLATION_DIR="${TESSELLATION_DIR:-$HOME/.openclaw/workspace/tessellation}"
if [ -d "$TESSELLATION_DIR" ]; then
    cd "$TESSELLATION_DIR"
    just down 2>/dev/null || true
    log "  ✓ Metagraph stopped"
fi

# Stop postgres (optional - keep data)
SERVICES_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SERVICES_DIR"
docker compose stop postgres 2>/dev/null || true
log "  ✓ Postgres stopped"

log "Stack stopped!"
