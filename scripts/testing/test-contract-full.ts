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
    Proposed: { id: { value: 'Proposed' }, isFinal: false, metadata: null },
    Active: { id: { value: 'Active' }, isFinal: false, metadata: null },
    Completed: { id: { value: 'Completed' }, isFinal: true, metadata: null },
    Disputed: { id: { value: 'Disputed' }, isFinal: false, metadata: null },
    Rejected: { id: { value: 'Rejected' }, isFinal: true, metadata: null },
    Cancelled: { id: { value: 'Cancelled' }, isFinal: true, metadata: null },
  },
  initialState: { value: 'Proposed' },
  transitions: [
    {
      from: { value: 'Proposed' }, to: { value: 'Active' }, eventName: 'accept',
      guard: { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] },
      effect: { merge: [{ var: 'state' }, { status: 'Active', acceptedAt: { var: '$timestamp' } }] },
      dependencies: [],
    },
    {
      from: { value: 'Proposed' }, to: { value: 'Rejected' }, eventName: 'reject',
      guard: { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] },
      effect: { merge: [{ var: 'state' }, { status: 'Rejected', rejectedAt: { var: '$timestamp' }, rejectReason: { var: 'event.reason' } }] },
      dependencies: [],
    },
    {
      from: { value: 'Active' }, to: { value: 'Active' }, eventName: 'submit_completion',
      guard: { or: [{ '===': [{ var: 'event.agent' }, { var: 'state.proposer' }] }, { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] }] },
      effect: { merge: [{ var: 'state' }, { completions: { cat: [{ var: 'state.completions' }, [{ agent: { var: 'event.agent' }, proof: { var: 'event.proof' }, submittedAt: { var: '$timestamp' } }]] } }] },
      dependencies: [],
    },
    {
      from: { value: 'Active' }, to: { value: 'Completed' }, eventName: 'finalize',
      guard: { '>=': [{ count: { var: 'state.completions' } }, 2] },
      effect: { merge: [{ var: 'state' }, { status: 'Completed', completedAt: { var: '$timestamp' } }] },
      dependencies: [],
    },
    {
      from: { value: 'Active' }, to: { value: 'Disputed' }, eventName: 'dispute',
      guard: { or: [{ '===': [{ var: 'event.agent' }, { var: 'state.proposer' }] }, { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] }] },
      effect: { merge: [{ var: 'state' }, { status: 'Disputed', disputedAt: { var: '$timestamp' }, disputeReason: { var: 'event.reason' }, disputedBy: { var: 'event.agent' } }] },
      dependencies: [],
    },
    {
      from: { value: 'Disputed' }, to: { value: 'Completed' }, eventName: 'resolve',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { status: 'Completed', resolvedAt: { var: '$timestamp' }, resolution: { var: 'event.resolution' } }] },
      dependencies: [],
    },
    {
      from: { value: 'Proposed' }, to: { value: 'Cancelled' }, eventName: 'cancel',
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
        status: 'Proposed',
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
