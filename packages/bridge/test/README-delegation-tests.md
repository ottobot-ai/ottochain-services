# Bridge Delegation Endpoint - TDD Test Suite

## Overview

This directory contains comprehensive TDD tests for the new bridge delegation endpoint that allows relayers to submit delegated transactions on behalf of users.

**Card:** 🌉 Bridge: Submit delegated transactions endpoint (#699621bf250f72009bae19af)  
**Epic:** Delegated Signing / Relayer Pattern  
**Status:** TDD Red Phase - All tests currently FAIL awaiting implementation

## Test Files

### 1. `routes/delegation.test.ts` - API Integration Tests
- **POST /delegation/submit** endpoint functionality
- **POST /delegation/:id/revoke** endpoint functionality
- Request/response validation and error handling
- Security features (replay protection, rate limiting)
- Integration with metagraph client
- **Coverage:** 35+ test scenarios across 6 test groups

### 2. `delegation-validation.test.ts` - Validation Utilities Unit Tests
- Cryptographic signature verification
- Delegation expiry checking
- Scope validation and wildcard patterns
- Context building for metagraph submission
- **Coverage:** 25+ test scenarios across 6 utility functions

## Implementation Requirements

Based on the failing tests, the following components need to be implemented:

### 1. Delegation Routes (`src/routes/delegation.ts`)

```typescript
export const delegationRoutes: Router;

// POST /delegation/submit
// POST /delegation/:id/revoke
```

**Key Features:**
- Zod schema validation for all request/response objects
- Integration with delegation validation utilities
- Error handling with proper HTTP status codes
- Rate limiting per relayer address
- Security checks (signature verification, replay protection)

### 2. Delegation Validation Utilities (`src/utils/delegation-validation.ts`)

```typescript
export interface DelegationValidationResult {
  isValid: boolean;
  error?: string;
  details?: string;
  credential?: {
    id: string;
    isActive: boolean;
    isRevoked: boolean;
  };
}

export function validateDelegation(
  delegation: Delegation,
  transaction: Transaction,
  relayerSignature: string
): Promise<DelegationValidationResult>;

export function verifyRelayerSignature(
  message: string,
  signature: string,
  relayerAddress: string
): boolean;

export function checkDelegationExpiry(expiry: number): boolean;

export function validateDelegationScope(
  operation: string,
  scope: string[]
): boolean;

export function buildDelegationContext(
  delegation: Delegation
): DelegationContext;
```

### 3. Metagraph Client Extensions (`src/metagraph.ts`)

Add delegation-related functions:
```typescript
export function validateDelegation(/* ... */): Promise<DelegationValidationResult>;
export function getDelegationContext(/* ... */): Promise<DelegationContext>;
```

### 4. Type Definitions

Based on the tests, these TypeScript interfaces are expected:

```typescript
interface Delegation {
  delegatorAddress: string;
  relayerAddress: string;
  signature: string;
  expiry: number;
  credentialId: string;
  scope: string[];
  nonce?: number;
}

interface DelegationContext {
  delegatorAddr: string;
  relayerAddr: string;
  credentialId: string;
  scope: string[];
  nonce: number;
  isDelegate: boolean;
}

interface DelegationSubmitRequest {
  transaction: Transaction | Transaction[];
  delegation: Delegation;
  relayerSignature: string;
}
```

## Request/Response Schemas

### POST /delegation/submit

**Request:**
```json
{
  "transaction": {
    "fiberId": "fiber-123",
    "eventName": "updateBalance",
    "payload": { "amount": 100, "recipient": "DAG456..." }
  },
  "delegation": {
    "delegatorAddress": "DAG123...",
    "relayerAddress": "DAG789...", 
    "signature": "0xabc123...",
    "expiry": 1640995200000,
    "credentialId": "credential-456",
    "scope": ["updateBalance", "transfer"]
  },
  "relayerSignature": "0xdef456..."
}
```

**Success Response (200):**
```json
{
  "success": true,
  "ordinal": 12345,
  "transactionHash": "0x789abc...",
  "delegatorAddress": "DAG123..."
}
```

**Error Response (400/403/500):**
```json
{
  "success": false,
  "error": "INVALID_DELEGATION",
  "code": "DELEGATION_EXPIRED", 
  "message": "Delegation expired at timestamp 1640995200000"
}
```

### POST /delegation/:id/revoke

**Request:**
```json
{
  "privateKey": "a".repeat(64),
  "reason": "User requested revocation"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "ordinal": 12346,
  "transactionHash": "0xrevoke123...",
  "credentialId": "credential-456",
  "status": "revoked"
}
```

## Error Codes

The tests expect these specific error codes:

| Code | Status | Description |
|------|---------|-------------|
| `VALIDATION_ERROR` | 400 | Request schema validation failed |
| `INVALID_DELEGATION` | 400 | Delegation validation failed |
| `INVALID_SIGNATURE` | 400 | Cryptographic signature invalid |
| `DELEGATION_EXPIRED` | 400 | Delegation past expiry time |
| `DELEGATION_REVOKED` | 403 | Delegation has been revoked |
| `INSUFFICIENT_SCOPE` | 403 | Operation not permitted by delegation |
| `RELAYER_MISMATCH` | 403 | Relayer signature doesn't match delegation |
| `REPLAY_ATTACK` | 403 | Delegation nonce already used |
| `UNAUTHORIZED` | 403 | Only delegator can revoke |
| `RATE_LIMITED` | 429 | Too many requests from relayer |
| `SUBMISSION_FAILED` | 400 | Metagraph rejected transaction |
| `VALIDATION_SERVICE_ERROR` | 500 | Internal validation service error |
| `TIMEOUT` | 504 | Request timed out |

## Security Features

The tests validate these security measures:

1. **Signature Verification:** Both delegation signature (by delegator) and relayer signature must be valid
2. **Replay Protection:** Delegation nonces prevent reuse of delegation proofs  
3. **Scope Enforcement:** Transactions must be within delegation scope
4. **Expiry Checking:** Expired delegations are rejected
5. **Revocation Support:** Revoked delegations cannot be used
6. **Rate Limiting:** Prevent abuse by limiting requests per relayer
7. **Address Validation:** Proper DAG address format checking

## Running Tests

```bash
# Run all delegation tests
npm test -- --testPathPattern="delegation"

# Run specific test file
npm test -- routes/delegation.test.ts
npm test -- delegation-validation.test.ts

# Watch mode during development
npm test -- --watch --testPathPattern="delegation"
```

## Dependencies

The implementation will need:
- **Express Router** for HTTP endpoints
- **Zod** for request/response validation
- **crypto** module for signature verification
- **Rate limiting middleware** (e.g., express-rate-limit)
- **Metagraph client** for transaction submission

## Test Coverage

**Total:** 60+ test scenarios covering:
- ✅ Happy path delegation submission
- ✅ Batch transaction support
- ✅ All validation error cases
- ✅ Security attack scenarios
- ✅ Network/service error handling
- ✅ Delegation revocation flow
- ✅ Utility function edge cases

## Integration Notes

- Tests mock the metagraph client functions
- Real integration will require metagraph support for delegation context
- Bridge must coordinate with ML0 delegation validation
- Rate limiting should be configurable per deployment

---

**Next Steps:** Implement the components to make these failing tests pass! 🚀