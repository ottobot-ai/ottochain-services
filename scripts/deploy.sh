#!/usr/bin/env bash
# Deploy script for OttoChain services
# Usage: ./scripts/deploy.sh [host] [--restart]
#
# This script:
# 1. Pulls latest code
# 2. Regenerates lockfile and installs dependencies  
# 3. Generates version info
# 4. Builds all packages
# 5. Optionally restarts pm2 services

set -euo pipefail

HOST="${1:-}"
RESTART="${2:-}"

cd "$(dirname "$0")/.."

echo "📦 OttoChain Services Deploy"
echo "=============================="

# Generate version info first
echo "🔖 Generating version info..."
./scripts/build-version.sh

# Source the version env vars
source .env.version

echo ""
echo "📥 Installing dependencies..."
pnpm install

echo ""
echo "🔨 Building packages..."
pnpm build

echo ""
echo "✅ Build complete!"
echo "   Version: $VERSION"
echo "   Commit:  $GIT_SHA"
echo "   Built:   $BUILD_TIME"

if [[ "$RESTART" == "--restart" ]]; then
  echo ""
  echo "🔄 Restarting pm2 services..."
  pm2 reload ecosystem.config.cjs --update-env
  pm2 save
  echo "✅ Services restarted"
fi

echo ""
echo "Done! Version endpoints will report:"
echo "  commit: $GIT_SHA"
echo "  built:  $BUILD_TIME"
