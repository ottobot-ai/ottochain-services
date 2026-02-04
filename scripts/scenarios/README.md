# OttoChain Test Scenarios

Multi-agent simulation scripts for E2E testing the OttoChain Agent Identity Platform.

## Prerequisites

- Running metagraph (GL0, ML0, DL1)
- Running indexer (optional, for state verification)

## Scenarios

### multi-agent-sim.ts

Full simulation of a realistic agent ecosystem:

1. **Agent Registration** — 5 agents register from different platforms
2. **Vouching Network** — Agents build trust by vouching for each other
3. **Successful Contract** — Alice & Bob complete a service agreement
4. **Disputed Contract** — Charlie disputes Diana's data delivery
5. **Violation Report** — Alice reports Eve for spam
6. **New Agent Onboarding** — Frank joins and gets vouched in

**Run:**
```bash
pnpm test:e2e

# Or with custom endpoints:
ML0_URL=http://localhost:9200 \
DL1_URL=http://localhost:9400 \
pnpm test:e2e
```

**Duration:** ~5-10 minutes (waiting for snapshot confirmations)

### test-webhook.ts

Quick webhook integration test (doesn't submit transactions):

```bash
pnpm test:webhook
```

## Creating New Scenarios

```typescript
import { createAgent, signMessage, submitTransaction } from './helpers';

async function myScenario() {
  const agent = createAgent('TestAgent');
  
  const message = {
    RegisterAgent: {
      address: agent.address,
      publicKey: agent.publicKey,
      displayName: agent.name,
    },
  };
  
  const signature = signMessage(agent, message);
  await submitTransaction(message, signature);
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ML0_URL` | `http://localhost:9200` | Metagraph L0 endpoint |
| `DL1_URL` | `http://localhost:9400` | Data L1 endpoint |
| `INDEXER_URL` | `http://localhost:3031` | Indexer status endpoint |
| `SNAPSHOT_WAIT_MS` | `45000` | Timeout waiting for snapshot |
| `NUM_AGENTS` | `5` | Number of agents to create |
