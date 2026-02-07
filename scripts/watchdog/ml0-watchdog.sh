#!/bin/bash
# ml0-watchdog.sh - Restart ML0 if unresponsive due to CPU starvation
#
# Symptoms this catches:
# - Container shows "Up" but HTTP endpoint times out
# - CPU starvation causes Cats Effect to not schedule HTTP handlers
# - Consensus stalls with "process is stale" warnings
#
# Usage:
#   ./ml0-watchdog.sh              # Single check
#   ./ml0-watchdog.sh --daemon     # Run continuously (every 60s)
#
# Install as cron (recommended):
#   * * * * * /opt/ottochain/scripts/ml0-watchdog.sh >> /var/log/ml0-watchdog.log 2>&1

set -euo pipefail

# Configuration
ML0_PORT="${ML0_PORT:-9200}"
ML0_CONTAINER="${ML0_CONTAINER:-ml0}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-10}"
FAILURE_FILE="/tmp/ml0-watchdog-failures"
MAX_FAILURES="${MAX_FAILURES:-3}"
DAEMON_INTERVAL="${DAEMON_INTERVAL:-60}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    logger -t ml0-watchdog "$*" 2>/dev/null || true
}

check_ml0() {
    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${ML0_CONTAINER}$"; then
        log "INFO: ML0 container not running, skipping check"
        rm -f "$FAILURE_FILE"
        return 0
    fi

    # Try to reach health endpoint
    if curl -sf --max-time "$TIMEOUT_SECONDS" "http://localhost:${ML0_PORT}/node/info" >/dev/null 2>&1; then
        # Success - reset failure counter
        if [[ -f "$FAILURE_FILE" ]]; then
            log "INFO: ML0 recovered, clearing failure counter"
            rm -f "$FAILURE_FILE"
        fi
        return 0
    fi

    # Failed - increment counter
    local failures=0
    if [[ -f "$FAILURE_FILE" ]]; then
        failures=$(cat "$FAILURE_FILE")
    fi
    failures=$((failures + 1))
    echo "$failures" > "$FAILURE_FILE"

    log "WARN: ML0 health check failed (attempt $failures/$MAX_FAILURES)"

    # Check if we've hit the threshold
    if [[ $failures -ge $MAX_FAILURES ]]; then
        log "ERROR: ML0 unresponsive after $failures attempts, restarting..."
        
        # Restart the container
        if docker restart "$ML0_CONTAINER"; then
            log "INFO: ML0 restart initiated successfully"
            rm -f "$FAILURE_FILE"
            
            # Optional: send alert (uncomment if TELEGRAM vars are set)
            # if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]] && [[ -n "${TELEGRAM_CHAT_ID:-}" ]]; then
            #     curl -sf -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            #         -d "chat_id=${TELEGRAM_CHAT_ID}" \
            #         -d "text=🔄 ML0 was unresponsive and has been restarted" >/dev/null
            # fi
        else
            log "ERROR: Failed to restart ML0"
            return 1
        fi
    fi

    return 0
}

# Main
if [[ "${1:-}" == "--daemon" ]]; then
    log "INFO: Starting ML0 watchdog daemon (interval: ${DAEMON_INTERVAL}s)"
    while true; do
        check_ml0 || true
        sleep "$DAEMON_INTERVAL"
    done
else
    check_ml0
fi
