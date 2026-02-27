#!/bin/sh
# Generic HTTP health check for Docker healthcheck
# Usage: healthcheck.sh <port>
PORT=${1:-3000}
node -e "fetch('http://localhost:${PORT}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
