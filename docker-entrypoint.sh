#!/bin/sh
set -e

# Valid services and their ports
# gateway:           4000 - Main API gateway
# bridge:            3030 - OttoChain bridge service  
# indexer:           3031 - Blockchain indexer (requires PostgreSQL)
# monitor:           3032 - Monitoring service
# traffic-generator: N/A  - Traffic generation (no server)

VALID_SERVICES="gateway bridge indexer monitor traffic-generator"

# Validate SERVICE env var
if [ -z "$SERVICE" ]; then
    echo "ERROR: SERVICE environment variable is required"
    echo "Valid services: $VALID_SERVICES"
    exit 1
fi

# Check if service is valid
if ! echo "$VALID_SERVICES" | grep -qw "$SERVICE"; then
    echo "ERROR: Invalid service '$SERVICE'"
    echo "Valid services: $VALID_SERVICES"
    exit 1
fi

# Check if service package exists
if [ ! -d "/app/packages/$SERVICE" ]; then
    echo "ERROR: Service package not found at /app/packages/$SERVICE"
    exit 1
fi

# For indexer, wait for database
if [ "$SERVICE" = "indexer" ] && [ -n "$DATABASE_URL" ]; then
    echo "Waiting for database..."
    max_attempts=30
    attempt=0
    
    # Extract host:port from DATABASE_URL
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
    DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
    DB_PORT=${DB_PORT:-5432}
    
    while [ $attempt -lt $max_attempts ]; do
        if nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; then
            echo "Database is ready"
            break
        fi
        attempt=$((attempt + 1))
        echo "Waiting for database... ($attempt/$max_attempts)"
        sleep 2
    done
    
    if [ $attempt -eq $max_attempts ]; then
        echo "WARNING: Could not verify database connection, proceeding anyway"
    fi
fi

echo "Starting service: $SERVICE"
exec pnpm --filter "$SERVICE" start
