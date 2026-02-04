#!/usr/bin/env npx tsx
/**
 * OttoChain Multi-Agent Simulation
 * 
 * Uses OttoChain's fiber-based message types:
 * - CreateStateMachine: Create agent identities & contracts
 * - TransitionStateMachine: Vouch, accept, complete, dispute
 * 
 * State machine definitions follow the Agent Identity spec.
 */

import nacl from 'tweetnacl';
import { createHash, randomUUID } from 'crypto';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  ML0_URL: process.env.ML0_URL || 'http://localhost:9200',
  DL1_URL: process.env.DL1_URL || 'http://localhost:9400',
  INDEXER_URL: process.env.INDEXER_URL || 'http://localhost:3031',
  SNAPSHOT_WAIT_MS: 60000,
  NUM_AGENTS: 5,
};

// ============================================================================
// Agent Identity State Machine Definition
// ============================================================================

const AGENT_IDENTITY_DEFINITION = {
  states: ['Registered', 'Active', 'Withdrawn'],
  initialState: 'Registered',
  transitions: [
    {
      from: 'Registered',
      event: 'activate',
      to: 'Active',
      guards: [],
      effects: [{ op: 'merge', path: ['status'], value: 'Active' }],
    },
    {
      from: 'Active',
      event: 'receive_vouch',
      to: 'Active',
      guards: [],
      effects: [
        { op: 'apply', path: ['reputation'], expr: { '+': [{ var: 'reputation' }, 2] } },
        { op: 'push', path: ['vouches'], value: { var: 'event.from' } },
      ],
    },
    {
      from: 'Active',
      event: 'receive_completion',
      to: 'Active',
      guards: [],
      effects: [
        { op: 'apply', path: ['reputation'], expr: { '+': [{ var: 'reputation' }, 5] } },
      ],
    },
    {
      from: 'Active',
      event: 'receive_violation',
      to: 'Active',
      guards: [],
      effects: [
        { op: 'apply', path: ['reputation'], expr: { max: [0, { '-': [{ var: 'reputation' }, 10] }] } },
      ],
    },
    {
      from: 'Active',
      event: 'withdraw',
      to: 'Withdrawn',
      guards: [],
      effects: [{ op: 'merge', path: ['status'], value: 'Withdrawn' }],
    },
  ],
};

const CONTRACT_DEFINITION = {
  states: ['Proposed', 'Active', 'Completed', 'Disputed', 'Rejected'],
  initialState: 'Proposed',
  transitions: [
    {
      from: 'Proposed',
      event: 'accept',
      to: 'Active',
      guards: [{ '==': [{ var: 'event.agent' }, { var: 'counterparty' }] }],
      effects: [{ op: 'merge', path: ['acceptedAt'], value: { var: '$timestamp' } }],
    },
    {
      from: 'Proposed',
      event: 'reject',
      to: 'Rejected',
      guards: [{ '==': [{ var: 'event.agent' }, { var: 'counterparty' }] }],
      effects: [],
    },
    {
      from: 'Active',
      event: 'complete',
      to: 'Active', // Stays Active until both complete
      guards: [],
      effects: [
        { op: 'push', path: ['completions'], value: { var: 'event.agent' } },
      ],
    },
    {
      from: 'Active',
      event: 'finalize',
      to: 'Completed',
      guards: [{ '>=': [{ count: { var: 'completions' } }, 2] }],
      effects: [{ op: 'merge', path: ['completedAt'], value: { var: '$timestamp' } }],
    },
    {
      from: 'Active',
      event: 'dispute',
      to: 'Disputed',
      guards: [],
      effects: [
        { op: 'merge', path: ['disputedAt'], value: { var: '$timestamp' } },
        { op: 'merge', path: ['disputeReason'], value: { var: 'event.reason' } },
      ],
    },
  ],
};

// ============================================================================
// Agent Wallet
// ============================================================================

