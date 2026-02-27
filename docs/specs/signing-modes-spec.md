# Signing Modes Specification

**Status:** Draft  
**Date:** 2026-02-27  
**Branch:** `feat/signing-modes`

## Overview

The OttoChain bridge currently requires clients to send their private key with every API request. The bridge then signs transactions on the client's behalf. This creates several security risks:

1. **Key exposure in transit** — Private keys travel over the network with every request
2. **Key storage on bridge** — The bridge must handle (and could log/leak) sensitive keys
3. **No key isolation** — A compromised bridge exposes all client keys
4. **Audit complexity** — Difficult to prove who signed what

This specification introduces two signing modes that address these concerns while maintaining backward compatibility.

---

## Design Goals

1. **Never return private keys to clients** — Server-generated keys stay on the server
2. **Support client-side signing** — For security-conscious clients who manage their own keys
3. **Maintain API ergonomics** — Simple registration flow for both modes
4. **Enable future key rotation** — Design allows for key lifecycle management
5. **Backward compatible** — Deprecate but don't immediately break existing API

---

## Signing Modes

### Mode 1: Server-Signed (`server`)

The bridge generates and stores keys internally. Clients send unsigned payloads; the bridge signs on their behalf.

**Security model:**
- Private keys are generated server-side and never leave the bridge
- Keys stored in memory (phase 1) or encrypted database (phase 2)
- Clients authenticate via their `fiberId` (UUID) and optional API key
- Rate limiting per fiber prevents abuse

**Ideal for:**
- Quick prototypes and testing
- Clients that trust the bridge operator
- Simplified client implementations

### Mode 2: Self-Signed (`self`)

Clients manage their own keys and submit pre-signed transactions. The bridge validates signatures and relays to the metagraph.

**Security model:**
- Private keys never touch the bridge
- Bridge validates signature matches registered public key
- Bridge uses a relay key to submit to metagraph (gas sponsorship model)
- Full audit trail of who signed what

**Ideal for:**
- Production applications
- Clients requiring key custody
- Regulatory compliance scenarios

---

## API Design

### Registration

#### `POST /agent/register`

**Request (Server-Signed Mode):**
```json
{
  "signingMode": "server",
  "displayName": "My Agent",
  "platform": "discord",
  "platformUserId": "123456789"
}
```

**Response (Server-Signed Mode):**
```json
{
  "fiberId": "550e8400-e29b-41d4-a716-446655440000",
  "address": "DAG4...",
  "publicKey": "04abc...",
  "signingMode": "server",
  "message": "Agent identity created. Call /agent/activate to activate."
}
```

Note: Private key is **never** returned. It is stored internally.

---

**Request (Self-Signed Mode):**
```json
{
  "signingMode": "self",
  "publicKey": "abc123...def456",
  "displayName": "My Secure Agent",
  "platform": "telegram",
  "platformUserId": "987654321"
}
```

Public key must be 128 characters (hex, without `04` prefix).

**Response (Self-Signed Mode):**
```json
{
  "fiberId": "550e8400-e29b-41d4-a716-446655440001",
  "address": "DAG4...",
  "publicKey": "abc123...def456",
  "signingMode": "self",
  "message": "Agent identity created. Submit pre-signed transactions via /agent/transition."
}
```

---

### Transitions

#### `POST /agent/transition`

**Request (Server-Signed Mode):**
```json
{
  "fiberId": "550e8400-e29b-41d4-a716-446655440000",
  "event": "activate",
  "payload": {}
}
```

No signature required — bridge signs internally.

---

**Request (Self-Signed Mode):**
```json
{
  "fiberId": "550e8400-e29b-41d4-a716-446655440001",
  "signedUpdate": {
    "value": {
      "TransitionStateMachine": {
        "fiberId": "550e8400-e29b-41d4-a716-446655440001",
        "eventName": "activate",
        "payload": {},
        "targetSequenceNumber": 0
      }
    },
    "proofs": [
      {
        "id": "abc123...def456",
        "signature": "3045022100..."
      }
    ]
  }
}
```

The `signedUpdate` is a `Signed<TransitionStateMachine>` object as defined by `@ottochain/sdk`.

---

### Other Endpoints

#### `POST /agent/activate`

For server-signed agents, accepts `fiberId` only:
```json
{
  "fiberId": "...",
  "waitForSync": true
}
```

For self-signed agents, same `signedUpdate` format as `/transition`.

#### `POST /agent/vouch`

Server-signed:
```json
{
  "fiberId": "...",
  "targetFiberId": "...",
  "reason": "Trusted partner"
}
```

