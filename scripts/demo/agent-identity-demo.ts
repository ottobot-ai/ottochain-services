#!/usr/bin/env npx tsx
/**
 * Agent Identity Demo - Creates real Agent Identity fibers on OttoChain
 * Uses @ottochain/sdk for proper transaction signing
 */

import { randomUUID } from 'crypto';
import { generateKeyPair, batchSign, type KeyPair } from '@ottochain/sdk';

const CONFIG = {
  DL1_URLS: [
    'http://localhost:9400',
    'http://localhost:9410',
    'http://localhost:9420',
  ],
  ML0_URL: 'http://localhost:9200',
};

// Agent Identity state machine definition
const AGENT_IDENTITY_DEFINITION = {
  states: {
    registered: { id: { value: 'registered' }, isFinal: false, metadata: null },
    active: { id: { value: 'active' }, isFinal: false, metadata: null },
    suspended: { id: { value: 'suspended' }, isFinal: false, metadata: null },
    withdrawn: { id: { value: 'withdrawn' }, isFinal: true, metadata: null },
  },
  initialState: { value: 'registered' },
  transitions: [
    {
      from: { value: 'registered' },
      event: 'activate',
      to: { value: 'active' },
      guards: [],
      effects: [],
    },
    {
      from: { value: 'active' },
      event: 'receive_vouch',
      to: { value: 'active' },
      guards: [],
      effects: [],
    },
    {
      from: { value: 'active' },
      event: 'receive_completion',
      to: { value: 'active' },
      guards: [],
      effects: [],
    },
    {
      from: { value: 'active' },
      event: 'receive_behavioral',
      to: { value: 'active' },
      guards: [],
      effects: [],
    },
    {
      from: { value: 'active' },
      event: 'receive_violation',
      to: { value: 'active' },
      guards: [],
      effects: [],
    },
    {
      from: { value: 'active' },
      event: 'withdraw',
      to: { value: 'withdrawn' },
      guards: [],
      effects: [],
    },
  ],
};

// Contract state machine definition
const CONTRACT_DEFINITION = {
  states: {
    proposed: { id: { value: 'proposed' }, isFinal: false, metadata: null },
    active: { id: { value: 'active' }, isFinal: false, metadata: null },
    completed: { id: { value: 'completed' }, isFinal: true, metadata: null },
    rejected: { id: { value: 'rejected' }, isFinal: true, metadata: null },
    disputed: { id: { value: 'disputed' }, isFinal: false, metadata: null },
  },
  initialState: { value: 'proposed' },
  transitions: [
    { from: { value: 'proposed' }, event: 'accept', to: { value: 'active' }, guards: [], effects: [] },
    { from: { value: 'proposed' }, event: 'reject', to: { value: 'rejected' }, guards: [], effects: [] },
    { from: { value: 'active' }, event: 'complete', to: { value: 'completed' }, guards: [], effects: [] },
    { from: { value: 'active' }, event: 'dispute', to: { value: 'disputed' }, guards: [], effects: [] },
  ],
};

interface Agent {
  name: string;
  wallet: KeyPair;
  fiberId?: string;
}

function createAgent(name: string): Agent {
  return { name, wallet: generateKeyPair() };
}

