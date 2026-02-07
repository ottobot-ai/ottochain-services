# OttoChain Monitoring Stack

Prometheus + Grafana + Alertmanager monitoring for the OttoChain metagraph infrastructure.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Companion Server                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Prometheus  │──│ Alertmanager │──│   Grafana    │          │
│  │  :9090       │  │   :9093      │  │   :3000      │          │
│  └──────┬───────┘  └──────────────┘  └──────────────┘          │
│         │                                                       │
│  ┌──────┴───────────────────────────────────────┐              │
│  │ Scrapes metrics from:                         │              │
│  │  • OttoChain services (local :3032)          │              │
│  │  • Tessellation nodes (METAGRAPH_HOST)       │              │
│  └───────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Metagraph Server (METAGRAPH_HOST)                              │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐                │
│  │  GL0   │  │  ML0   │  │  CL1   │  │  DL1   │                │
│  │ :9000  │  │ :9200  │  │ :9300  │  │ :9400  │                │
│  └────────┘  └────────┘  └────────┘  └────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
cd packages/monitoring

# Generate prometheus.yml from template
export METAGRAPH_HOST="your-metagraph-ip"
envsubst < prometheus.yml.template > prometheus.yml

# Start the monitoring stack
docker compose up -d

# Access Grafana at http://localhost:3000
# Default credentials: admin / changeme
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `METAGRAPH_HOST` | (required) | Metagraph server IP |
| `GRAFANA_ADMIN_USER` | `admin` | Grafana admin username |
| `GRAFANA_ADMIN_PASSWORD` | `changeme` | Grafana admin password |
| `GRAFANA_ROOT_URL` | `http://localhost:3000` | Public Grafana URL |
| `TELEGRAM_BOT_TOKEN` | (optional) | For alert notifications |
| `TELEGRAM_CHAT_ID` | (optional) | For alert notifications |

### Prometheus Targets

The following metrics endpoints are scraped:

| Job | Target | Interval |
|-----|--------|----------|
| `gl0` | `METAGRAPH_HOST:9000/metrics` | 15s |
| `ml0` | `METAGRAPH_HOST:9200/metrics` | 15s |
| `cl1` | `METAGRAPH_HOST:9300/metrics` | 15s |
| `dl1` | `METAGRAPH_HOST:9400/metrics` | 15s |
| `monitor` | `localhost:3032/metrics` | 30s |
| `node` | `localhost:9100/metrics` | 15s |

## Alerting

Alertmanager sends notifications to Telegram when issues are detected.

### Alert Rules

| Alert | Trigger | Severity |
|-------|---------|----------|
| NodeDown | Scrape target unreachable >1min | Critical |
| HighMemory | >90% RAM for 5min | Warning |
| HighCPU | >90% CPU for 5min | Warning |
| DiskSpaceLow | <10% disk on root | Critical |
| NodeRestarted | Tessellation node restarted | Warning |

### Configure Telegram Alerts

Edit `alertmanager.yml` and replace:
- `YOUR_TELEGRAM_BOT_TOKEN` with your bot token
- `chat_id: 0` with your chat ID

Or let the deploy workflow configure it from `.env`.

## Dashboards

### Tessellation Cluster

Pre-provisioned dashboard showing:
- Node health status (UP/DOWN)
- JVM memory usage per node
- JVM thread counts

### Adding Custom Dashboards

1. Create a JSON dashboard file in `grafana/provisioning/dashboards/`
2. Restart Grafana: `docker compose restart grafana`

## Troubleshooting

### Can't connect to Tessellation metrics?

Ensure ports 9000, 9200, 9300, 9400 are accessible:

```bash
curl http://$METAGRAPH_HOST:9000/metrics
```

### Grafana shows "No Data"?

1. Check Prometheus is scraping: http://localhost:9090/targets
2. Verify the datasource in Grafana: Settings → Data Sources → Prometheus

### Alerts not firing?

1. Check Alertmanager: http://localhost:9093
2. Verify telegram credentials in `alertmanager.yml`