Self-signed:
```json
{
  "signedUpdate": { ... }
}
```

---

## Request Schemas

### Zod Schemas (TypeScript)

```typescript
// Base metadata (shared)
const AgentMetadataSchema = z.object({
  displayName: z.string().optional(),
  platform: z.string().optional(),
  platformUserId: z.string().optional(),
});

// Server-signed registration
const RegisterServerSignedSchema = AgentMetadataSchema.extend({
  signingMode: z.literal('server'),
});

// Self-signed registration  
const RegisterSelfSignedSchema = AgentMetadataSchema.extend({
  signingMode: z.literal('self'),
  publicKey: z.string().length(128).regex(/^[0-9a-fA-F]+$/),
});

// Combined registration
const RegisterRequestSchema = z.discriminatedUnion('signingMode', [
  RegisterServerSignedSchema,
  RegisterSelfSignedSchema,
]);

// Server-signed transition (bridge signs)
const TransitionServerSignedSchema = z.object({
  fiberId: z.string().uuid(),
  event: z.string(),
  payload: z.record(z.any()).optional(),
});

// Self-signed transition (client signs)
const SignatureProofSchema = z.object({
  id: z.string().length(128),
  signature: z.string().min(100), // DER-encoded, variable length
});

const SignedUpdateSchema = z.object({
  value: z.record(z.any()),
  proofs: z.array(SignatureProofSchema).min(1),
});

const TransitionSelfSignedSchema = z.object({
  fiberId: z.string().uuid(),
  signedUpdate: SignedUpdateSchema,
});

// Transition accepts either format
const TransitionRequestSchema = z.union([
  TransitionServerSignedSchema,
  TransitionSelfSignedSchema,
]);
```

---

## Security Model

### Key Storage (Server-Signed Mode)

**Phase 1: In-Memory Store**
```typescript
interface KeyStore {
  get(fiberId: string): Promise<string | undefined>;
  set(fiberId: string, privateKey: string): Promise<void>;
  delete(fiberId: string): Promise<void>;
  has(fiberId: string): Promise<boolean>;
}

// Implementation: simple Map<string, string>
// Keys persist only for bridge lifetime
// Acceptable for development/staging
```

**Phase 2: Encrypted Database Store (Future)**
- Keys encrypted at rest using bridge master key
- Master key from env var or KMS
- Postgres/Redis backing store
- Key rotation support

### Signature Validation (Self-Signed Mode)

Before relaying a self-signed transaction:

1. **Extract public key from proof** — `proof.id` (128 chars)
2. **Derive address from public key** — Using `dag4` utilities
3. **Verify address matches fiber owner** — Query fiber state, compare `stateData.owner`
4. **Verify signature** — Recompute hash, verify ECDSA signature
5. **Verify message content** — `fiberId` in message matches route parameter

```typescript
async function validateSelfSigned(
  fiberId: string,
  signedUpdate: Signed<unknown>
): Promise<ValidationResult> {
  const proof = signedUpdate.proofs[0];
  if (!proof) return { valid: false, error: 'No proof provided' };
  
  // Derive address from public key
  const address = getAddressFromPublicKeyId(proof.id);
  
  // Get fiber owner
  const fiber = await getStateMachine(fiberId);
  if (!fiber) return { valid: false, error: 'Fiber not found' };
  
  const owner = fiber.stateData?.owner;
  if (address !== owner) {
    return { valid: false, error: 'Signer does not own this fiber' };
  }
  
  // Verify signature (TODO: implement cryptographic verification)
  // For now, trust that metagraph will reject invalid signatures
  
  return { valid: true };
}
```

### Rate Limiting

Per-fiber rate limits prevent abuse:

| Limit | Server-Signed | Self-Signed |
|-------|---------------|-------------|
| Registrations | 10/min per IP | 10/min per IP |
| Transitions | 60/min per fiber | 120/min per fiber |
| Batch size | N/A | 10 updates/request |

Self-signed mode gets higher limits since clients bear the signing cost.

---

## Key Rotation (Future)

### Server-Signed Key Rotation

```
POST /agent/:fiberId/rotate-key
Authorization: Bearer <admin-token>

Response:
{
  "fiberId": "...",
  "newPublicKey": "...",
  "rotatedAt": "2026-02-27T12:00:00Z"
}
```

Implementation:
1. Generate new keypair
2. Submit `update_key` transition to fiber (if state machine supports it)
3. Replace key in store
4. Old key immediately invalid

### Self-Signed Key Rotation

