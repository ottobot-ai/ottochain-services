#!/usr/bin/env bash
# Sequential cluster join with clusterSession validation.
#
# Usage: wait-for-cluster.sh <layer> <ports> [join_target_port]
# Example: wait-for-cluster.sh dl1 "9400 9410 9420" 9400
#
# Strategy:
#   1. Genesis node (first port): wait for Ready
#   2. Each subsequent node: wait for responsive + joinable state, send join, wait for Ready
#   3. Only proceed to next node after clusterSession confirmed
#
# clusterSession is the source of truth — if all nodes share the same
# session, they're in the same cluster. Size is secondary.
#
# Fix (2026-03-04): Non-genesis nodes were waiting for Ready BEFORE sending join,
# but in Tessellation, SessionStarted requires a join request to advance to Ready.
# The old order (wait_ready → join_and_verify) was a chicken-and-egg deadlock.
# New order: wait_responsive → join_and_verify → wait_ready.
# Also removed the incorrect "skip join if SessionStarted" guard — SessionStarted
# IS the correct state to send a join request.

set -euo pipefail

LAYER="${1:-}"
PORTS="${2:-}"
JOIN_TARGET_PORT="${3:-}"

MAX_RESPONSIVE_WAIT=120   # seconds waiting for HTTP
MAX_READY_WAIT=240        # seconds waiting for Ready state (increased for CI)
JOIN_RETRY_DELAY=5        # seconds between join attempts
MAX_JOIN_ATTEMPTS=20      # join retries per node (increased)
MAX_RESTARTS=2            # container restarts before giving up
STUCK_THRESHOLD=5         # consecutive error-session joins before restart

log() { echo "[$(date '+%H:%M:%S')] $*"; }
error() { echo "[$(date '+%H:%M:%S')] ERROR: $*" >&2; }

get_cluster_session() {
    curl -sf "http://localhost:$1/cluster/info" | jq -r '.[0].clusterSession // "none"' 2>/dev/null || echo "error"
}

