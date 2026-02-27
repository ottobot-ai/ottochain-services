# Client-Side Signing API — TDD Specification

**Card**: [B1] Spec: Client-Side Signing API  
**Epic**: Multi-Party Signing + Client-Side Signing Refactor (`699ce1fa`)  
**Repos**: `ottobot-ai/ottochain-services`, `ottobot-ai/ottochain-sdk`  
**Branch**: `feat/client-signing`  
**Status**: Awaiting James's API contract approval before [B2] tests are written  
**Last Updated**: 2026-02-23

---

## Problem Statement

Every bridge route currently accepts `privateKey` in the request body:

```typescript
// POST /sm/create — current
{ "privateKey": "a1b2c3...", "definition": {...}, "initialData": {...} }

// POST /sm/transition — current
{ "privateKey": "a1b2c3...", "fiberId": "uuid", "eventName": "accept", "payload": {...} }
```

This is a security anti-pattern:
1. **Private keys leave the client** — they're transmitted over HTTP (even with HTTPS, they're visible to bridge operators)
2. **Bridge holds signing authority** — server-side signing means one compromised bridge = all user funds at risk
3. **Mobile clients can't sign** — no way to integrate with hardware wallets or mobile key stores
4. **Multi-sig impossible** — a single `privateKey` field can't express N-of-M signing (needed for DAO governance)

**Goal**: Refactor to a Build → Sign → Submit pattern where signing happens client-side.

---

## Design Questions — Answered

### Q1: What does the unsigned transaction payload look like?

**Answer**: The unsigned payload is simply the raw `OttochainMessage` object (the `value` field from a `Signed<T>`). It's already a valid JSON object that the client can sign using the SDK:

```typescript
// Unsigned payload from /build endpoint:
{
  "CreateStateMachine": {
    "fiberId": "a1b2c3d4-...",
    "definition": {...},
    "initialData": {...}
  }
}

// Client signs it with SDK:
const signed = await sdk.signTransaction(unsignedPayload, privateKey);
// → { value: { "CreateStateMachine": {...} }, proofs: [{ id, signature }] }
```

### Q2: Does the bridge return protobuf or JSON?

**Answer**: JSON throughout. The existing `batchSign` → `{ data: signed, fee: null }` → DL1 flow uses JSON encoding throughout. The unsigned payload is returned as JSON; the signed submission is JSON. No protobuf needed at the bridge layer (protobuf is used internally between ML0/DL1 Tessellation nodes, not at the bridge API level).

### Q3: How does the SDK sign it?

**Answer**: The SDK already has the primitives — `signDataUpdate(value, privateKey)` returns a `SignatureProof`. The bridge should expose the SDK method `signTransaction(message, privateKey)` which wraps `createSignedObject(message, privateKey, { isDataUpdate: true })`.

This is a thin alias — the heavy lifting is already done.

### Q4: Single `/submit` endpoint or per-route submit?

**Answer**: **Single generic `/submit` endpoint** for the common case, with per-route aliases retained for convenience.

Rationale:
- The submit path is identical for all message types: `{ data: Signed<OttochainMessage>, fee: null }` → DL1
- A generic `/submit` is simpler for SDK callers and easier to test
- Per-route aliases (`/sm/submit`, `/fiber/submit`) are optional convenience wrappers for backward compat

### Q5: Backwards compatibility — how long to keep old endpoints?

**Answer**: **Indefinitely in Services 0.5.x** with `@deprecated` annotation. Remove in 0.6.0 or when James decides.

The old `privateKey` endpoints will:
1. Log a deprecation warning on each call
2. Continue working (no breakage for existing callers)
3. Be documented as deprecated in OpenAPI/JSDoc

**Migration timeline**: Traffic generator and E2E tests switch to new endpoints on SDK 1.1.0 release. Old endpoints removed once all internal callers migrated.

### Q6: How does client-side signing interact with Epic A (multi-party signing)?

