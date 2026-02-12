#!/usr/bin/env npx ts-node
/**
 * Continuous 10 TPS traffic generator
 * Runs until killed - creates agents and contracts
 */

import { dag4 } from '@stardust-collective/dag4';

const ML0_URL = process.env.ML0_URL || 'http://5.78.90.207:9200';
const TPS = 10;
const INTERVAL_MS = 1000 / TPS; // 100ms between transactions

// Greek letters + tech names for variety
const NAMES = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
  'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho',
  'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega',
  'Nexus', 'Pulse', 'Flux', 'Vortex', 'Drift', 'Edge', 'Forge', 'Glyph',
  'Helix', 'Index', 'Jet', 'Karma', 'Lumen', 'Matrix', 'Nova', 'Orbit',
];

const TASKS = [
  'API development', 'Smart contract audit', 'Frontend build', 'Backend refactor',
  'Security review', 'Performance tuning', 'Documentation', 'Testing suite',
  'DevOps setup', 'Data pipeline', 'ML model training', 'Analytics dashboard',
  'Mobile app', 'Protocol integration', 'Blockchain integration',
];

interface Wallet {
  privateKey: string;
  address: string;
}

// Stats
let txCount = 0;
let successCount = 0;
let errorCount = 0;
let startTime = Date.now();

// Pool of wallets for reuse
const walletPool: Wallet[] = [];
const registeredAgents: { wallet: Wallet; fiberId: string }[] = [];

function randomId(len = 4): string {
  return Math.random().toString(36).slice(2, 2 + len);
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function generateWallet(): Promise<Wallet> {
  const pk = dag4.keyStore.generatePrivateKey();
  const address = await dag4.keyStore.getDagAddressFromPrivateKey(pk);
  return { privateKey: pk, address };
}

async function signMessage(message: object, privateKey: string): Promise<object> {
  const encoded = Buffer.from(JSON.stringify(message)).toString('base64');
  const signature = await dag4.keyStore.sign(privateKey, encoded);
  const publicKey = await dag4.keyStore.getPublicKeyFromPrivateKey(privateKey);
  
  return {
    value: message,
    proofs: [{
      id: publicKey.slice(0, 32) + publicKey.slice(-32),
      signature,
    }],
  };
}

async function submitToML0(signedData: object): Promise<{ hash: string }> {
  const response = await fetch(`${ML0_URL}/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signedData),
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ML0 error ${response.status}: ${text}`);
  }
  
  return response.json();
}

// Agent Identity state machine definition
const AGENT_DEFINITION = {
  states: {
    Registered: { id: { value: 'REGISTERED' }, isFinal: false, metadata: null },
    Active: { id: { value: 'ACTIVE' }, isFinal: false, metadata: null },
    Withdrawn: { id: { value: 'WITHDRAWN' }, isFinal: true, metadata: null },
  },
  initialState: { value: 'REGISTERED' },
  transitions: [
    { from: { value: 'REGISTERED' }, to: { value: 'ACTIVE' }, eventName: 'activate',
      guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'ACTIVE' }] }, dependencies: [] },
    { from: { value: 'ACTIVE' }, to: { value: 'ACTIVE' }, eventName: 'receive_vouch',
      guard: { '!!': [{ var: 'event.from' }] }, 
      effect: { merge: [{ var: 'state' }, { reputation: { '+': [{ var: 'state.reputation' }, 2] } }] }, dependencies: [] },
    { from: { value: 'ACTIVE' }, to: { value: 'ACTIVE' }, eventName: 'receive_completion',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { reputation: { '+': [{ var: 'state.reputation' }, 5] } }] }, dependencies: [] },
    { from: { value: 'ACTIVE' }, to: { value: 'WITHDRAWN' }, eventName: 'withdraw',
      guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { status: 'WITHDRAWN' }] }, dependencies: [] },
  ],
  metadata: { description: 'Decentralized agent identity with reputation tracking', name: 'AgentIdentity' },
};

