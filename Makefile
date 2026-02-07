# OttoChain Services - Docker Compose Helpers
# Run 'make help' for usage

.PHONY: help up down logs ps base services traffic clean build

# Default compose files
BASE := compose.base.yml
SERVICES := compose.services.yml
TRAFFIC := compose.traffic.yml

help:
	@echo "OttoChain Services - Docker Compose"
	@echo ""
	@echo "COMMANDS:"
	@echo "  make up         - Start services (Gateway, Bridge, Indexer + Redis/Postgres)"
	@echo "  make base       - Start only infrastructure (Redis, Postgres)"
	@echo "  make traffic    - Start services + traffic generator"
	@echo "  make down       - Stop all containers"
	@echo "  make logs       - Follow logs (use ARGS='svc1 svc2' to filter)"
	@echo "  make ps         - List running containers"
	@echo "  make clean      - Stop all and remove volumes"
	@echo "  make build      - Build service images"
	@echo ""
	@echo "EXAMPLES:"
	@echo "  make up                          # Start dev environment"
	@echo "  make logs ARGS='gateway'         # Follow gateway logs"
	@echo "  make traffic                     # Start with load generator"
	@echo ""
	@echo "For monitoring, use ottochain-monitoring repo."
	@echo "For full orchestration, use ottochain-deploy repo."

# Profiles
base:
	docker compose -f $(BASE) up -d

services:
	docker compose -f $(BASE) -f $(SERVICES) up -d

traffic:
	docker compose -f $(BASE) -f $(SERVICES) -f $(TRAFFIC) up -d

# Convenience
up: services

down:
	docker compose -f $(BASE) -f $(SERVICES) -f $(TRAFFIC) down 2>/dev/null || true

logs:
	docker compose -f $(BASE) -f $(SERVICES) logs -f $(ARGS)

ps:
	docker compose -f $(BASE) -f $(SERVICES) ps

clean: down
	docker compose -f $(BASE) -f $(SERVICES) -f $(TRAFFIC) down -v 2>/dev/null || true
	docker volume prune -f

# Build
build:
	docker compose -f $(BASE) -f $(SERVICES) build

rebuild:
	docker compose -f $(BASE) -f $(SERVICES) build --no-cache

# Network
network:
	docker network create ottochain 2>/dev/null || true
