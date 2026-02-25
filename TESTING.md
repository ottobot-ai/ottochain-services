# Testing Guide — ottochain-services

## Test Structure

Each package has its own test setup:

| Package | Runner | Retry | Notes |
|---------|--------|-------|-------|
| `bridge` | Node.js built-in (`node --test`) | Shell loop (CI) | No native retry flag; unit tests marked `|| true` |
| `traffic-generator` | Vitest | `retry: 2` (config) | Unit tests in `__tests__/`; integration in `test/` |
| `indexer` | — | — | No unit tests yet; tested via integration.yml |
| `gateway` | — | — | No unit tests yet |

## Running Tests

```bash
# All packages (unit tests only)
pnpm test

# With coverage
pnpm test:coverage

# Integration tests (requires live metagraph cluster)
pnpm test:integration

# Single package
cd packages/traffic-generator && pnpm test
cd packages/bridge && pnpm test
```

## Flaky Test Strategy

### Unit Tests (Vitest — traffic-generator)
`vitest.config.ts` sets `retry: 2`. Tests that fail will be retried up to 2 additional
times before being reported as failed. This handles async timing issues common in
workflow simulation tests.

### Integration Tests (integration.yml)
The integration workflow already implements shell-level retry (`MAX_RETRIES=3`):
```bash
for attempt in $(seq 1 $MAX_RETRIES); do
  if npx tsx packages/traffic-generator/test/integration.test.ts; then exit 0; fi
  sleep 10  # wait for metagraph consensus to stabilize
done
```
This is intentional: metagraph block consensus timing causes ~1-in-5 false-negative
failures in a fresh cluster. Three attempts cover all known timing windows.

### Bridge Tests (node:test)
The Node.js built-in test runner does not support a `--retry` flag. Bridge tests
are currently marked `|| true` in CI to avoid blocking on network-timeout flakes.
See: `packages/bridge/package.json` `test:coverage`.

**Tracking flaky bridge tests**: If a bridge test becomes consistently flaky:
1. Open GitHub Issue with label `flaky-test`
2. Tag the Trello card `@work` for investigation
3. Consider wrapping in a shell retry loop in CI

## Known Flaky Patterns

| Package | Test | Cause | Mitigation |
|---------|------|-------|------------|
| `traffic-generator` | `workflow-simulation` | Async fiber state timing | `retry: 2` in vitest config |
| Integration | `integration.test.ts` | Metagraph consensus window | `MAX_RETRIES=3` shell loop |

## Coverage

Traffic-generator: coverage reports output to `packages/traffic-generator/coverage/`.
Bridge: LCOV output to `packages/bridge/coverage/lcov.info`.

CI uploads coverage artifacts via Codecov when `CODECOV_TOKEN` is set.