**Answer**: They're complementary and independent:

```
Epic A: WHO can sign (FiberRules.L0 adds authorizedSigners)
Epic B: HOW signing happens (client-side, key never leaves client)
```

With both epics complete:
- Alice creates fiber declaring Bob as participant (Epic A)
- Alice builds the `CreateStateMachine` message via bridge, signs locally (Epic B)
- Bob builds the `TransitionStateMachine("accept", ...)` message, signs it with HIS key (Epic A + B)
- Neither party's key ever touches the bridge server

---

## New API Design

### Build → Sign → Submit Flow

```
┌──────────────┐          ┌─────────────────┐          ┌──────────────────┐
│    Client    │          │     Bridge       │          │   DL1 / ML0      │
└──────┬───────┘          └────────┬────────┘          └────────┬─────────┘
       │                           │                             │
       │  POST /build/sm/create    │                             │
       │  { definition, data, ...} │                             │
       │──────────────────────────►│                             │
       │                           │  (optionally: fetch seq     │
       │                           │   for transitions)          │
       │  { unsigned: {...},       │                             │
       │    fiberId: "uuid" }      │                             │
       │◄──────────────────────────│                             │
       │                           │                             │
       │  [SDK] sign locally       │                             │
       │  signTransaction(msg, key)│                             │
       │                           │                             │
       │  POST /submit             │                             │
       │  { signed: {value, proofs}}                             │
       │──────────────────────────►│  POST /data                 │
       │                           │  { data: Signed, fee: null }│
       │                           │────────────────────────────►│
       │                           │  { hash: "..." }            │
       │                           │◄────────────────────────────│
       │  { hash: "...",           │                             │
       │    fiberId: "uuid" }      │                             │
       │◄──────────────────────────│                             │
```

---

## New Endpoints: Bridge (ottochain-services)

### 1. `POST /build/sm/create`

Build an unsigned `CreateStateMachine` message.

**Request**:
```typescript
{
  definition: StateMachineDefinition;  // state machine template
  initialData: Record<string, unknown>; // initial state data
  fiberId?: string;                    // optional UUID (generated if not provided)
  participants?: string[];             // new! wallet addresses for Epic A multi-party signing
}
```

**Response** (200):
```typescript
{
  fiberId: string;                     // UUID to track this fiber
  unsigned: {
    CreateStateMachine: {
      fiberId: string;
      definition: StateMachineDefinition;
      initialData: Record<string, unknown>;  // creator/createdAt injected
      parentFiberId: null;
      participants?: string[];           // passed through if provided
    }
  }
}
```

