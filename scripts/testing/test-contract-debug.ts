#!/usr/bin/env npx tsx
import { generateKeyPair } from '@ottochain/sdk';
import { randomUUID } from 'crypto';
import { submitWithRetry } from './lib/submit-with-retry.js';

async function testDef(name: string, transitions: object[]) {
  const keyPair = generateKeyPair();
  const fiberId = randomUUID();
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

  try {
    const result = await submitWithRetry({
      message: { CreateStateMachine: { fiberId, definition, initialData: { completions: [] }, parentFiberId: null } },
      privateKeys: [keyPair.privateKey],
      fiberId,
      waitForML0: true,
    });
    console.log(`✅ ${name} (attempt ${result.attempt}, ML0: ${result.ml0Confirmed})`);
  } catch {
    console.log(`❌ ${name}`);
  }
}

async function main() {
  await testDef('With count guard', [
    { from: { value: 'ACTIVE' }, to: { value: 'COMPLETED' }, eventName: 'finalize',
      guard: { '>=': [{ count: { var: 'state.completions' } }, 2] },
      effect: { merge: [{ var: 'state' }, { status: 'COMPLETED' }] }, dependencies: [] },
  ]);

  await testDef('Without count (length)', [
    { from: { value: 'ACTIVE' }, to: { value: 'COMPLETED' }, eventName: 'finalize',
      guard: { '>=': [{ var: 'state.completionsCount' }, 2] },
      effect: { merge: [{ var: 'state' }, { status: 'COMPLETED' }] }, dependencies: [] },
  ]);

  await testDef('Simple guard', [
    { from: { value: 'ACTIVE' }, to: { value: 'COMPLETED' }, eventName: 'finalize',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { status: 'COMPLETED' }] }, dependencies: [] },
  ]);
}

main();
