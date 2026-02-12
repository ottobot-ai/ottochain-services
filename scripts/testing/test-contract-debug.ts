#!/usr/bin/env npx tsx
import { batchSign, generateKeyPair, HttpClient } from '@ottochain/sdk';
import { randomUUID } from 'crypto';

const DL1_URL = 'http://localhost:9400';

async function testDef(name: string, transitions: object[]) {
  const keyPair = generateKeyPair();
  const definition = {
    states: {
      Proposed: { id: { value: 'PROPOSED' }, isFinal: false, metadata: null },
      Active: { id: { value: 'ACTIVE' }, isFinal: false, metadata: null },
      Completed: { id: { value: 'COMPLETED' }, isFinal: true, metadata: null },
    },
    initialState: { value: 'PROPOSED' },
    transitions,
    metadata: { name: 'Test' },
  };

  const signed = await batchSign(
    { CreateStateMachine: { fiberId: randomUUID(), definition, initialData: { completions: [] }, parentFiberId: null } },
    [keyPair.privateKey],
    { isDataUpdate: true }
  );

  try {
    await new HttpClient(DL1_URL).post('/data', signed);
    console.log(`✅ ${name}`);
  } catch {
    console.log(`❌ ${name}`);
  }
}

async function main() {
  // Test the 'count' operator
  await testDef('With count guard', [
    { from: { value: 'ACTIVE' }, to: { value: 'COMPLETED' }, eventName: 'finalize',
      guard: { '>=': [{ count: { var: 'state.completions' } }, 2] },
      effect: { merge: [{ var: 'state' }, { status: 'COMPLETED' }] }, dependencies: [] },
  ]);

  // Test without count
  await testDef('Without count (length)', [
    { from: { value: 'ACTIVE' }, to: { value: 'COMPLETED' }, eventName: 'finalize',
      guard: { '>=': [{ var: 'state.completionsCount' }, 2] },
      effect: { merge: [{ var: 'state' }, { status: 'COMPLETED' }] }, dependencies: [] },
  ]);

  // Test simple guard
  await testDef('Simple guard', [
    { from: { value: 'ACTIVE' }, to: { value: 'COMPLETED' }, eventName: 'finalize',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { status: 'COMPLETED' }] }, dependencies: [] },
  ]);
}

main();