**Notes**:
- No `privateKey` field — the bridge never sees the signing key
- `initialData.creator` is NOT auto-injected (the client knows who they are; they'll put it in `initialData` if needed — or we can accept `creatorAddress` as an optional parameter to maintain the current convenience behavior)
- `participants` is forwarded to `CreateStateMachine.participants` for Epic A support

### 2. `POST /build/sm/transition`

Build an unsigned `TransitionStateMachine` message. The bridge fetches the current sequence number from DL1.

**Request**:
```typescript
{
  fiberId: string;
  eventName: string;
  payload?: Record<string, unknown>;
  callerAddress?: string;           // optional — if provided, injected into payload.agent
}
```

**Response** (200):
```typescript
{
  fiberId: string;
  currentState: string;            // current fiber state (for UX validation)
  unsigned: {
    TransitionStateMachine: {
      fiberId: string;
      eventName: string;
      payload: Record<string, unknown>;
      targetSequenceNumber: number;  // fetched from DL1 optimistic cache
    }
  }
}
```

**Notes**:
- Bridge fetches `targetSequenceNumber` from DL1 (using existing optimistic cache)
- Client must sign this exact object — changing the sequence number invalidates the signature
- If sequence is stale when submitted, bridge retries with fresh DL1 fetch once

### 3. `POST /build/sm/archive`

Build an unsigned `ArchiveStateMachine` message.

**Request**:
```typescript
{
  fiberId: string;
}
```

**Response** (200):
```typescript
{
  fiberId: string;
  unsigned: {
    ArchiveStateMachine: {
      fiberId: string;
      targetSequenceNumber: number;
    }
  }
}
```

### 4. `POST /submit`

Submit a signed transaction (generic — works for any OttochainMessage type).

**Request**:
```typescript
{
  signed: {
    value: OttochainMessage;          // the same message from /build
    proofs: Array<{
      id: string;                     // public key (128 hex chars without 04 prefix)
      signature: string;              // DER-encoded ECDSA signature in hex
    }>;
  }
}
```

**Response** (200):
```typescript
{
  hash: string;                       // transaction hash from DL1
  fiberId: string;                    // extracted from the message
  messageType: string;                // "CreateStateMachine" | "TransitionStateMachine" | etc.
  acceptedBy?: string;                // DL1 node URL (for diagnostics)
}
```

**Errors**:
- `400 Bad Request`: Zod validation failure (malformed signed object)
- `422 Unprocessable Entity`: DL1 rejected (invalid signature, bad sequence number, etc.) — body: `{ error: string, dl1Error: string }`
- `503 Service Unavailable`: All DL1 nodes unreachable

---

## New SDK Methods (ottochain-sdk)

### SDK v1.1.0 Additions

**File**: `src/client/signing.ts` (new) or added to `src/metakit/index.ts`

```typescript
/**
 * Build a CreateStateMachine unsigned message.
 * Call /build/sm/create on the bridge instead for production use —
 * this is the client-side equivalent for tests and offline use.
 */
export function buildCreateTransaction(args: {
  definition: StateMachineDefinition;
  initialData: Record<string, unknown>;
  fiberId?: string;
  participants?: Address[];
}): { fiberId: string; unsigned: OttochainMessage } {
  const fiberId = args.fiberId ?? randomUUID();
  return {
    fiberId,
    unsigned: {
      CreateStateMachine: {
        fiberId,
        definition: args.definition,
        initialData: args.initialData,
        parentFiberId: null,
        participants: args.participants ?? null,
      }
    }
  };
}

/**
 * Sign an OttochainMessage (unsigned payload from /build endpoint).
 * Wraps SDK's createSignedObject with isDataUpdate: true.
 */
export async function signTransaction(
  message: OttochainMessage,
  privateKey: string
): Promise<Signed<OttochainMessage>> {
  return createSignedObject(message, privateKey, { isDataUpdate: true });
}

/**
 * Add a co-signer to an already-signed transaction.
 * Used for multi-sig flows (e.g., DAO governance requiring N-of-M signatures).
 */
export async function addCoSigner(
  signed: Signed<OttochainMessage>,
  privateKey: string
): Promise<Signed<OttochainMessage>> {
  return addSignature(signed, privateKey, { isDataUpdate: true });
}

/**
 * Submit a pre-signed transaction to the bridge.
 *
 * @param signed  - Result of signTransaction() or addCoSigner()
 * @param bridgeUrl - Bridge base URL (defaults to config)
 */
export async function submitSignedTransaction(
  signed: Signed<OttochainMessage>,
  bridgeUrl?: string
): Promise<{ hash: string; fiberId: string; messageType: string }> {
  const url = bridgeUrl ?? getConfig().BRIDGE_URL;
  const response = await fetch(`${url}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signed }),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Bridge submit failed: ${err.error ?? response.statusText}`);
  }
  return response.json();
}

/**
 * High-level convenience: build → sign → submit in one call.
 * For migration: same interface as old bridge endpoints but signing is local.
 */
export async function createAndSubmitFiber(args: {
  definition: StateMachineDefinition;
  initialData: Record<string, unknown>;
  privateKey: string;
  participants?: Address[];
  bridgeUrl?: string;
}): Promise<{ hash: string; fiberId: string }> {
  const { unsigned, fiberId } = buildCreateTransaction(args);
  const signed = await signTransaction(unsigned, args.privateKey);
  const result = await submitSignedTransaction(signed, args.bridgeUrl);
  return { hash: result.hash, fiberId };
}
```