// Contract state machine definition  
const CONTRACT_DEFINITION = {
  states: {
    Proposed: { id: { value: 'PROPOSED' }, isFinal: false, metadata: null },
    Active: { id: { value: 'ACTIVE' }, isFinal: false, metadata: null },
    Completed: { id: { value: 'COMPLETED' }, isFinal: true, metadata: null },
    Cancelled: { id: { value: 'Cancelled' }, isFinal: true, metadata: null },
    Rejected: { id: { value: 'REJECTED' }, isFinal: true, metadata: null },
    Disputed: { id: { value: 'DISPUTED' }, isFinal: false, metadata: null },
  },
  initialState: { value: 'PROPOSED' },
  transitions: [
    { from: { value: 'PROPOSED' }, to: { value: 'ACTIVE' }, eventName: 'accept',
      guard: { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] },
      effect: { merge: [{ var: 'state' }, { acceptedAt: { var: '$timestamp' }, status: 'ACTIVE' }] }, dependencies: [] },
    { from: { value: 'PROPOSED' }, to: { value: 'REJECTED' }, eventName: 'reject',
      guard: { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] },
      effect: { merge: [{ var: 'state' }, { rejectedAt: { var: '$timestamp' }, rejectReason: { var: 'event.reason' }, status: 'REJECTED' }] }, dependencies: [] },
    { from: { value: 'ACTIVE' }, to: { value: 'ACTIVE' }, eventName: 'submit_completion',
      guard: { or: [{ '===': [{ var: 'event.agent' }, { var: 'state.proposer' }] }, { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] }] },
      effect: { merge: [{ var: 'state' }, { completions: { cat: [{ var: 'state.completions' }, [{ agent: { var: 'event.agent' }, proof: { var: 'event.proof' }, submittedAt: { var: '$timestamp' } }]] } }] }, dependencies: [] },
    { from: { value: 'ACTIVE' }, to: { value: 'COMPLETED' }, eventName: 'finalize',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { completedAt: { var: '$timestamp' }, status: 'COMPLETED' }] }, dependencies: [] },
    { from: { value: 'ACTIVE' }, to: { value: 'DISPUTED' }, eventName: 'dispute',
      guard: { or: [{ '===': [{ var: 'event.agent' }, { var: 'state.proposer' }] }, { '===': [{ var: 'event.agent' }, { var: 'state.counterparty' }] }] },
      effect: { merge: [{ var: 'state' }, { disputedAt: { var: '$timestamp' }, disputedBy: { var: 'event.agent' }, disputeReason: { var: 'event.reason' }, status: 'DISPUTED' }] }, dependencies: [] },
    { from: { value: 'DISPUTED' }, to: { value: 'COMPLETED' }, eventName: 'resolve',
      guard: { '==': [1, 1] },
      effect: { merge: [{ var: 'state' }, { resolvedAt: { var: '$timestamp' }, resolution: { var: 'event.resolution' }, status: 'COMPLETED' }] }, dependencies: [] },
    { from: { value: 'PROPOSED' }, to: { value: 'Cancelled' }, eventName: 'cancel',
      guard: { '===': [{ var: 'event.agent' }, { var: 'state.proposer' }] },
      effect: { merge: [{ var: 'state' }, { cancelledAt: { var: '$timestamp' }, status: 'Cancelled' }] }, dependencies: [] },
  ],
  metadata: { description: 'Agreement between two agents with completion attestation', name: 'Contract', version: '1.0.0' },
};

async function createAgent(): Promise<void> {
  const wallet = await generateWallet();
  const fiberId = crypto.randomUUID();
  const displayName = `${randomChoice(NAMES)}_${randomId()}`;
  
  const message = {
    CreateStateMachine: {
      fiberId,
      definition: AGENT_DEFINITION,
      initialState: {
        schema: 'AgentIdentity',
        owner: wallet.address,
        displayName,
        reputation: 10,
        completedContracts: 0,
        violations: 0,
        vouches: [],
        platform: null,
        platformUserId: null,
        status: 'REGISTERED',
        createdAt: new Date().toISOString(),
      },
      sequence: 0,
    },
  };
  
  const signed = await signMessage(message, wallet.privateKey);
  await submitToML0(signed);
  
  walletPool.push(wallet);
  registeredAgents.push({ wallet, fiberId });
  successCount++;
}

