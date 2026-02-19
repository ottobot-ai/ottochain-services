#!/usr/bin/env bash
# Robust cluster startup with join retry logic
# Based on patterns from tessellation CI
#
# Usage: wait-for-cluster.sh <layer> <ports> [join_target_port]
# Example: wait-for-cluster.sh dl1 "9400 9410 9420" 9400

set -euo pipefail

LAYER="${1:-}"
PORTS="${2:-}"
JOIN_TARGET_PORT="${3:-}"

MAX_RESPONSIVE_WAIT=120
MAX_JOINABLE_WAIT=60
MAX_JOIN_ATTEMPTS=5
JOIN_RETRY_DELAY=5
MAX_READY_WAIT=90

log() { echo "[$(date '+%H:%M:%S')] $*"; }
error() { echo "[$(date '+%H:%M:%S')] ERROR: $*" >&2; }

wait_responsive() {
    local port=$1
    local name=$2
    log "Waiting for $name (port $port) to be responsive..."
    for i in $(seq 1 $MAX_RESPONSIVE_WAIT); do
        if curl -sf "http://localhost:$port/node/info" | jq -e '.state' >/dev/null 2>&1; then
            log "$name responding after ${i}s"
            return 0
        fi
        sleep 1
    done
    error "$name not responsive after ${MAX_RESPONSIVE_WAIT}s"
    return 1
}

wait_joinable() {
    local port=$1
    local name=$2
    log "Waiting for $name to leave SessionStarted state..."
    for i in $(seq 1 $MAX_JOINABLE_WAIT); do
        local state=$(curl -sf "http://localhost:$port/node/info" | jq -r '.state // "unknown"' 2>/dev/null || echo "error")
        if [ "$state" != "SessionStarted" ] && [ "$state" != "error" ] && [ "$state" != "unknown" ]; then
            log "$name in state '$state', ready to join"
            return 0
        fi
        sleep 2
    done
    error "$name still in SessionStarted after ${MAX_JOINABLE_WAIT}s"
    return 1
}

join_cluster() {
    local cli_port=$1
    local target_port=$2
    local name=$3
    
    # Get target node's peer ID
    local target_id=$(curl -sf "http://localhost:$target_port/node/info" | jq -r '.id' 2>/dev/null)
    if [ -z "$target_id" ] || [ "$target_id" = "null" ]; then
        error "Could not get peer ID from target node on port $target_port"
        return 1
    fi
    
    # Get target node's P2P port (public port + 1)
    local target_p2p_port=$((target_port + 1))
    
    log "Joining $name to cluster via port $cli_port -> target $target_id"
    
    for attempt in $(seq 1 $MAX_JOIN_ATTEMPTS); do
        local response=$(curl -sf -X POST "http://localhost:$cli_port/cluster/join" \
            -H "Content-Type: application/json" \
            -d "{\"id\":\"$target_id\", \"ip\": \"127.0.0.1\", \"p2pPort\": $target_p2p_port}" 2>&1 || true)
        
        # Check if join was accepted (empty response or success message)
        if [ -z "$response" ] || echo "$response" | grep -qi "success\|ok\|joined"; then
            log "$name join request accepted (attempt $attempt)"
            return 0
        fi
        
        # Check for "already in cluster" which is also success
        if echo "$response" | grep -qi "already"; then
            log "$name already in cluster"
            return 0
        fi
        
        log "$name join attempt $attempt/$MAX_JOIN_ATTEMPTS failed: $response"
        
        if [ $attempt -lt $MAX_JOIN_ATTEMPTS ]; then
            sleep $JOIN_RETRY_DELAY
        fi
    done
    
    error "$name failed to join cluster after $MAX_JOIN_ATTEMPTS attempts"
    return 1
}

wait_ready() {
    local port=$1
    local name=$2
    log "Waiting for $name to reach Ready state..."
    for i in $(seq 1 $MAX_READY_WAIT); do
        local state=$(curl -sf "http://localhost:$port/node/info" | jq -r '.state' 2>/dev/null || echo "error")
        if [ "$state" = "Ready" ]; then
            log "$name Ready after ${i}s"
            return 0
        fi
        sleep 2
    done
    error "$name not Ready after ${MAX_READY_WAIT}s (last state: $state)"
    docker logs "${name}" 2>&1 | tail -20 || true
    return 1
}

# Main logic
if [ -z "$LAYER" ] || [ -z "$PORTS" ]; then
    echo "Usage: $0 <layer> <ports> [join_target_port]"
    echo "Example: $0 dl1 '9400 9410 9420' 9400"
    exit 1
fi

log "Starting $LAYER cluster setup for ports: $PORTS"

FIRST_PORT=""
for port in $PORTS; do
    node_name="${LAYER}-$((($port % 100) / 10))"
    cli_port=$((port + 2))
    
    # Step 1: Wait for node to be responsive
    wait_responsive "$port" "$node_name" || exit 1
    
    # Step 2: Wait for node to be joinable
    wait_joinable "$port" "$node_name" || exit 1
    
    # Step 3: Join cluster (skip first node - it's genesis/initial)
    if [ -n "$FIRST_PORT" ] && [ -n "$JOIN_TARGET_PORT" ]; then
        join_cluster "$cli_port" "$JOIN_TARGET_PORT" "$node_name" || exit 1
    else
        FIRST_PORT="$port"
        log "$node_name is initial node, skipping join"
    fi
    
    # Step 4: Wait for Ready state
    wait_ready "$port" "$node_name" || exit 1
done

log "✓ All $LAYER nodes ready"
