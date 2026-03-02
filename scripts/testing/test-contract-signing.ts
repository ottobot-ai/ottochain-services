#!/usr/bin/env npx tsx
/**
 * Test contract signing with actual contract definition
 */
import { generateKeyPair } from '@ottochain/sdk';
import { randomUUID } from 'crypto';
import { submitWithRetry } from './lib/submit-with-retry.js';

const CONTRACT_DEFINITION = {
  states: {
    Proposed: { id: { value: 'PROPOSED' }, isFinal: false, metadata: null },
    Active: { id: { value: 'ACTIVE' }, isFinal: false, metadata: null },
    Completed: { id: { value: 'COMPLETED' }, isFinal: true, metadata: null },
    Disputed: { id: { value: 'DISPUTED' }, isFinal: false, metadata: null },
    Rejected: { id: { value: 'REJECTED' }, isFinal: true, metadata: null },
    Cancelled: { id: { value: 'Cancelled' }, isFinal: true, metadata: null },
  },
  initialState: { value: 'PROPOSED' },
  transitions: [
    {
      from: { value: 'PROPOSED' }, to: { value: 'ACTIVE' }, eventName: 'accept',
      guard: { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] },
      effect: { merge: [{ var: 'state' }, { status: 'ACTIVE', acceptedAt: { var: '$timestamp' } }] },
      dependencies: [],
    },
    {
      from: { value: 'PROPOSED' }, to: { value: 'REJECTED' }, eventName: 'reject',
      guard: { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] },
      effect: { merge: [{ var: 'state' }, { status: 'REJECTED', rejectedAt: { var: '$timestamp' }, rejectReason: { var: 'event.reason' } }] },
      dependencies: [],
    },
    {
      from: { value: 'PROPOSED' }, to: { value: 'Cancelled' }, eventName: 'cancel',
      guard: { '===': [{ var: 'event.agent' }, { var: 'state.proposer' }] },
      effect: { merge: [{ var: 'state' }, { status: 'Cancelled', cancelledAt: { var: '$timestamp' } }] },
      dependencies: [],
    },
  ],
  metadata: { name: 'Contract', description: 'Agreement between two agents' },
};

async function main() {
  const keyPair = generateKeyPair();
  const counterparty = generateKeyPair();
  console.log('Proposer:', keyPair.address);
  console.log('Counterparty:', counterparty.address);

  const fiberId = randomUUID();

  try {
    const result = await submitWithRetry({
      message: {
        CreateStateMachine: {
          fiberId,
          definition: CONTRACT_DEFINITION,
          initialData: {
            schema: 'Contract',
            proposer: keyPair.address,
            counterparty: counterparty.address,
            terms: { task: 'Test task', value: 100 },
            completions: [],
            status: 'PROPOSED',
          },
          parentFiberId: null,
        },
      },
      privateKeys: [keyPair.privateKey],
      fiberId,
    });
    console.log(`✅ Success: ${result.hash} (attempt ${result.attempt})`);
  } catch (err) {
    const error = err as Error;
    console.log('❌ Failed:', error.message);
  }
}

main();