interface Agent {
  name: string;
  address: string;
  publicKey: string;
  secretKey: Uint8Array;
  fiberId?: string;  // UUID of their identity state machine
}

function createAgent(name: string): Agent {
  const keypair = nacl.sign.keyPair();
  const publicKey = Buffer.from(keypair.publicKey).toString('hex');
  const hash = createHash('sha256').update(keypair.publicKey).digest('hex');
  const address = `DAG${hash.slice(0, 40)}`;
  
  return { name, address, publicKey, secretKey: keypair.secretKey };
}

function signMessage(agent: Agent, message: unknown): string {
  const msgBytes = Buffer.from(JSON.stringify(message));
  const signature = nacl.sign.detached(msgBytes, agent.secretKey);
  return Buffer.from(signature).toString('hex');
}

// ============================================================================
// Metagraph Client
// ============================================================================

async function submitTransaction(message: unknown, signature: string): Promise<{ hash: string }> {
  const signedMessage = {
    value: message,
    proofs: [{ id: signature.slice(0, 128), signature }],
  };

  console.log(`    📤 Submitting: ${JSON.stringify(message).slice(0, 100)}...`);

  const response = await fetch(`${CONFIG.DL1_URL}/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signedMessage),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Transaction failed: ${response.status} ${error}`);
  }

  return response.json() as Promise<{ hash: string }>;
}

async function getCheckpoint(): Promise<{ ordinal: number; state: unknown }> {
  const response = await fetch(`${CONFIG.ML0_URL}/data-application/v1/checkpoint`);
  return response.json() as Promise<{ ordinal: number; state: unknown }>;
}

async function getStateMachine(fiberId: string): Promise<unknown> {
  const response = await fetch(`${CONFIG.ML0_URL}/data-application/v1/state-machines/${fiberId}`);
  if (!response.ok) return null;
  return response.json();
}

async function waitForSnapshot(minOrdinal: number): Promise<number> {
  console.log(`    ⏳ Waiting for snapshot > ${minOrdinal}...`);
  const start = Date.now();
  
  while (Date.now() - start < CONFIG.SNAPSHOT_WAIT_MS) {
    const checkpoint = await getCheckpoint();
    if (checkpoint.ordinal > minOrdinal) {
      console.log(`    ✓ Snapshot ${checkpoint.ordinal} confirmed (${((Date.now() - start) / 1000).toFixed(1)}s)`);
      return checkpoint.ordinal;
    }
    await sleep(3000);
  }
  
  throw new Error(`Snapshot timeout after ${CONFIG.SNAPSHOT_WAIT_MS}ms`);
}

// ============================================================================
// OttoChain Operations
// ============================================================================

async function createAgentIdentity(agent: Agent): Promise<string> {
  const fiberId = randomUUID();
  agent.fiberId = fiberId;

  const message = {
    CreateStateMachine: {
      fiberId,
      definition: AGENT_IDENTITY_DEFINITION,
      initialData: {
        address: agent.address,
        publicKey: agent.publicKey,
        displayName: agent.name,
        reputation: 10,
        vouches: [],
        status: 'Registered',
      },
    },
  };

  const signature = signMessage(agent, message);
  await submitTransaction(message, signature);
  return fiberId;
}

async function transitionAgent(agent: Agent, event: string, payload: unknown): Promise<void> {
  if (!agent.fiberId) throw new Error(`Agent ${agent.name} has no fiberId`);

  // Get current sequence number
  const state = await getStateMachine(agent.fiberId) as { sequenceNumber?: number } | null;
  const targetSeq = (state?.sequenceNumber ?? 0) + 1;

  const message = {
    TransitionStateMachine: {
      fiberId: agent.fiberId,
      eventName: event,
      payload,
      targetSequenceNumber: targetSeq,
    },
  };

  const signature = signMessage(agent, message);
  await submitTransaction(message, signature);
}

