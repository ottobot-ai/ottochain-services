# OttoChain Monitoring Stack

Prometheus + Grafana monitoring for the OttoChain metagraph infrastructure.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Companion Server (5.78.121.248)                                │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │  Prometheus  │──│   Grafana    │◄── You are here            │
│  │  :9090       │  │   :3000      │                            │
│  └──────┬───────┘  └──────────────┘                            │
│         │                                                       │
│  ┌──────┴───────────────────────────────────────┐              │
│  │ Scrapes metrics from:                         │              │
│  │  • OttoChain services (local :3032)          │              │
│  │  • Tessellation nodes (5.78.90.207)          │              │
│  └───────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Tessellation Server (5.78.90.207)                              │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐                │
│  │  GL0   │  │  ML0   │  │  CL1   │  │  DL1   │                │
│  │ :9000  │  │ :9200  │  │ :9300  │  │ :9400  │                │
│  └────────┘  └────────┘  └────────┘  └────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Start the monitoring stack
cd packages/monitoring
docker compose up -d

# Access Grafana
open http://localhost:3000
# Default credentials: admin / ottochain
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GRAFANA_ADMIN_USER` | `admin` | Grafana admin username |
| `GRAFANA_ADMIN_PASSWORD` | `ottochain` | Grafana admin password |
| `GRAFANA_ROOT_URL` | `http://localhost:3000` | Public Grafana URL |
| `TESSELLATION_HOST` | `5.78.90.207` | Tessellation server IP |

### Prometheus Targets

The following metrics endpoints are scraped:

| Job | Target | Interval |
|-----|--------|----------|
| `gl0` | `5.78.90.207:9000/metrics` | 15s |
| `ml0` | `5.78.90.207:9200/metrics` | 15s |
| `cl1` | `5.78.90.207:9300/metrics` | 15s |
| `dl1` | `5.78.90.207:9400/metrics` | 15s |
| `monitor` | `localhost:3032/metrics` | 30s |

## Dashboards

### Tessellation Cluster

Pre-provisioned dashboard showing:
- Node health status (UP/DOWN)
- JVM memory usage per node
- JVM thread counts
- (Future: Snapshot ordinals, transaction rates)

### Adding Custom Dashboards

1. Create a JSON dashboard file in `grafana/provisioning/dashboards/`
2. Restart Grafana: `docker compose restart grafana`

## Production Deployment

```bash
# Set production password
export GRAFANA_ADMIN_PASSWORD="your-secure-password"

# Run detached
docker compose up -d

# View logs
docker compose logs -f
```

## Alerting (Future)

To enable alerting, add alert rules to Prometheus:

```yaml
# prometheus.yml (add to existing config)
rule_files:
  - /etc/prometheus/alert_rules.yml
```

## Troubleshooting

### Can't connect to Tessellation metrics?

Ensure ports 9000, 9200, 9300, 9400 are accessible from the companion server:

```bash
curl http://5.78.90.207:9000/metrics
```

### Grafana shows "No Data"?

1. Check Prometheus is scraping: http://localhost:9090/targets
2. Verify the datasource in Grafana: Settings → Data Sources → Prometheus