Client-driven:
1. Client generates new keypair
2. Client submits `update_key` transition with OLD key signing NEW public key
3. Fiber state updated with new owner
4. Client registers new public key with bridge

---

## Migration Path

### Phase 1: Dual-Mode Support (This PR)

- Add `signingMode` parameter to registration
- Default to `server` mode for backward compatibility
- Accept both old (`privateKey`) and new (`signingMode`) request formats
- Log deprecation warnings for `privateKey` usage

### Phase 2: Deprecate Old API (v0.6.0)

- Remove `privateKey` from request schemas
- Require explicit `signingMode` choice
- Migration script to convert existing agents

### Phase 3: Remove Deprecated Code (v1.0.0)

- Clean removal of all `privateKey` handling in routes
- Key store becomes the only source of server-signed keys

### Backward Compatibility

For migration, accept the legacy format and treat it as server-signed:

```typescript
// Legacy format (deprecated)
{
  "privateKey": "abc123...",
  "displayName": "Old Agent"
}

// Internally converted to:
{
  "signingMode": "server",
  "displayName": "Old Agent",
  // privateKey used to generate keypair, stored internally
}
```

Log a warning and encourage migration to new format.

---

## SDK Integration

### New SDK Helpers

```typescript
import { 
  signTransaction, 
  createTransitionPayload,
  generateKeyPair,
  keyPairFromPrivateKey 
} from '@ottochain/sdk';

// Generate a keypair (client-side)
const keyPair = generateKeyPair();
console.log(keyPair.publicKey); // 128 chars (without 04 prefix in ID form)
console.log(keyPair.address);   // DAG4...

// Register in self-signed mode
const response = await fetch('/agent/register', {
  method: 'POST',
  body: JSON.stringify({
    signingMode: 'self',
    publicKey: keyPair.publicKey.slice(2), // Remove 04 prefix
    displayName: 'My Agent',
  }),
});

// Create and sign a transition
const transition = createTransitionPayload({
  fiberId: 'my-fiber-id',
  eventName: 'activate',
  payload: {},
  targetSequenceNumber: await getSequence(fiberId),
});

const signedUpdate = await signTransaction(transition, keyPair.privateKey);

// Submit pre-signed transition
await fetch('/agent/transition', {
  method: 'POST',
  body: JSON.stringify({
    fiberId: 'my-fiber-id',
    signedUpdate,
  }),
});
```

### SDK Function Signatures

```typescript
/**
 * Create a transition payload ready for signing
 */
function createTransitionPayload(params: {
  fiberId: string;
  eventName: string;
  payload?: Record<string, unknown>;
  targetSequenceNumber: number;
}): TransitionStateMachine;

/**
 * Sign a transaction payload for self-signed mode
 * Returns a Signed<T> object ready for submission
 */
async function signTransaction<T>(
  payload: T,
  privateKey: string
): Promise<Signed<T>>;

/**
 * Get the public key ID (128 chars) from a keypair
 * This is the format expected by registration
 */
function getPublicKeyId(keyPair: KeyPair): string;
```

---

## Implementation Checklist

### Services (`ottochain-services`)

- [ ] Add `packages/bridge/src/lib/key-store.ts` — KeyStore interface + in-memory impl
- [ ] Update `packages/bridge/src/routes/agent.ts`:
  - [ ] New request schemas with discriminated unions
  - [ ] Registration logic for both modes
  - [ ] Transition logic for both modes
  - [ ] Deprecation warnings for `privateKey` field
- [ ] Add signature validation for self-signed mode
- [ ] Add rate limiting per fiber
- [ ] Update tests
- [ ] Update API documentation

### SDK (`ottochain-sdk`)

- [ ] Add `signTransaction()` helper
- [ ] Add `createTransitionPayload()` helper
- [ ] Add `getPublicKeyId()` utility
- [ ] Add example: `examples/signing-modes.ts`
- [ ] Update README

---

## Open Questions

1. **Admin key retrieval?** — Should there be an admin endpoint to retrieve server-stored keys for migration? Risk: key exposure. Alternative: export only to encrypted format.

2. **Multi-sig support?** — Self-signed mode could support multiple proofs. Defer to future PR?

3. **Gas sponsorship?** — Self-signed mode implies bridge pays gas. Is this acceptable? Alternative: require clients to deposit tokens for their relay quota.

---

## References

- [Issue #XXX: Remove private key from API requests](https://github.com/ottobot-ai/ottochain-services/issues/XXX)
- [OttoChain SDK Signing Documentation](https://github.com/ottobot-ai/ottochain-sdk)
- [Constellation Network Signing Protocol](https://docs.constellationnetwork.io)