async function createContract(
  proposer: Agent,
  counterparty: Agent,
  terms: Record<string, unknown>
): Promise<string> {
  const fiberId = randomUUID();

  const message = {
    CreateStateMachine: {
      fiberId,
      definition: CONTRACT_DEFINITION,
      initialData: {
        proposer: proposer.address,
        counterparty: counterparty.address,
        terms,
        completions: [],
        status: 'Proposed',
      },
    },
  };

  const signature = signMessage(proposer, message);
  await submitTransaction(message, signature);
  return fiberId;
}

async function transitionContract(
  actor: Agent,
  contractId: string,
  event: string,
  payload: unknown
): Promise<void> {
  const state = await getStateMachine(contractId) as { sequenceNumber?: number } | null;
  const targetSeq = (state?.sequenceNumber ?? 0) + 1;

  const message = {
    TransitionStateMachine: {
      fiberId: contractId,
      eventName: event,
      payload: { agent: actor.address, ...payload as Record<string, unknown> },
      targetSequenceNumber: targetSeq,
    },
  };

  const signature = signMessage(actor, message);
  await submitTransaction(message, signature);
}

// ============================================================================
// Simulation
// ============================================================================

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface SimResult {
  scenario: string;
  success: boolean;
  message: string;
  duration: number;
}

const results: SimResult[] = [];

async function runScenario(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n📋 Scenario: ${name}`);
  console.log('─'.repeat(60));
  const start = Date.now();

  try {
    await fn();
    results.push({ scenario: name, success: true, message: 'OK', duration: Date.now() - start });
    console.log(`   ✅ Passed (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ scenario: name, success: false, message, duration: Date.now() - start });
    console.log(`   ❌ Failed: ${message}`);
  }
}

