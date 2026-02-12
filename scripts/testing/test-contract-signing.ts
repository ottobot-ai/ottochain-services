#!/usr/bin/env npx tsx
/**
 * Test contract signing with actual contract definition
 */
import { batchSign, generateKeyPair, HttpClient } from '@ottochain/sdk';
import { randomUUID } from 'crypto';

const DL1_URL = 'http://localhost:9400';

// Full contract definition from bridge
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
      from: { value: 'PROPOSED' },
      to: { value: 'ACTIVE' },
      eventName: 'accept',
      guard: { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] },
      effect: { merge: [{ var: 'state' }, { status: 'ACTIVE', acceptedAt: { var: '$timestamp' } }] },
      dependencies: [],
    },
    {
      from: { value: 'PROPOSED' },
      to: { value: 'REJECTED' },
      eventName: 'reject',
      guard: { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] },
      effect: { merge: [{ var: 'state' }, { status: 'REJECTED', rejectedAt: { var: '$timestamp' }, rejectReason: { var: 'event.reason' } }] },
      dependencies: [],
    },
    {
      from: { value: 'PROPOSED' },
      to: { value: 'Cancelled' },
      eventName: 'cancel',
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
  const message = {
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
  };

  console.log('\nSigning message...');
  const signed = await batchSign(message, [keyPair.privateKey], { isDataUpdate: true });
  console.log('Signed payload:', JSON.stringify(signed).substring(0, 400) + '...');

  console.log('\nSubmitting to DL1...');
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