---

## Deprecated Endpoints (kept in 0.5.x)

The following existing endpoints are **deprecated** but remain functional:

| Old Endpoint | Replacement |
|-------------|-------------|
| `POST /sm/create` (with `privateKey`) | `POST /build/sm/create` + `POST /submit` |
| `POST /sm/transition` (with `privateKey`) | `POST /build/sm/transition` + `POST /submit` |
| `POST /sm/:fiberId/commit` (with `privateKey`) | `POST /build/sm/transition` (eventName: "commit") + `POST /submit` |
| `POST /fiber/create` (if exists, with `privateKey`) | `POST /build/sm/create` + `POST /submit` |

**Deprecation implementation**:
```typescript
smRoutes.post('/create', async (req, res) => {
  console.warn('[DEPRECATED] POST /sm/create: use /build/sm/create + /submit instead');
  // ... existing implementation unchanged
});
```

---

## TDD Test Cases

Write these tests across two repos:

### Bridge Tests (`ottochain-services/packages/bridge/test/client-signing.test.ts`)

#### Group 1: Build Endpoints Return Unsigned Messages (4 tests)

**T1.1 — POST /build/sm/create returns fiberId + unsigned message**
```
request: { definition: simpleDef, initialData: { status: "OPEN" } }
expect:
  - response.fiberId is a valid UUID
  - response.unsigned.CreateStateMachine.fiberId == response.fiberId
  - response.unsigned.CreateStateMachine.definition deep-equals request.definition
  - NO privateKey field anywhere in response
```

**T1.2 — POST /build/sm/transition returns message with sequenceNumber**
```
setup: create fiber via full submit pipeline (to establish sequence)
request: { fiberId: createdId, eventName: "advance", payload: {} }
expect:
  - response.unsigned.TransitionStateMachine.targetSequenceNumber >= 0
  - response.unsigned.TransitionStateMachine.eventName == "advance"
  - response.currentState is a string
  - NO privateKey field
```

**T1.3 — POST /build/sm/create with participants field passes through**
```
request: { definition, initialData, participants: ["0x1234..."] }
expect:
  - response.unsigned.CreateStateMachine.participants == ["0x1234..."]
```

**T1.4 — POST /build/sm/create with fiberId hint uses it**
```
request: { definition, initialData, fiberId: "my-uuid" }
expect:
  - response.fiberId == "my-uuid"
  - response.unsigned.CreateStateMachine.fiberId == "my-uuid"
```

#### Group 2: POST /submit Accepts Signed Transactions (4 tests)

**T2.1 — Full round-trip: build → sign (test) → submit**
```
1. POST /build/sm/create → unsigned
2. sign unsigned.CreateStateMachine with SDK signTransaction()
3. POST /submit with { signed: { value: msg, proofs: [...] } }
expect:
  - response.hash is non-empty string
  - response.messageType == "CreateStateMachine"
  - response.fiberId == original fiberId
```

**T2.2 — Submit with invalid signature returns 422**
```
1. POST /build/sm/create → unsigned message
2. Create malformed signed: { value: msg, proofs: [{ id: "fake", signature: "0000" }] }
3. POST /submit
expect:
  - 422 status
  - body.error contains "rejected" or "signature"
```

**T2.3 — Submit with wrong proof for message returns 422**
```
1. POST /build/sm/create → unsigned message A
2. Sign message B with valid key → proof for B
3. POST /submit { value: A, proofs: [proof_for_B] }
expect: 422 — signature doesn't match message
```

**T2.4 — Submit unknown message type returns 400**
```
POST /submit { signed: { value: { UnknownMessage: {} }, proofs: [] } }
expect: 400 Bad Request (Zod validation)
```