wait_responsive() {
    local port=$1 name=$2
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

wait_ready() {
    local port=$1 name=$2
    log "Waiting for $name to reach Ready..."
    local state="unknown"
    for i in $(seq 1 $MAX_READY_WAIT); do
        state=$(curl -sf "http://localhost:$port/node/info" | jq -r '.state' 2>/dev/null || echo "error")
        if [ "$state" = "Ready" ]; then
            log "$name Ready after ${i}s"
            return 0
        fi
        [ $((i % 30)) -eq 0 ] && log "  $name still in state '$state' (${i}s)..."
        sleep 1
    done
    error "$name not Ready after ${MAX_READY_WAIT}s (last state: $state)"
    docker logs "$name" 2>&1 | tail -20 || true
    return 1
}

restart_container() {
    local name=$1 port=$2
    log "  Restarting stuck container $name..."
    docker restart "$name" 2>/dev/null || true
    for i in $(seq 1 60); do
        if curl -sf "http://localhost:$port/node/info" | jq -e '.state' >/dev/null 2>&1; then
            log "  $name back after restart (${i}s)"
            return 0
        fi
        sleep 1
    done
    error "  $name did not recover after restart"
    return 1
}

join_and_verify() {
    local port=$1 cli_port=$2 target_port=$3 name=$4

    local genesis_session
    genesis_session=$(get_cluster_session "$target_port")
    log "$name: genesis clusterSession=$genesis_session"

    # Get target node info for join payload
    local target_id target_p2p
    target_id=$(curl -sf "http://localhost:$target_port/node/info" | jq -r '.id' 2>/dev/null)
    target_p2p=$((target_port + 1))

    if [ -z "$target_id" ] || [ "$target_id" = "null" ]; then
        error "Cannot get peer ID from genesis node on port $target_port"
        return 1
    fi

    local restarts=0
    local consecutive_errors=0

    for attempt in $(seq 1 $MAX_JOIN_ATTEMPTS); do
        # Check if clusterSession already matches genesis
        local node_session
        node_session=$(get_cluster_session "$port")

        if [ "$node_session" = "$genesis_session" ] && [ "$node_session" != "none" ] && [ "$node_session" != "error" ]; then
            log "$name in same cluster as genesis (clusterSession=$node_session, attempt $attempt)"
            return 0
        fi

        # Check node state — only skip join if node is in a transient state that will resolve itself
        local state
        state=$(curl -sf "http://localhost:$port/node/info" | jq -r '.state' 2>/dev/null || echo "unknown")

        if [ "$state" = "WaitingForReady" ] || [ "$state" = "Leaving" ]; then
            log "  $name in transient state '$state', waiting... (attempt $attempt)"
            sleep $JOIN_RETRY_DELAY
            continue
        fi

        # NOTE: SessionStarted IS a valid state to send join request — do NOT skip it.
        # In Tessellation, SessionStarted means the node is waiting to join a cluster.

        # Detect stuck node: join returns 200 but session never establishes.
        # ClusterSessionDoesNotExist is thrown internally — restart clears it.
        if [ "$node_session" = "error" ] || [ "$node_session" = "none" ]; then
            consecutive_errors=$((consecutive_errors + 1))
        else
            consecutive_errors=0
        fi

        if [ "$consecutive_errors" -ge "$STUCK_THRESHOLD" ] && [ "$restarts" -lt "$MAX_RESTARTS" ]; then
            log "  $name stuck: $consecutive_errors consecutive session errors (state=$state)"
            restarts=$((restarts + 1))
            restart_container "$name" "$port" || return 1
            consecutive_errors=0
            sleep 5
            continue
        fi

        # Attempt join
        log "  $name join attempt $attempt (state=$state, session=$node_session)..."
        local response
        response=$(curl -sf -X POST "http://localhost:$cli_port/cluster/join" \
            -H "Content-Type: application/json" \
            -d "{\"id\":\"$target_id\", \"ip\": \"127.0.0.1\", \"p2pPort\": $target_p2p}" 2>&1 || true)

        if [ -z "$response" ] || echo "$response" | grep -qi "success\|ok\|joined\|already"; then
            log "  $name join accepted, waiting for session propagation..."
            # Give the node time to process the join and create its local
            # cluster session. ClusterSessionDoesNotExist is thrown when we
            # query /cluster/info before the session is fully initialized.
            for wait_i in $(seq 1 5); do
                sleep 3
                local check_session
                check_session=$(get_cluster_session "$port")
                if [ "$check_session" = "$genesis_session" ] && [ "$check_session" != "none" ] && [ "$check_session" != "error" ]; then
                    log "  $name session confirmed after join (wait $wait_i)"
                    return 0
                fi
                log "  $name session=$check_session (waiting ${wait_i}/5)..."
            done
            continue
        fi

        log "  $name join response: $response"
        sleep $JOIN_RETRY_DELAY
    done

    # Final session check
    local final_session
    final_session=$(get_cluster_session "$port")
    if [ "$final_session" = "$genesis_session" ] && [ "$final_session" != "none" ]; then
        log "$name confirmed in cluster (clusterSession=$final_session)"
        return 0
    fi

    error "$name NOT in genesis cluster after $MAX_JOIN_ATTEMPTS attempts ($restarts restarts)"
    error "  genesis clusterSession=$genesis_session"
    error "  $name  clusterSession=$final_session"
    docker logs "$name" 2>&1 | tail -20 || true
    return 1
}

# Main
if [ -z "$LAYER" ] || [ -z "$PORTS" ]; then
    echo "Usage: $0 <layer> <ports> [join_target_port]"
    echo "Example: $0 dl1 '9400 9410 9420' 9400"
    exit 1
fi

PORT_LIST=($PORTS)
EXPECTED_SIZE=${#PORT_LIST[@]}
log "Starting sequential $LAYER cluster setup ($EXPECTED_SIZE nodes): $PORTS"

GENESIS_SESSION=""

for idx in "${!PORT_LIST[@]}"; do
    port=${PORT_LIST[$idx]}
    node_name="${LAYER}-$((($port % 100) / 10))"
    cli_port=$((port + 2))

    # Step 1: Wait for responsive
    wait_responsive "$port" "$node_name" || exit 1

    if [ "$idx" -eq 0 ]; then
        # Genesis node — wait for Ready, capture clusterSession
        log "$node_name is genesis node"
        wait_ready "$port" "$node_name" || exit 1
        GENESIS_SESSION=$(get_cluster_session "$port")
        log "$node_name clusterSession: $GENESIS_SESSION"
    else
        # Joining node — send join request first (node may be in SessionStarted waiting for join),
        # then wait for Ready. The old order (wait_ready then join) caused a deadlock because
        # SessionStarted nodes need a join request before they can advance to Ready.
        join_and_verify "$port" "$cli_port" "$JOIN_TARGET_PORT" "$node_name" || exit 1
        wait_ready "$port" "$node_name" || exit 1
    fi
done

# Final: confirm all nodes share genesis clusterSession
log "Final clusterSession verification..."
all_ok=true
for port in $PORTS; do
    node_name="${LAYER}-$((($port % 100) / 10))"
    cs=$(get_cluster_session "$port")
    if [ "$cs" = "$GENESIS_SESSION" ]; then
        log "  $node_name: $cs ✓"
    else
        error "  $node_name: $cs ✗ (expected $GENESIS_SESSION)"
        all_ok=false
    fi
done

if [ "$all_ok" = true ]; then
    log "✓ All $LAYER nodes in same cluster (clusterSession=$GENESIS_SESSION)"
else
    error "CLUSTER SESSION MISMATCH — nodes in separate clusters!"
    exit 1
fi
