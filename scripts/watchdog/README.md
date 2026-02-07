# Metagraph Watchdog Scripts

Auto-restart scripts for metagraph nodes that become unresponsive due to CPU starvation.

## Problem

Under heavy load (e.g., high traffic generator volume), ML0 can experience CPU starvation where:
- Container shows "Up" in Docker
- But HTTP health endpoint (`/node/info`) times out
- Cats Effect runtime is too busy to schedule HTTP handlers
- Consensus shows "process is stale" warnings

The node is technically running but functionally dead.

## Solution

`ml0-watchdog.sh` monitors the health endpoint and restarts the container after consecutive failures.

## Installation

### Option 1: Cron (Recommended)

```bash
# Copy to tessellation server
scp scripts/watchdog/ml0-watchdog.sh root@<METAGRAPH_IP>:/opt/ottochain/scripts/

# Make executable
ssh root@<METAGRAPH_IP> "chmod +x /opt/ottochain/scripts/ml0-watchdog.sh"

# Add to crontab (checks every minute)
ssh root@<METAGRAPH_IP> 'echo "* * * * * /opt/ottochain/scripts/ml0-watchdog.sh >> /var/log/ml0-watchdog.log 2>&1" | crontab -'
```

### Option 2: Daemon Mode

```bash
# Run in background
nohup ./ml0-watchdog.sh --daemon >> /var/log/ml0-watchdog.log 2>&1 &
```

### Option 3: Systemd

```ini
# /etc/systemd/system/ml0-watchdog.service
[Unit]
Description=ML0 Watchdog
After=docker.service

[Service]
Type=simple
ExecStart=/opt/ottochain/scripts/ml0-watchdog.sh --daemon
Restart=always

[Install]
WantedBy=multi-user.target
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ML0_PORT` | `9200` | ML0 HTTP port |
| `ML0_CONTAINER` | `ml0` | Docker container name |
| `TIMEOUT_SECONDS` | `10` | Health check timeout |
| `MAX_FAILURES` | `3` | Consecutive failures before restart |
| `DAEMON_INTERVAL` | `60` | Seconds between checks (daemon mode) |

## Logs

Check `/var/log/ml0-watchdog.log` or `journalctl -t ml0-watchdog` for activity.

Example output:
```
[2026-02-06 19:05:23] WARN: ML0 health check failed (attempt 1/3)
[2026-02-06 19:06:23] WARN: ML0 health check failed (attempt 2/3)
[2026-02-06 19:07:23] WARN: ML0 health check failed (attempt 3/3)
[2026-02-06 19:07:23] ERROR: ML0 unresponsive after 3 attempts, restarting...
[2026-02-06 19:07:25] INFO: ML0 restart initiated successfully
```
