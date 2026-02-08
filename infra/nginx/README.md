# Nginx Configurations

These configs are deployed to `/etc/nginx/sites-available/` on the services node.

## Subdomains

| Subdomain | Backend | Purpose |
|-----------|---------|---------|
| bridge.ottochain.ai | :3030 | OttoChain Bridge API |
| explorer.ottochain.ai | :4000 + static | Block explorer |
| status.ottochain.ai | :3032 + static | Cluster status dashboard |
| grafana.ottochain.ai | :3001 | Grafana dashboards |
| prometheus.ottochain.ai | :9090 | Prometheus metrics |

## Deployment

```bash
# Copy configs
scp infra/nginx/* root@services:/etc/nginx/sites-available/

# Enable and test
ssh root@services "ln -sf /etc/nginx/sites-available/bridge.ottochain.ai /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx"

# Get SSL certs
ssh root@services "certbot --nginx -d bridge.ottochain.ai"
```

## Notes
- Certbot will modify configs to add SSL
- Let's Encrypt certs auto-renew via systemd timer