async function sendTransaction(message: unknown, wallets: KeyPair[]): Promise<void> {
  const privateKeys = wallets.map(w => w.privateKey);
  const signed = await batchSign(message, privateKeys, { isDataUpdate: true });

  const results = await Promise.allSettled(
    CONFIG.DL1_URLS.map(async (url) => {
      const response = await fetch(`${url}/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed),
      });
      if (!response.ok) {
        throw new Error(`${url}: ${response.status}`);
      }
      return response.json();
    })
  );

  const success = results.filter(r => r.status === 'fulfilled');
  if (success.length === 0) {
    const errors = results.map(r => r.status === 'rejected' ? r.reason.message : '').join(', ');
    throw new Error(`All requests failed: ${errors}`);
  }
}

async function waitForSnapshot(minOrdinal: number, maxWait = 60000): Promise<number> {
  const start = Date.now();
  process.stdout.write('    ⏳ Waiting for snapshot...');

  while (Date.now() - start < maxWait) {
    const res = await fetch(`${CONFIG.ML0_URL}/data-application/v1/checkpoint`);
    const data = await res.json() as { ordinal: number };
    if (data.ordinal > minOrdinal) {
      console.log(` ordinal ${data.ordinal} ✓`);
      return data.ordinal;
    }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Snapshot timeout');
}

async function getCurrentOrdinal(): Promise<number> {
  const res = await fetch(`${CONFIG.ML0_URL}/data-application/v1/checkpoint`);
  const data = await res.json() as { ordinal: number };
  return data.ordinal;
}

async function getStateMachine(fiberId: string): Promise<{ sequenceNumber: number } | null> {
  const res = await fetch(`${CONFIG.ML0_URL}/data-application/v1/state-machines/${fiberId}`);
  if (!res.ok) return null;
  return res.json() as Promise<{ sequenceNumber: number }>;
}

async function createAgentIdentity(agent: Agent): Promise<string> {
  const fiberId = randomUUID();
  agent.fiberId = fiberId;

  const message = {
    CreateStateMachine: {
      fiberId,
      definition: AGENT_IDENTITY_DEFINITION,
      initialData: {
        schema: 'AgentIdentity',  // ← Key field for indexer
        address: agent.wallet.address,
        displayName: agent.name,
        reputation: 10,
        vouches: [],
        attestations: [],
      },
      parentFiberId: null,
    },
  };

  await sendTransaction(message, [agent.wallet]);
  console.log(`    📝 Created ${agent.name}: ${fiberId.slice(0, 8)}...`);
  return fiberId;
}

async function activateAgent(agent: Agent): Promise<void> {
  if (!agent.fiberId) throw new Error('No fiberId');
  
  const state = await getStateMachine(agent.fiberId);
  const targetSeq = (state?.sequenceNumber ?? 0);

  const message = {
    TransitionStateMachine: {
      fiberId: agent.fiberId,
      eventName: 'activate',
      payload: {},
      targetSequenceNumber: targetSeq,
    },
  };

  await sendTransaction(message, [agent.wallet]);
  console.log(`    ✅ Activated ${agent.name}`);
}

async function createContract(proposer: Agent, counterparty: Agent, terms: string): Promise<string> {
  const fiberId = randomUUID();

  const message = {
    CreateStateMachine: {
      fiberId,
      definition: CONTRACT_DEFINITION,
      initialData: {
        schema: 'Contract',  // ← Key field for indexer
        proposer: proposer.wallet.address,
        counterparty: counterparty.wallet.address,
        terms,
        createdAt: new Date().toISOString(),
      },
      parentFiberId: null,
    },
  };

  await sendTransaction(message, [proposer.wallet]);
  console.log(`    📝 Contract: ${proposer.name} → ${counterparty.name} (${fiberId.slice(0, 8)}...)`);
  return fiberId;
}

async function transitionContract(
  contractId: string,
  actor: Agent,
  event: string
): Promise<void> {
  const state = await getStateMachine(contractId);
  const targetSeq = (state?.sequenceNumber ?? 0);

  const message = {
    TransitionStateMachine: {
      fiberId: contractId,
      eventName: event,
      payload: { actor: actor.wallet.address },
      targetSequenceNumber: targetSeq,
    },
  };

  await sendTransaction(message, [actor.wallet]);
  console.log(`    ➡️  ${event}: ${actor.name}`);
}

async function vouchFor(voucher: Agent, target: Agent): Promise<void> {
  if (!target.fiberId) throw new Error('Target has no fiberId');
  
  const state = await getStateMachine(target.fiberId);
  const targetSeq = (state?.sequenceNumber ?? 0);

  const message = {
    TransitionStateMachine: {
      fiberId: target.fiberId,
      eventName: 'receive_vouch',
      payload: { from: voucher.wallet.address },
      targetSequenceNumber: targetSeq,
    },
  };

  await sendTransaction(message, [voucher.wallet]);
  console.log(`    🤝 ${voucher.name} vouched for ${target.name}`);
}

async function main() {
  console.log('═'.repeat(60));
  console.log('        OttoChain Agent Identity Demo');
  console.log('═'.repeat(60));
  console.log(`ML0: ${CONFIG.ML0_URL}`);
  console.log(`DL1: ${CONFIG.DL1_URLS[0]}`);
  console.log('');

  // Verify connectivity
  let ordinal: number;
  try {
    ordinal = await getCurrentOrdinal();
    console.log(`Current ordinal: ${ordinal}\n`);
  } catch {
    console.error('❌ Cannot connect to metagraph');
    process.exit(1);
  }

  // Create agents
  const agents = [
    createAgent('Alice'),
    createAgent('Bob'),
    createAgent('Charlie'),
    createAgent('Diana'),
    createAgent('Eve'),
  ];

  console.log('Agents:');
  agents.forEach(a => console.log(`  ${a.name}: ${a.wallet.address.slice(0, 20)}...`));

  // ──────────────────────────────────────────────────────────────
  console.log('\n📌 Phase 1: Agent Registration');
  console.log('─'.repeat(50));
  
  for (const agent of agents) {
    await createAgentIdentity(agent);
    await new Promise(r => setTimeout(r, 500));
  }
  ordinal = await waitForSnapshot(ordinal);

  // ──────────────────────────────────────────────────────────────
  console.log('\n📌 Phase 2: Activation');
  console.log('─'.repeat(50));

  for (const agent of agents) {
    await activateAgent(agent);
    await new Promise(r => setTimeout(r, 300));
  }
  ordinal = await waitForSnapshot(ordinal);

  // ──────────────────────────────────────────────────────────────
  console.log('\n📌 Phase 3: Vouching Network');
  console.log('─'.repeat(50));

  await vouchFor(agents[0], agents[1]); // Alice vouches for Bob
  await vouchFor(agents[1], agents[2]); // Bob vouches for Charlie
  await vouchFor(agents[2], agents[0]); // Charlie vouches for Alice
  await vouchFor(agents[3], agents[4]); // Diana vouches for Eve
  ordinal = await waitForSnapshot(ordinal);

  // ──────────────────────────────────────────────────────────────
  console.log('\n📌 Phase 4: Contracts');
  console.log('─'.repeat(50));

  // Create and complete some contracts
  const contract1 = await createContract(agents[0], agents[1], 'Build landing page');
  await new Promise(r => setTimeout(r, 500));
  const contract2 = await createContract(agents[2], agents[3], 'Data analysis');
  ordinal = await waitForSnapshot(ordinal);

  // Accept contracts
  await transitionContract(contract1, agents[1], 'accept');
  await transitionContract(contract2, agents[3], 'accept');
  ordinal = await waitForSnapshot(ordinal);

  // Complete contracts
  await transitionContract(contract1, agents[0], 'complete');
  await transitionContract(contract2, agents[2], 'complete');
  ordinal = await waitForSnapshot(ordinal);

  // Create a rejected contract
  const contract3 = await createContract(agents[4], agents[0], 'Suspicious request');
  ordinal = await waitForSnapshot(ordinal);
  await transitionContract(contract3, agents[0], 'reject');
  ordinal = await waitForSnapshot(ordinal);

  // ──────────────────────────────────────────────────────────────
  console.log('\n═'.repeat(60));
  console.log('                    Complete!');
  console.log('═'.repeat(60));
  console.log(`\nFinal ordinal: ${ordinal}`);
  console.log(`Created: ${agents.length} agents, 3 contracts`);
  console.log('\nCheck the explorer to see the data!');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
