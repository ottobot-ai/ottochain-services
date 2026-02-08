#!/usr/bin/env bash
# Deploy script for OttoChain services
# Usage: ./scripts/deploy.sh [--restart]
#
# This script:
# 1. Generates version info
# 2. Installs dependencies  
# 3. Builds all packages
# 4. Optionally restarts pm2 services (with --restart flag)

set -euo pipefail

RESTART=""
for arg in "$@"; do
  case $arg in
    --restart) RESTART="true" ;;
  esac
done

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

if [[ "$RESTART" == "true" ]]; then
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
