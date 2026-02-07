# OttoChain Services - Docker Compose Helpers
# Run 'make help' for usage

.PHONY: help up down logs ps base services monitoring full traffic clean

# Default compose files for each profile
BASE := compose.base.yml
SERVICES := compose.services.yml
MONITORING := compose.monitoring.yml
EXPORTERS := compose.exporters.yml
LOGGING := compose.logging.yml
TRAFFIC := compose.traffic.yml

help:
	@echo "OttoChain Services - Docker Compose Profiles"
	@echo ""
	@echo "PROFILES:"
	@echo "  make base       - Start base infra (Redis, Postgres)"
	@echo "  make services   - Start base + app services (Gateway, Bridge, Indexer)"
	@echo "  make monitoring - Start base + monitoring (Prometheus, Grafana, Alertmanager)"
	@echo "  make full       - Start everything (base + services + monitoring + exporters)"
	@echo "  make traffic    - Start base + services + traffic generator"
	@echo ""
	@echo "COMMANDS:"
	@echo "  make up         - Alias for 'make services'"
	@echo "  make down       - Stop all containers"
	@echo "  make logs       - Follow logs for all running services"
	@echo "  make ps         - List running containers"
	@echo "  make clean      - Stop all and remove volumes"
	@echo ""
	@echo "EXAMPLES:"
	@echo "  make services                    # Dev environment"
	@echo "  make full                        # Production-like"
	@echo "  make logs ARGS='gateway indexer' # Follow specific services"

# Profiles
base:
	docker compose -f $(BASE) up -d

services: base
	docker compose -f $(BASE) -f $(SERVICES) up -d

monitoring: base
	docker compose -f $(BASE) -f $(MONITORING) up -d

full:
	docker compose -f $(BASE) -f $(SERVICES) -f $(MONITORING) -f $(EXPORTERS) up -d

traffic: services
	docker compose -f $(BASE) -f $(SERVICES) -f $(TRAFFIC) up -d

# With logging
logging: monitoring
	docker compose -f $(BASE) -f $(MONITORING) -f $(LOGGING) up -d

full-logging:
	docker compose -f $(BASE) -f $(SERVICES) -f $(MONITORING) -f $(EXPORTERS) -f $(LOGGING) up -d

# Convenience
up: services

down:
	docker compose -f $(BASE) -f $(SERVICES) -f $(MONITORING) -f $(EXPORTERS) -f $(LOGGING) -f $(TRAFFIC) down 2>/dev/null || true

logs:
	docker compose -f $(BASE) -f $(SERVICES) -f $(MONITORING) logs -f $(ARGS)

ps:
	docker compose -f $(BASE) -f $(SERVICES) -f $(MONITORING) -f $(EXPORTERS) ps

clean: down
	docker compose -f $(BASE) -f $(SERVICES) -f $(MONITORING) -f $(EXPORTERS) -f $(LOGGING) -f $(TRAFFIC) down -v 2>/dev/null || true
	docker volume prune -f

# Build
build:
	docker compose -f $(BASE) -f $(SERVICES) build

rebuild:
	docker compose -f $(BASE) -f $(SERVICES) build --no-cache
