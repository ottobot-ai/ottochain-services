#!/bin/bash
#
# Cloud Agent Integration Test Runner
# Runs comprehensive end-to-end tests for cloud agent to OttoChain fiber task completion
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BRIDGE_DIR="$PROJECT_ROOT/packages/bridge"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
BRIDGE_URL=${BRIDGE_URL:-"http://localhost:3030"}
ML0_URL=${ML0_URL:-"http://localhost:9200"}
HEALTH_CHECK_RETRIES=${HEALTH_CHECK_RETRIES:-10}
HEALTH_CHECK_DELAY=${HEALTH_CHECK_DELAY:-3}

log() {
    echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')] ✅ $1${NC}"
}

error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] ❌ $1${NC}"
}

warning() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️  $1${NC}"
}

check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if Node.js is available
    if ! command -v node &> /dev/null; then
        error "Node.js is required but not installed"
        exit 1
    fi
    
    # Check if pnpm is available
    if ! command -v pnpm &> /dev/null; then
        error "pnpm is required but not installed"
        exit 1
    fi
    
    # Check if we're in the right directory
    if [ ! -f "$BRIDGE_DIR/package.json" ]; then
        error "Bridge package not found. Please run from ottochain-services root directory."
        exit 1
    fi
    
    success "Prerequisites verified"
}

wait_for_service() {
    local service_name=$1
    local service_url=$2
    local retries=$3
    
    log "Waiting for $service_name at $service_url..."
    
    for i in $(seq 1 $retries); do
        if curl -f -s "$service_url" > /dev/null 2>&1; then
            success "$service_name is ready"
            return 0
        fi
        
        if [ $i -eq $retries ]; then
            error "$service_name is not responding after $retries attempts"
            return 1
        fi
        
        log "Attempt $i/$retries: $service_name not ready, waiting ${HEALTH_CHECK_DELAY}s..."
        sleep $HEALTH_CHECK_DELAY
    done
}

check_services() {
    log "Checking service availability..."
    
    # Check Bridge service
    if ! wait_for_service "Bridge" "$BRIDGE_URL/health" $HEALTH_CHECK_RETRIES; then
        error "Bridge service is not available at $BRIDGE_URL"
        echo
        echo "To start Bridge service:"
        echo "  cd packages/bridge && pnpm dev"
        exit 1
    fi
    
    # Check ML0 service
    if ! wait_for_service "ML0" "$ML0_URL/node/info" $HEALTH_CHECK_RETRIES; then
        error "ML0 service is not available at $ML0_URL"
        echo
        echo "To start OttoChain cluster:"
        echo "  cd /path/to/ottochain-deploy && ./scripts/start-cluster.sh"
        exit 1
    fi
    
    success "All services are ready"
}

install_dependencies() {
    log "Installing dependencies..."
    
    cd "$BRIDGE_DIR"
    
    if [ ! -d "node_modules" ]; then
        log "Installing bridge dependencies..."
        pnpm install
    else
        log "Dependencies already installed"
    fi
    
    success "Dependencies ready"
}

run_tests() {
    log "Starting cloud agent integration tests..."
    echo
    
    cd "$BRIDGE_DIR"
    
    # Set environment variables for tests
    export BRIDGE_URL
    export ML0_URL
    export NODE_NO_WARNINGS=1  # Suppress experimental feature warnings
    
    # Run the comprehensive integration test
    if pnpm test:cloud-agent; then
        echo
        success "🎉 All cloud agent integration tests passed!"
        echo
        echo "Test Summary:"
        echo "  ✅ Agent registration and activation"
        echo "  ✅ Task creation and assignment"
        echo "  ✅ Task execution simulation"
        echo "  ✅ Results validation and reputation updates"
        echo "  ✅ Edge cases and error handling"
        echo
        echo "📊 For detailed test documentation, see:"
        echo "     packages/bridge/docs/cloud-agent-integration-testing.md"
        return 0
    else
        echo
        error "❌ Cloud agent integration tests failed"
        echo
        echo "Troubleshooting tips:"
        echo "  1. Check service logs for detailed error messages"
        echo "  2. Verify OttoChain cluster is running and healthy"
        echo "  3. Ensure Bridge service is responding to requests"
        echo "  4. Check network connectivity between services"
        echo
        echo "Debug commands:"
        echo "  curl $BRIDGE_URL/health"
        echo "  curl $ML0_URL/node/info"
        echo "  curl $BRIDGE_URL/agent | jq '.count'"
        return 1
    fi
}

show_usage() {
    echo "Cloud Agent Integration Test Runner"
    echo
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  -h, --help              Show this help message"
    echo "  --skip-health-check     Skip service health checks"
    echo "  --bridge-url URL        Bridge service URL (default: http://localhost:3030)"
    echo "  --ml0-url URL           ML0 service URL (default: http://localhost:9200)"
    echo
    echo "Environment Variables:"
    echo "  BRIDGE_URL              Bridge service endpoint"
    echo "  ML0_URL                 ML0 metagraph endpoint"
    echo "  HEALTH_CHECK_RETRIES    Number of health check attempts (default: 10)"
    echo "  HEALTH_CHECK_DELAY      Delay between health checks in seconds (default: 3)"
    echo
    echo "Examples:"
    echo "  $0                                    # Run with default settings"
    echo "  $0 --skip-health-check               # Skip health checks"
    echo "  $0 --bridge-url http://bridge:3030   # Custom bridge URL"
    echo
    echo "Prerequisites:"
    echo "  - OttoChain cluster running (GL0, ML0, DL1)"
    echo "  - Bridge service running and healthy"
    echo "  - Node.js and pnpm installed"
}

main() {
    local skip_health_check=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                exit 0
                ;;
            --skip-health-check)
                skip_health_check=true
                shift
                ;;
            --bridge-url)
                BRIDGE_URL="$2"
                shift 2
                ;;
            --ml0-url)
                ML0_URL="$2"
                shift 2
                ;;
            *)
                error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    echo "🚀 Cloud Agent Integration Test Runner"
    echo "======================================"
    echo
    echo "Configuration:"
    echo "  Bridge URL: $BRIDGE_URL"
    echo "  ML0 URL: $ML0_URL"
    echo "  Skip Health Check: $skip_health_check"
    echo
    
    check_prerequisites
    
    if [ "$skip_health_check" = false ]; then
        check_services
    else
        warning "Skipping health checks as requested"
    fi
    
    install_dependencies
    
    if run_tests; then
        echo
        success "🎯 Cloud agent integration testing completed successfully!"
        exit 0
    else
        echo
        error "💥 Cloud agent integration testing failed"
        exit 1
    fi
}

# Run main function with all arguments
main "$@"