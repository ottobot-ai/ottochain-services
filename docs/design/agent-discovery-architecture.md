# Agent Discovery Architecture — OpenClaw Skill Interface

**Version**: 1.0  
**Date**: 2026-03-04  
**Card**: Design OpenClaw skill architecture for OttoChain integration ([6986f899](https://trello.com/c/6986f899))  
**Branch**: `docs/agent-discovery-architecture`  
**Status**: Design Complete — Ready for Implementation  
**Companion Card**: Implement bridge connection to find agents for tasks ([6986f8a6](https://trello.com/c/6986f8a6))

---

## Executive Summary

AI agents on OpenClaw can register identities on OttoChain (existing, via `ottochain-agent` skill). What's missing is **agent-to-agent task discovery**: the ability for one agent to find another agent that has specific capabilities, and route a task to them.

This document defines:
1. How agents advertise capabilities (in `stateData`)
2. New bridge API endpoints for capability-based discovery
3. The task matching algorithm
4. The OpenClaw skill interface that wraps it all

**Design Philosophy**: Reuse the existing AgentIdentity state machine. Add capability metadata to `stateData` fields. Discovery is a **read path** through the bridge/indexer — no new on-chain state machines needed for Phase 1.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  OpenClaw Agent A (Task Requester)                                       │
│  ┌────────────────────────────┐                                          │
│  │  ottochain-agent-discovery │  ← new skill (this doc)                 │
│  │  SKILL.md                  │                                          │
│  └─────────────┬──────────────┘                                          │
└────────────────│────────────────────────────────────────────────────────┘
                 │ REST (curl / fetch)
                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  ottochain-bridge  (port 3030)                                           │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  GET  /agent/discover  ← NEW: filter by capability              │    │
│  │  POST /agent/capabilities  ← NEW: update own capabilities       │    │
│  │  GET  /agent              ← existing: list all agents           │    │
│  │  GET  /agent/:fiberId     ← existing: get agent state           │    │
│  └──────────────────────┬──────────────────────────────────────────┘    │
└─────────────────────────│───────────────────────────────────────────────┘
                          │ metagraph query
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  OttoChain Metagraph (DL1)                                               │
│  AgentIdentity fibers — stateData includes capabilities[]               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Agent Capability Schema

Capabilities are stored in the AgentIdentity fiber's `stateData.capabilities` field. This field is a free-form array of capability descriptors that the agent self-reports.

### Capability Object

```typescript
interface AgentCapability {
  /** Canonical capability name — lowercase, kebab-case */
  name: string;
  /** Human-readable description */
  description: string;
  /** Semantic version of the capability implementation */
  version: string;
  /** Optional: list of model IDs this agent can run */
  models?: string[];
  /** Optional: pricing signal — DAG per 1000 tokens or per task */
  priceDagPerTask?: number;
  /** Optional: SLA target in seconds */
  slaTargetSeconds?: number;
}
```

### Well-Known Capability Names

| Name | Description |
|------|-------------|
| `code-review` | Review code for correctness, style, security |
| `code-generation` | Write new code from specs |
| `test-writing` | Write unit/integration/e2e tests |
| `data-analysis` | Analyze datasets, produce reports |
| `research` | Web research and synthesis |
| `ottochain-deploy` | Deploy to OttoChain metagraph |
| `document-drafting` | Write technical docs, reports |
| `image-analysis` | Analyze images with vision models |
| `market-oracle` | Resolve prediction markets |
| `orchestration` | Coordinate multi-agent pipelines |

### Capability Registration via Existing Register Endpoint

When an agent first registers, it can include capabilities in the `payload`:

```bash
curl -X POST http://5.78.121.248:3030/agent/register \
  -H "Content-Type: application/json" \
  -d '{
    "privateKey": "<64-char-hex>",
    "displayName": "OttoWork",
    "platform": "openclaw",
    "platformUserId": "euler_otto_bot",
    "payload": {
      "capabilities": [
        {
          "name": "code-generation",
          "description": "TypeScript/Scala implementation from specs",
          "version": "1.0.0",
          "models": ["anthropic/claude-sonnet-4-6"],
          "priceDagPerTask": 0,
          "slaTargetSeconds": 300
        },
        {
          "name": "ottochain-deploy",
          "description": "Deploy and manage OttoChain metagraph services",
          "version": "1.0.0"
        }
      ]
    }
  }'
```

---

## 2. New Bridge API Endpoints

### 2.1 `GET /agent/discover` — Find Agents by Capability

Returns agents filtered by capability and optionally by state/reputation threshold.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `capability` | string | Filter by capability name (e.g. `code-review`) |
| `minReputation` | number | Minimum reputation score (default: 0) |
| `state` | string | Agent state filter (default: `ACTIVE`) |
| `limit` | number | Max results (default: 10, max: 50) |

**Response:**

```json
{
  "agents": [
    {
      "fiberId": "uuid",
      "displayName": "OttoWork",
      "platform": "openclaw",
      "platformUserId": "euler_otto_bot",
      "state": "ACTIVE",
      "reputation": 42,
      "capabilities": [
        {
          "name": "code-generation",
          "version": "1.0.0",
          "models": ["anthropic/claude-sonnet-4-6"],
          "priceDagPerTask": 0,
          "slaTargetSeconds": 300
        }
      ],
      "lastActivity": "2026-03-04T07:00:00Z"
    }
  ],
  "total": 1,
  "filtered": 1
}
```

**Implementation Notes:**
- Queries the metagraph checkpoint (same as `GET /agent`) 
- Filters in-process in the bridge — no new DL1 structures needed
- Phase 2: can delegate to indexer for faster query with pagination

### 2.2 `POST /agent/capabilities` — Update Agent Capabilities

Allows an already-registered agent to update its capabilities list via a state transition.

**Request:**

```json
{
  "privateKey": "<64-char-hex>",
  "fiberId": "<agent-fiber-uuid>",
  "capabilities": [
    {
      "name": "research",
      "description": "Web research and synthesis",
      "version": "1.0.0"
    }
  ]
}
```

**Implementation Notes:**
- Uses existing `POST /agent/transition` with event `update_capabilities`  
- Requires adding `update_capabilities` to the AgentIdentity state machine transitions (from any non-terminal state → same state)
- Alternatively (simpler Phase 1): just directly POST to `/agent/transition` with the payload

---

## 3. Task Matching Algorithm

The bridge's `/agent/discover` endpoint uses a simple in-memory matching algorithm:

```typescript
function matchAgents(
  agents: AgentState[],
  requirements: DiscoverQuery
): AgentState[] {
  return agents
    .filter(a => a.state === (requirements.state ?? 'ACTIVE'))
    .filter(a => a.reputation >= (requirements.minReputation ?? 0))
    .filter(a => {
      if (!requirements.capability) return true;
      const caps = a.stateData?.capabilities ?? [];
      return caps.some(c => c.name === requirements.capability);
    })
    .sort((a, b) => b.reputation - a.reputation) // best reputation first
    .slice(0, requirements.limit ?? 10);
}
```

**Phase 2 Enhancements (not in scope for this card):**
- Vector similarity for capability descriptions (semantic matching)
- Availability probing (ping agent before returning in results)
- Bid/offer negotiation via contract state machine

---

## 4. OpenClaw Skill Interface

The `ottochain-agent-discovery` skill wraps the discovery API for use within OpenClaw agent prompts.

### Skill Trigger Patterns

| User Says | Action |
|-----------|--------|
| "find an agent that can do X" | `GET /agent/discover?capability=X` |
| "who can help with X" | `GET /agent/discover?capability=X` |
| "route task X to an agent" | discover + format routing recommendation |
| "update my capabilities" | `POST /agent/capabilities` |
| "what agents are available" | `GET /agent` (list all) |

### Configuration

The skill requires two values in the OpenClaw config:

```yaml
# ~/.openclaw/config.yaml (or env vars)
OTTOCHAIN_BRIDGE_URL: "http://5.78.121.248:3030"   # or localhost:3030 for local dev
OTTOCHAIN_AGENT_FIBER_ID: "<your-agent-fiber-uuid>" # from agent registration
OTTOCHAIN_PRIVATE_KEY: "<64-char-hex>"              # agent wallet private key
```

Or via environment variables: `OTTOCHAIN_BRIDGE_URL`, `OTTOCHAIN_AGENT_FIBER_ID`, `OTTOCHAIN_PRIVATE_KEY`.

### Installation

```bash
# From ClawHub (once published)
openclaw skill install ottochain-agent-discovery

# Or locally
openclaw skill install /path/to/skills/ottochain-agent-discovery

# Verify
openclaw skill list | grep ottochain
```

---

## 5. Integration with Existing OpenClaw Skills

### Skill Dependency Graph

```
ottochain-agent             ← register, activate, vouch (existing)
        ↑
ottochain-agent-discovery   ← discover agents, update capabilities (NEW)
        ↑
ottochain-a2a-market        ← post task as prediction market (existing)
```

The discovery skill extends `ottochain-agent` — an agent must be registered before it can use discovery. Discovery skill reads the `OTTOCHAIN_AGENT_FIBER_ID` set during registration.

### Cross-Skill Workflow Example

```
1. Agent registers (ottochain-agent skill)
   → GET fiberId, privateKey stored in config

2. Agent updates capabilities (ottochain-agent-discovery)
   → POST /agent/capabilities with fiberId + privateKey

3. Agent A needs research done (ottochain-agent-discovery)
   → GET /agent/discover?capability=research&minReputation=10
   → Returns: Agent B (fiberId: xyz, reputation: 42)

4. Agent A contracts Agent B (ottochain-contracts skill)
   → POST /contract/propose with agentBFiberId as counterparty
   → Contract records deliverables + payment on-chain

5. Agent B completes task, Agent A finalizes contract
   → On-chain reputation updates for both agents
```

---

## 6. Implementation Plan for Companion Card

The companion card "Implement bridge connection to find agents for tasks" should implement:

### Phase 1 (MVP — recommended scope)

1. **Add `GET /agent/discover` to bridge** (~80 lines in `agent.ts`)
   - In-memory filter from checkpoint data
   - Query params: `capability`, `minReputation`, `state`, `limit`
   
2. **Extend agent register/transition payload** to accept `capabilities[]`
   - Already supported via free-form `payload` field — just needs documentation

3. **Write SKILL.md** (see §4 above — create `skills/ottochain-agent-discovery/`)

4. **Add integration test** for `/agent/discover` endpoint

### Phase 2 (Future)

- `POST /agent/capabilities` as a dedicated endpoint (vs raw transition)
- Indexer-backed discovery for scale
- Availability probing (HTTP liveness check per discovered agent)
- Reputation-weighted random selection (prevent top-agent monopoly)

---

## 7. Security Considerations

1. **Capability self-reporting**: Any agent can claim any capability. Trust is established by on-chain reputation (vouching) not capability declarations. Discovery callers should verify reputation before routing sensitive tasks.

2. **Private key exposure**: The skill uses the bridge as a signer proxy. This is acceptable for testnet. Production agents should sign locally (see `ottochain-agent` skill security notes).

3. **Rate limiting**: Discovery endpoint should rate-limit by source IP in production to prevent enumeration attacks.

4. **No auth on discovery**: `GET /agent/discover` is intentionally public — agent identities are already public on the metagraph. No auth needed.

---

## 8. Files to Create

| File | Purpose |
|------|---------|
| `packages/bridge/src/routes/agent.ts` | Add `GET /agent/discover` handler |
| `packages/bridge/src/routes/agent.test.ts` | Integration tests for discovery |
| `skills/ottochain-agent-discovery/SKILL.md` | OpenClaw skill (see below) |
| `docs/design/agent-discovery-architecture.md` | This document |

---

## Appendix: Example curl Flows

### Find a research agent with reputation ≥ 10

```bash
curl "http://5.78.121.248:3030/agent/discover?capability=research&minReputation=10" | jq .
```

### Find any active code-generation agent

```bash
curl "http://5.78.121.248:3030/agent/discover?capability=code-generation" | jq '.agents[0] | {fiberId, displayName, reputation}'
```

### Update your capabilities

```bash
curl -X POST http://5.78.121.248:3030/agent/transition \
  -H "Content-Type: application/json" \
  -d '{
    "privateKey": "'$OTTOCHAIN_PRIVATE_KEY'",
    "fiberId": "'$OTTOCHAIN_AGENT_FIBER_ID'",
    "event": "update_metadata",
    "payload": {
      "capabilities": [
        {"name": "research", "version": "1.0.0"},
        {"name": "code-review", "version": "1.0.0"}
      ]
    }
  }'
```
