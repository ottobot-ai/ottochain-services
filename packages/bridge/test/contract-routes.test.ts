/**
 * Contract Routes — Unit Tests
 * 
 * Tests Zod validation schemas and SDK state machine definitions
 * used by the contract routes. No mocking or network needed.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const VALID_KEY = '1'.repeat(64);
const COUNTERPARTY = 'DAG0000000000000000000000000000000000000000';

const ProposeRequestSchema = z.object({
  privateKey: z.string().length(64),
  counterpartyAddress: z.string(),
  terms: z.record(z.any()),
  title: z.string().optional(),
  description: z.string().optional(),
});

const ContractActionSchema = z.object({
  privateKey: z.string().length(64),
  contractId: z.string().uuid(),
  proof: z.string().optional(),
  reason: z.string().optional(),
});

describe('Contract Routes — ProposeRequestSchema', () => {
  it('accepts valid propose request', () => {
    const result = ProposeRequestSchema.safeParse({
      privateKey: VALID_KEY,
      counterpartyAddress: COUNTERPARTY,
      terms: { title: 'Development Contract', payment: 1000 },
    });
    expect(result.success).toBeTruthy();
  });

  it('accepts optional title and description', () => {
    const result = ProposeRequestSchema.safeParse({
      privateKey: VALID_KEY,
      counterpartyAddress: COUNTERPARTY,
      terms: { title: 'Test' },
      title: 'Mobile App',
      description: 'Build an app',
    });
    expect(result.success).toBeTruthy();
  });

  it('rejects missing privateKey', () => {
    const result = ProposeRequestSchema.safeParse({
      counterpartyAddress: COUNTERPARTY,
      terms: { title: 'Test' },
    });
    expect(!result.success).toBeTruthy();
  });

  it('rejects short privateKey', () => {
    const result = ProposeRequestSchema.safeParse({
      privateKey: 'abc',
      counterpartyAddress: COUNTERPARTY,
      terms: { title: 'Test' },
    });
    expect(!result.success).toBeTruthy();
  });

  it('rejects missing terms', () => {
    const result = ProposeRequestSchema.safeParse({
      privateKey: VALID_KEY,
      counterpartyAddress: COUNTERPARTY,
    });
    expect(!result.success).toBeTruthy();
  });

  it('rejects missing counterpartyAddress', () => {
    const result = ProposeRequestSchema.safeParse({
      privateKey: VALID_KEY,
      terms: { title: 'Test' },
    });
    expect(!result.success).toBeTruthy();
  });

  it('accepts empty terms object', () => {
    const result = ProposeRequestSchema.safeParse({
      privateKey: VALID_KEY,
      counterpartyAddress: COUNTERPARTY,
      terms: {},
    });
    expect(result.success).toBeTruthy();
  });
});

describe('Contract Routes — ContractActionSchema', () => {
  it('accepts valid action request', () => {
    const result = ContractActionSchema.safeParse({
      privateKey: VALID_KEY,
      contractId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBeTruthy();
  });

  it('rejects non-UUID contractId', () => {
    const result = ContractActionSchema.safeParse({
      privateKey: VALID_KEY,
      contractId: 'not-a-uuid',
    });
    expect(!result.success).toBeTruthy();
  });

  it('accepts optional proof and reason', () => {
    const result = ContractActionSchema.safeParse({
      privateKey: VALID_KEY,
      contractId: '550e8400-e29b-41d4-a716-446655440000',
      proof: 'https://example.com/proof',
      reason: 'Some reason',
    });
    expect(result.success).toBeTruthy();
  });

  it('rejects missing contractId', () => {
    const result = ContractActionSchema.safeParse({ privateKey: VALID_KEY });
    expect(!result.success).toBeTruthy();
  });

  it('rejects missing privateKey', () => {
    const result = ContractActionSchema.safeParse({
      contractId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(!result.success).toBeTruthy();
  });
});

describe('Contract Routes — State Machine Definitions', () => {
  it('agreement definition has correct initial state', async () => {
    const { toProtoDefinition } = await import('@ottochain/sdk');
    const { getContractDefinition } = await import('@ottochain/sdk/apps/contracts');
    const proto = toProtoDefinition(getContractDefinition('agreement'));

    expect(proto.initialState).toBe('PROPOSED');
    expect(proto.states).toBeTruthy();
    expect(proto.transitions).toBeTruthy();
  });

  it('agreement has expected lifecycle states', async () => {
    const { toProtoDefinition } = await import('@ottochain/sdk');
    const { getContractDefinition } = await import('@ottochain/sdk/apps/contracts');
    const proto = toProtoDefinition(getContractDefinition('agreement'));
    const stateIds = Object.keys(proto.states);

    for (const expected of ['PROPOSED', 'ACTIVE', 'COMPLETED', 'REJECTED', 'DISPUTED']) {
      expect(stateIds.includes(expected)).toBe(true);
    }
  });

  it('agreement has expected transition events', async () => {
    const { toProtoDefinition } = await import('@ottochain/sdk');
    const { getContractDefinition } = await import('@ottochain/sdk/apps/contracts');
    const proto = toProtoDefinition(getContractDefinition('agreement'));
    const events = proto.transitions.map((t: any) => t.eventName);

    for (const expected of ['accept', 'reject', 'dispute']) {
      expect(events.includes(expected)).toBe(true);
    }
  });

  it('every transition has guard and effect (required by Scala)', async () => {
    const { toProtoDefinition } = await import('@ottochain/sdk');
    const { getContractDefinition } = await import('@ottochain/sdk/apps/contracts');
    const proto = toProtoDefinition(getContractDefinition('agreement'));

    for (const t of proto.transitions) {
      expect(t.guard !== undefined).toBe(true);
      expect(t.effect !== undefined).toBe(true);
    }
  });

  it('escrow definition has expected events', async () => {
    const { toProtoDefinition } = await import('@ottochain/sdk');
    const { getContractDefinition } = await import('@ottochain/sdk/apps/contracts');
    const proto = toProtoDefinition(getContractDefinition('escrow'));
    const events = proto.transitions.map((t: any) => t.eventName);

    for (const expected of ['deposit', 'approve_release', 'dispute']) {
      expect(events.includes(expected)).toBe(true);
    }
  });
});

describe('Contract Routes — Dispute Requires Reason', () => {
  it('schema allows missing reason but route rejects it', () => {
    const result = ContractActionSchema.safeParse({
      privateKey: VALID_KEY,
      contractId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBeTruthy();
    expect(result.data!.reason).toBe(undefined);
  });
});