async function main() {
  console.log('═'.repeat(60));
  console.log('     OttoChain Multi-Agent Simulation');
  console.log('═'.repeat(60));
  console.log(`ML0: ${CONFIG.ML0_URL}`);
  console.log(`DL1: ${CONFIG.DL1_URL}`);
  console.log('');

  // Verify connectivity
  try {
    const checkpoint = await getCheckpoint();
    console.log(`Current ordinal: ${checkpoint.ordinal}`);
  } catch (err) {
    console.error('❌ Cannot connect to metagraph. Is it running?');
    process.exit(1);
  }

  // Create agents
  const agents = [
    createAgent('Alice'),
    createAgent('Bob'),
    createAgent('Charlie'),
    createAgent('Diana'),
    createAgent('Eve'),
  ].slice(0, CONFIG.NUM_AGENTS);

  console.log('\nAgents:');
  agents.forEach(a => console.log(`  ${a.name}: ${a.address.slice(0, 24)}...`));

  let ordinal = (await getCheckpoint()).ordinal;

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 1: Agent Registration
  // ──────────────────────────────────────────────────────────────────────────
  await runScenario('Agent Registration', async () => {
    for (const agent of agents) {
      const fiberId = await createAgentIdentity(agent);
      console.log(`    → ${agent.name} created identity: ${fiberId.slice(0, 8)}...`);
      await sleep(500);
    }
    ordinal = await waitForSnapshot(ordinal);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 2: Activate Agents
  // ──────────────────────────────────────────────────────────────────────────
  await runScenario('Agent Activation', async () => {
    for (const agent of agents) {
      await transitionAgent(agent, 'activate', {});
      console.log(`    → ${agent.name} activated`);
      await sleep(300);
    }
    ordinal = await waitForSnapshot(ordinal);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 3: Vouching Network
  // ──────────────────────────────────────────────────────────────────────────
  await runScenario('Vouching Network', async () => {
    const [alice, bob, charlie] = agents;

    // Alice vouches for Bob
    await transitionAgent(bob, 'receive_vouch', { from: alice.address });
    console.log(`    → ${alice.name} vouched for ${bob.name}`);

    // Bob vouches for Charlie
    await transitionAgent(charlie, 'receive_vouch', { from: bob.address });
    console.log(`    → ${bob.name} vouched for ${charlie.name}`);

    // Charlie vouches for Alice
    await transitionAgent(alice, 'receive_vouch', { from: charlie.address });
    console.log(`    → ${charlie.name} vouched for ${alice.name}`);

    ordinal = await waitForSnapshot(ordinal);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 4: Contract Lifecycle
  // ──────────────────────────────────────────────────────────────────────────
  await runScenario('Contract Lifecycle', async () => {
    const [alice, bob] = agents;

    // Alice proposes contract
    const contractId = await createContract(alice, bob, {
      type: 'ServiceAgreement',
      description: 'Build landing page',
      value: 100,
    });
    console.log(`    → Contract proposed: ${contractId.slice(0, 8)}...`);

    ordinal = await waitForSnapshot(ordinal);

    // Bob accepts
    await transitionContract(bob, contractId, 'accept', {});
    console.log(`    → ${bob.name} accepted`);

    ordinal = await waitForSnapshot(ordinal);

    // Both parties complete
    await transitionContract(bob, contractId, 'complete', { proof: 'Delivered' });
    console.log(`    → ${bob.name} completed`);

    await transitionContract(alice, contractId, 'complete', { proof: 'Verified' });
    console.log(`    → ${alice.name} completed`);

    // Finalize
    await transitionContract(alice, contractId, 'finalize', {});
    console.log(`    → Contract finalized`);

    // Both get completion reputation
    await transitionAgent(alice, 'receive_completion', {});
    await transitionAgent(bob, 'receive_completion', {});

    ordinal = await waitForSnapshot(ordinal);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 5: Disputed Contract
  // ──────────────────────────────────────────────────────────────────────────
  await runScenario('Disputed Contract', async () => {
    const [_, __, charlie, diana] = agents;

    const contractId = await createContract(charlie, diana, {
      type: 'DataDelivery',
      description: 'ML training dataset',
    });
    console.log(`    → Contract proposed: ${contractId.slice(0, 8)}...`);

    ordinal = await waitForSnapshot(ordinal);

    await transitionContract(diana, contractId, 'accept', {});
    console.log(`    → ${diana.name} accepted`);

    ordinal = await waitForSnapshot(ordinal);

    await transitionContract(charlie, contractId, 'dispute', {
      reason: 'Data quality below standards',
    });
    console.log(`    → ${charlie.name} disputed`);

    ordinal = await waitForSnapshot(ordinal);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 6: Violation Report
  // ──────────────────────────────────────────────────────────────────────────
  await runScenario('Violation Report', async () => {
    const eve = agents[4];
    
    await transitionAgent(eve, 'receive_violation', { 
      reason: 'Spam behavior' 
    });
    console.log(`    → Eve received violation (-10 rep)`);

    ordinal = await waitForSnapshot(ordinal);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Results
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('                  Results');
  console.log('═'.repeat(60) + '\n');

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  results.forEach(r => {
    const icon = r.success ? '✅' : '❌';
    const time = `${(r.duration / 1000).toFixed(1)}s`;
    console.log(`${icon} ${r.scenario.padEnd(30)} ${time.padStart(10)}`);
  });

  console.log(`\nTotal: ${passed} passed, ${failed} failed`);

  // Final state
  console.log('\n' + '─'.repeat(60));
  console.log('Final State:');
  const finalCheckpoint = await getCheckpoint();
  console.log(`  Ordinal: ${finalCheckpoint.ordinal}`);

  for (const agent of agents) {
    if (agent.fiberId) {
      const state = await getStateMachine(agent.fiberId) as { data?: { reputation?: number } } | null;
      const rep = state?.data?.reputation ?? '?';
      console.log(`  ${agent.name}: reputation=${rep}`);
    }
  }

  console.log('═'.repeat(60) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