#### Group 3: Deprecated Endpoints Still Work (2 tests)

**T3.1 — POST /sm/create with privateKey still works**
```
POST /sm/create { privateKey: "...", definition: ..., initialData: ... }
expect:
  - 201 response with fiberId
  - deprecation warning logged (check process output or header)
```

**T3.2 — POST /sm/transition with privateKey still works**
```
(creates fiber first, then transitions)
POST /sm/transition { privateKey: "...", fiberId: "...", eventName: "advance" }
expect: 200 with hash
```

#### Group 4: Sequence Number Handling (2 tests)

**T4.1 — Build transition after create uses correct initial sequence**
```
1. Build + sign + submit CreateStateMachine
2. POST /build/sm/transition for same fiberId
expect: targetSequenceNumber == 0  (first transition after create)
```

**T4.2 — Build transition after one transition uses sequence 1**
```
1. Build + submit CreateStateMachine (seq becomes 0)
2. Build + submit TransitionStateMachine (seq 0 → becomes 1)
3. POST /build/sm/transition for same fiberId
expect: targetSequenceNumber == 1
```

---

### SDK Tests (`ottochain-sdk/tests/client-signing.test.ts`)

#### Group 5: SDK Signing Functions (3 tests)

**T5.1 — signTransaction produces valid Signed object**
```
const msg = { CreateStateMachine: { fiberId: "...", ...} }
const signed = await signTransaction(msg, privateKeyHex)
expect:
  - signed.value == msg
  - signed.proofs.length == 1
  - signed.proofs[0].id is 128-char hex (public key)
  - signed.proofs[0].signature is non-empty hex
```

**T5.2 — addCoSigner adds second proof to existing Signed**
```
let signed = await signTransaction(msg, aliceKey)
signed = await addCoSigner(signed, bobKey)
expect:
  - signed.proofs.length == 2
  - proof[0].id != proof[1].id  (different keys)
```

**T5.3 — buildCreateTransaction generates UUID when fiberId not provided**
```
const { fiberId, unsigned } = buildCreateTransaction({ definition, initialData })
expect:
  - fiberId is valid UUID v4 format
  - unsigned.CreateStateMachine.fiberId == fiberId
```

---

## Route Table: Old vs New

| Scenario | Old Route (deprecated) | New Routes (v1.1.0) |
|----------|----------------------|---------------------|
| Create fiber | `POST /sm/create` → `{ privateKey, definition, initialData }` | `POST /build/sm/create` → sign → `POST /submit` |
| Transition | `POST /sm/transition` → `{ privateKey, fiberId, eventName }` | `POST /build/sm/transition` → sign → `POST /submit` |
| Archive | `POST /sm/archive` (if exists) | `POST /build/sm/archive` → sign → `POST /submit` |
| Query fiber | `GET /sm/:fiberId` | Unchanged |
| List fibers | `GET /sm?filters` | Unchanged |
| Multi-sig | ❌ Not possible | `POST /submit` with proofs from multiple keys |

---

## Migration Guide for Callers

### Before (old — privateKey on wire):
```typescript
// Traffic generator, old pattern
const res = await fetch(`${BRIDGE_URL}/sm/create`, {
  method: 'POST',
  body: JSON.stringify({
    privateKey: process.env.PRIVATE_KEY,  // ← bad
    definition: myDef,
    initialData: { status: 'OPEN' },
  }),
});
```

### After (new — client-side signing):
```typescript
import { buildCreateTransaction, signTransaction, submitSignedTransaction } from '@ottochain/sdk';

// Option A: Three-step (maximum control)
const { fiberId, unsigned } = buildCreateTransaction({
  definition: myDef,
  initialData: { status: 'OPEN' },
});
const signed = await signTransaction(unsigned, process.env.PRIVATE_KEY!);
const result = await submitSignedTransaction(signed, BRIDGE_URL);

// Option B: One-liner convenience (same as old, but key never leaves client)
const result = await createAndSubmitFiber({
  definition: myDef,
  initialData: { status: 'OPEN' },
  privateKey: process.env.PRIVATE_KEY!,
  bridgeUrl: BRIDGE_URL,
});
```

