# Bridge Token Routes Specification

**Status:** Draft  
**Author:** @think (OttoBot)  
**Date:** 2026-02-24  
**Trello:** [Typed routes card](https://trello.com/c/6996294a)  
**Dependency:** SDK PR #45 (`feat/asset-model-token-impl`)

---

## Overview

Add typed `/token/*` routes to the Bridge service for creating and managing OttoChain tokens using the 4-bit TDEG (Transferable, Divisible, Expirable, Governable) behavior model.

This is the final domain route needed to complete the Bridge's typed route coverage. All other domains (`/agent/*`, `/contract/*`, `/market/*`, `/governance/*`, `/oracle/*`, `/corporate/*`) are already live on main.

## Token Behavior Model (TDEG)

The SDK implements a 4-bit behavior encoding:

| Bit | Flag | Meaning |
|-----|------|---------|
| 3 (8) | T | Transferable — can change ownership |
| 2 (4) | D | Divisible — supports split/merge operations |
| 1 (2) | E | Expirable — can transition to EXPIRED state |
| 0 (1) | G | Governable — requires delegation authorization |

This yields 16 possible token archetypes (behavior 0–15), including:
- **0**: Soulbound Receipt (non-transferable, non-divisible)
- **8**: NFT (transferable only)
- **12**: Fungible Token (transferable + divisible)
- **13**: Governed Fungible / Stablecoin (T+D+G)
- **3**: Governed License (E+G, soulbound with expiry)

## Token State Machine

**States:**
- `ACTIVE` — Initial state, token is live
- `BURNED` — Terminal state, token destroyed
- `EXPIRED` — Terminal state (only if E=1)

**Transitions:**
| Event | Condition | From → To | Guards |
|-------|-----------|-----------|--------|
| `burn` | Always | ACTIVE → BURNED | None |
| `transfer` | T=1 | ACTIVE → ACTIVE | governance + expiry (per flags) |
| `split` | D=1 | ACTIVE → ACTIVE | amount ≤ balance |
| `merge` | D=1 | ACTIVE → ACTIVE | None |
| `expire` | E=1 | ACTIVE → EXPIRED | None |

---

## API Endpoints

### POST `/token/create`

Create a new token state machine with specified behavior.

**Request Schema:**
```typescript
const CreateTokenRequestSchema = z.object({
  privateKey: z.string().length(64),
  behavior: z.number().int().min(0).max(15),
  // Initial state data
  owner: z.string().optional(),           // Defaults to signer address
  balance: z.number().positive().optional().default(1),
  metadata: z.object({
    name: z.string().min(1),
    symbol: z.string().min(1).max(10).optional(),
    description: z.string().optional(),
    decimals: z.number().int().min(0).max(18).optional(),
    uri: z.string().url().optional(),      // For NFT metadata
    attributes: z.record(z.any()).optional(),
  }),
  // Governance config (if G=1)
  delegation: z.object({
    authorizedAgents: z.array(z.string()).optional(),
    multisigThreshold: z.number().int().min(1).optional(),
  }).optional(),
  // Expiry config (if E=1)
  expiresAtOrdinal: z.number().int().positive().optional(),
});
```

**Response:**
```json
{
  "tokenId": "uuid",
  "behavior": 12,
  "behaviorName": "FUNGIBLE_TOKEN",
  "owner": "DAG...",
  "hash": "...",
  "message": "Token created in ACTIVE state."
}
```

### POST `/token/transfer`

Transfer token ownership (requires T=1).

**Request Schema:**
```typescript
const TransferTokenRequestSchema = z.object({
  privateKey: z.string().length(64),
  tokenId: z.string().uuid(),
  recipient: z.string(),                   // DAG address
  amount: z.number().positive().optional(), // For divisible tokens
});
```

### POST `/token/split`

Split a divisible token into two (requires D=1).

**Request Schema:**
```typescript
const SplitTokenRequestSchema = z.object({
  privateKey: z.string().length(64),
  tokenId: z.string().uuid(),
  amount: z.number().positive(),           // Amount for new child token
  childTokenId: z.string().uuid().optional(), // Optional, auto-generated if omitted
});
```

**Response includes:**
```json
{
  "parentTokenId": "uuid",
  "childTokenId": "uuid",
  "parentBalance": 70,
  "childBalance": 30,
  "hash": "..."
}
```

### POST `/token/merge`

Merge a source token into target (requires D=1).

**Request Schema:**
```typescript
const MergeTokenRequestSchema = z.object({
  privateKey: z.string().length(64),
  tokenId: z.string().uuid(),              // Target token
  sourceTokenId: z.string().uuid(),        // Source token (will be burned)
  amount: z.number().positive(),
});
```

### POST `/token/burn`

Burn a token (always available).

**Request Schema:**
```typescript
const BurnTokenRequestSchema = z.object({
  privateKey: z.string().length(64),
  tokenId: z.string().uuid(),
});
```

### POST `/token/expire`

Expire a token (requires E=1).

**Request Schema:**
```typescript
const ExpireTokenRequestSchema = z.object({
  privateKey: z.string().length(64),
  tokenId: z.string().uuid(),
});
```

### GET `/token/:tokenId`

Get token state by ID.

### GET `/token`

List tokens with optional filters.

**Query params:**
- `owner` — Filter by owner address
- `behavior` — Filter by behavior code (0–15)
- `state` — Filter by state (ACTIVE, BURNED, EXPIRED)

---

## Implementation Pattern

Follows the established domain route pattern (see `market.ts`):

```typescript
import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import {
  submitTransaction,
  getStateMachine,
  getCheckpoint,
  keyPairFromPrivateKey,
  waitForFiber,
  getFiberSequenceNumber,
} from '../metagraph.js';
import {
  createTokenStateMachine,
  TOKEN_BEHAVIOR_NAMES,
  TokenBehavior,
} from '@ottochain/sdk/apps/token';

export const tokenRoutes: RouterType = Router();

// POST /token/create
tokenRoutes.post('/create', async (req, res) => {
  const input = CreateTokenRequestSchema.parse(req.body);
  const keyPair = keyPairFromPrivateKey(input.privateKey);
  const tokenId = randomUUID();
  
  const definition = createTokenStateMachine(input.behavior as TokenBehavior);
  
  const initialData = {
    schema: 'Token',
    behavior: input.behavior,
    owner: input.owner ?? keyPair.address,
    balance: input.balance,
    metadata: input.metadata,
    delegation: input.delegation ?? null,
    expiresAtOrdinal: input.expiresAtOrdinal ?? null,
    createdAt: new Date().toISOString(),
  };
  
  const message = {
    CreateStateMachine: {
      fiberId: tokenId,
      definition,
      initialData,
      parentFiberId: null,
    },
  };
  
  const result = await submitTransaction(message, input.privateKey);
  // ... response
});
```

---

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| SDK PR #45 | In Code Review | Exports `createTokenStateMachine`, `TOKEN_BEHAVIOR_NAMES`, etc. |
| SDK export path | Part of PR #45 | `@ottochain/sdk/apps/token` |

**Blocking:** SDK PR #45 must merge before this implementation can import the token utilities.

---

## Acceptance Criteria

1. **Route file exists** — `packages/bridge/src/routes/token.ts` created following established patterns
2. **Create endpoint** — `POST /token/create` accepts behavior (0–15) and creates token SM with correct definition
3. **Transfer endpoint** — `POST /token/transfer` validates T=1 behavior before allowing transition
4. **Split/Merge endpoints** — `POST /token/split` and `/token/merge` validate D=1 behavior
5. **Burn endpoint** — `POST /token/burn` works for all behaviors
6. **Expire endpoint** — `POST /token/expire` validates E=1 behavior
7. **Query endpoints** — `GET /token/:tokenId` and `GET /token` implemented with filters
8. **Zod validation** — All request bodies validated with typed schemas
9. **Error handling** — Behavior-incompatible operations return 400 with clear error message
10. **Route registration** — Token routes mounted at `/token/*` in main router

---

## Phase 2: Client-Side Signing (B3)

The current implementation uses server-side signing via `privateKey` in request body. Phase 2 (Bridge card B3) will add a parallel flow:

1. Client constructs unsigned transaction
2. Client signs with wallet (Stargazer, etc.)
3. Client submits signed transaction to bridge
4. Bridge validates and forwards to metagraph

This will be implemented as additional endpoints (`/token/sign/*` or similar) without breaking the existing Phase 1 API.

---

## Testing Strategy

1. **Unit tests** — Schema validation, behavior flag checking
2. **Integration tests** — Full create → transfer → burn lifecycle per archetype
3. **Behavior matrix** — Test each of the 16 archetypes for correct transition availability
4. **Guard tests** — Verify governance and expiry guards fire correctly

---

## References

- [Token SDK PR #45](https://github.com/ottobot-ai/ottochain-sdk/pull/45)
- [TDEG Model Design](../../../ottochain-sdk/docs/design/asset-model-spec.md)
- [Market Routes](../../packages/bridge/src/routes/market.ts) — Pattern reference
