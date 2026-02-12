#!/usr/bin/env npx tsx
/**
 * Test with the FULL contract definition extracted from bridge
 */
import { batchSign, generateKeyPair, HttpClient } from '@ottochain/sdk';
import { randomUUID } from 'crypto';

const DL1_URL = 'http://localhost:9400';

// Import the actual definition from bridge
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
      from: { value: 'ACTIVE' }, to: { value: 'ACTIVE' }, eventName: 'submit_completion',
      guard: { or: [{ '===': [{ var: 'event.agent' }, { var: 'state.proposer' }] }, { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] }] },
      effect: { merge: [{ var: 'state' }, { completions: { cat: [{ var: 'state.completions' }, [{ agent: { var: 'event.agent' }, proof: { var: 'event.proof' }, submittedAt: { var: '$timestamp' } }]] } }] },
      dependencies: [],
    },
    {
      from: { value: 'ACTIVE' }, to: { value: 'COMPLETED' }, eventName: 'finalize',
      guard: { '>=': [{ count: { var: 'state.completions' } }, 2] },
      effect: { merge: [{ var: 'state' }, { status: 'COMPLETED', completedAt: { var: '$timestamp' } }] },
      dependencies: [],
    },
    {
      from: { value: 'ACTIVE' }, to: { value: 'DISPUTED' }, eventName: 'dispute',
      guard: { or: [{ '===': [{ var: 'event.agent' }, { var: 'state.proposer' }] }, { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] }] },
      effect: { merge: [{ var: 'state' }, { status: 'DISPUTED', disputedAt: { var: '$timestamp' }, disputeReason: { var: 'event.reason' }, disputedBy: { var: 'event.agent' } }] },
      dependencies: [],
    },
    {
      from: { value: 'DISPUTED' }, to: { value: 'COMPLETED' }, eventName: 'resolve',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { status: 'COMPLETED', resolvedAt: { var: '$timestamp' }, resolution: { var: 'event.resolution' } }] },
      dependencies: [],
    },
    {
      from: { value: 'PROPOSED' }, to: { value: 'Cancelled' }, eventName: 'cancel',
      guard: { '===': [{ var: 'event.agent' }, { var: 'state.proposer' }] },
      effect: { merge: [{ var: 'state' }, { status: 'Cancelled', cancelledAt: { var: '$timestamp' } }] },
      dependencies: [],
    },
  ],
  metadata: { name: 'Contract', description: 'Agreement between two agents with completion attestation', version: '1.0.0' },
};

async function main() {
  const keyPair = generateKeyPair();
  const counterparty = generateKeyPair();
  console.log('Proposer:', keyPair.address);
  console.log('Counterparty:', counterparty.address);

  const fiberId = randomUUID();
  const message = {
    CreateStateMachine: {
      fiberId,
      definition: CONTRACT_DEFINITION,
      initialData: {
        schema: 'Contract',
        title: 'Test Contract',
        description: '',
        proposer: keyPair.address,
        counterparty: counterparty.address,
        terms: { task: 'Test', value: 100 },
        completions: [],
        status: 'PROPOSED',
        proposedAt: new Date().toISOString(),
      },
      parentFiberId: null,
    },
  };

  console.log('\nSubmitting to DL1...');
  const signed = await batchSign(message, [keyPair.privateKey], { isDataUpdate: true });
  const client = new HttpClient(DL1_URL);
  
  try {
    const result = await client.post<{ hash: string }>('/data', signed);
    console.log('✅ Success:', result);
  } catch (err) {
    const error = err as Error & { response?: string };
    console.log('❌ Failed:', error.message);
    if (error.response) console.log('Response:', error.response);
  }
}

main();