### Multi-party flow (new capability):
```typescript
// Bob accepts a contract that Alice created
// Alice built the fiber with participants: [bob.address]

// Bob builds and signs the acceptance transition
const { unsigned } = await fetch(`${BRIDGE_URL}/build/sm/transition`, {
  method: 'POST',
  body: JSON.stringify({ fiberId: contractId, eventName: 'accept' }),
}).then(r => r.json());

const signed = await signTransaction(unsigned.TransitionStateMachine, bobPrivateKey);
await submitSignedTransaction(signed, BRIDGE_URL);
```

---

## Files to Change

### `ottobot-ai/ottochain-services`

```
packages/bridge/src/
├── routes/
│   ├── build.ts          NEW — /build/{sm,fiber}/{create,transition,archive}
│   └── submit.ts         NEW — /submit (generic signed submission)
├── index.ts              Register new /build and /submit routes
└── metagraph.ts          Add submitSigned() for pre-signed payloads
packages/bridge/test/
└── client-signing.test.ts  NEW — 15 TDD tests (Groups 1-4, write BEFORE implementing)
```

Deprecation additions to existing files:
- `routes/sm.ts` — add deprecation log to `POST /sm/create` and `POST /sm/transition`

### `ottobot-ai/ottochain-sdk`

```
src/
├── client/
│   └── signing.ts        NEW — buildCreateTransaction, signTransaction, addCoSigner, etc.
└── index.ts              Export new signing functions
tests/
└── client-signing.test.ts  NEW — 6 TDD tests (Group 5 + extra SDK tests)
```

---

## Open Questions for James

1. **`initialData.creator` auto-injection**: Currently the bridge injects `creator: callerAddress` and `createdAt`. With client-side signing, the bridge doesn't know the caller's address. Should the bridge accept an optional `callerAddress` param in `/build/sm/create`? Or should clients inject their own creator field? Or drop this convention entirely?

2. **Build endpoint URL structure**: `/build/sm/create` vs `/sm/build/create` vs `/sm/unsigned` — which path pattern fits better with our existing route organization?

3. **DL1 direct submit**: Should the SDK's `submitSignedTransaction` be able to submit directly to DL1 (bypassing the bridge), for clients with DL1 access? Or always route through bridge?

4. **Sequence number race**: If two clients build transitions for the same fiber simultaneously, both get the same `targetSequenceNumber`. One will fail with a sequence mismatch. Should the bridge retry with a fresh sequence? Or document as "expected behavior" (client should retry)?

5. **Traffic generator migration**: Should the traffic generator migrate to new endpoints in the same PR, or separately? It affects all integration tests.

---

## Acceptance Criteria (James Review)

- [ ] **Design approved**: James agrees with Build → Sign → Submit pattern
- [ ] **URL structure approved**: `/build/sm/create` etc. — or alternative names
- [ ] **SDK additions scoped**: confirm which functions land in SDK 1.1.0
- [ ] **Deprecation timeline**: confirm old endpoints stay for how long
- [ ] **Traffic gen migration**: in-scope or deferred?
- [ ] **creator injection**: resolved per Q1 above

---

## Target Releases

| Repo | Version | Changes |
|------|---------|---------|
| `ottochain-services` | 0.5.0 | New `/build/*` + `/submit` routes; deprecation logs on old routes |
| `ottochain-sdk` | 1.1.0 | `signTransaction`, `addCoSigner`, `buildCreateTransaction`, `submitSignedTransaction` |
| Traffic generator | — | Migrated to new SDK pattern (in same PR as services 0.5.0 or separate) |