async function createContract(): Promise<void> {
  // Need at least 2 agents
  if (walletPool.length < 2) {
    await createAgent();
    return;
  }
  
  const proposerIdx = Math.floor(Math.random() * walletPool.length);
  let counterpartyIdx = Math.floor(Math.random() * walletPool.length);
  while (counterpartyIdx === proposerIdx) {
    counterpartyIdx = Math.floor(Math.random() * walletPool.length);
  }
  
  const proposer = walletPool[proposerIdx];
  const counterparty = walletPool[counterpartyIdx];
  const fiberId = crypto.randomUUID();
  
  const message = {
    CreateStateMachine: {
      fiberId,
      definition: CONTRACT_DEFINITION,
      initialState: {
        schema: 'Contract',
        title: 'Untitled Contract',
        description: '',
        proposer: proposer.address,
        counterparty: counterparty.address,
        terms: {
          task: randomChoice(TASKS),
          value: Math.floor(Math.random() * 5000) + 100,
          deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        },
        status: 'PROPOSED',
        proposedAt: new Date().toISOString(),
        completions: [],
      },
      sequence: 0,
    },
  };
  
  const signed = await signMessage(message, proposer.privateKey);
  await submitToML0(signed);
  successCount++;
}

async function activateAgent(): Promise<void> {
  // Find a registered agent to activate
  const registered = registeredAgents.filter(a => a.fiberId);
  if (registered.length === 0) {
    await createAgent();
    return;
  }
  
  const agent = registered[Math.floor(Math.random() * registered.length)];
  
  const message = {
    TransitionStateMachine: {
      fiberId: agent.fiberId,
      eventName: 'activate',
      payload: {},
      targetSequenceNumber: 0,
    },
  };
  
  const signed = await signMessage(message, agent.wallet.privateKey);
  await submitToML0(signed);
  successCount++;
}

async function sendTransaction(): Promise<void> {
  txCount++;
  
  // Weight: 50% agents, 40% contracts, 10% activations
  const roll = Math.random();
  
  try {
    if (roll < 0.5) {
      await createAgent();
    } else if (roll < 0.9) {
      await createContract();
    } else {
      await activateAgent();
    }
  } catch (err) {
    errorCount++;
    // Silent - don't spam logs
  }
}

function printStats(): void {
  const elapsed = (Date.now() - startTime) / 1000;
  const actualTps = txCount / elapsed;
  const successRate = txCount > 0 ? ((successCount / txCount) * 100).toFixed(1) : '0';
  
  process.stdout.write(`\r⚡ TPS: ${actualTps.toFixed(1)} | TX: ${txCount} | ✅ ${successCount} | ❌ ${errorCount} | Rate: ${successRate}% | Agents: ${walletPool.length} | Elapsed: ${elapsed.toFixed(0)}s`);
}

async function main(): Promise<void> {
  console.log(`🚀 Starting continuous traffic at ${TPS} TPS`);
  console.log(`📡 Target: ${ML0_URL}`);
  console.log(`⏹️  Press Ctrl+C to stop\n`);
  
  // Stats display every second
  const statsInterval = setInterval(printStats, 1000);
  
  // Transaction loop
  const txLoop = async () => {
    while (true) {
      const start = Date.now();
      await sendTransaction();
      const elapsed = Date.now() - start;
      const sleep = Math.max(0, INTERVAL_MS - elapsed);
      if (sleep > 0) {
        await new Promise(r => setTimeout(r, sleep));
      }
    }
  };
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(statsInterval);
    console.log('\n\n📊 Final Stats:');
    printStats();
    console.log('\n');
    process.exit(0);
  });
  
  await txLoop();
}

main().catch(console.error);
