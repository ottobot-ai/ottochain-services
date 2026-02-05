#!/usr/bin/env npx tsx
/**
 * OttoChain Diverse Traffic Generator
 * Creates a mix of:
 * - Agent Identity (via Bridge)
 * - Contracts (via Bridge) 
 * - E2E Examples: Voting, TokenEscrow, SimpleOrder, ApprovalWorkflow (direct DL1)
 */

import { randomUUID } from 'crypto';

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3030';
const DL1_URL = process.env.DL1_URL || 'http://localhost:9400';
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '2000');

// ============================================================================
// E2E State Machine Definitions
// ============================================================================

const VOTING_DEFINITION = {
  states: {
    pending: { id: { value: 'pending' }, isFinal: false, metadata: null },
    voting: { id: { value: 'voting' }, isFinal: false, metadata: null },
    completed: { id: { value: 'completed' }, isFinal: true, metadata: null },
  },
  initialState: { value: 'pending' },
  transitions: [
    { from: { value: 'pending' }, to: { value: 'voting' }, eventName: 'startVoting', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { candidates: { var: 'event.candidates' } }] }, dependencies: [] },
    { from: { value: 'voting' }, to: { value: 'completed' }, eventName: 'endVoting', guard: { '==': [1, 1] }, effect: { var: 'state' }, dependencies: [] },
  ],
  metadata: { name: 'Voting', description: 'Community voting for proposals' },
};

const TOKEN_ESCROW_DEFINITION = {
  states: {
    pending: { id: { value: 'pending' }, isFinal: false, metadata: null },
    funded: { id: { value: 'funded' }, isFinal: false, metadata: null },
    released: { id: { value: 'released' }, isFinal: true, metadata: null },
    refunded: { id: { value: 'refunded' }, isFinal: true, metadata: null },
  },
  initialState: { value: 'pending' },
  transitions: [
    { from: { value: 'pending' }, to: { value: 'funded' }, eventName: 'fund', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { depositor: { var: 'event.depositor' }, amount: { var: 'event.amount' } }] }, dependencies: [] },
    { from: { value: 'funded' }, to: { value: 'released' }, eventName: 'release', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { beneficiary: { var: 'event.beneficiary' } }] }, dependencies: [] },
    { from: { value: 'funded' }, to: { value: 'refunded' }, eventName: 'refund', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, {}] }, dependencies: [] },
  ],
  metadata: { name: 'TokenEscrow', description: 'Secure token escrow for trades' },
};

const SIMPLE_ORDER_DEFINITION = {
  states: {
    pending: { id: { value: 'pending' }, isFinal: false, metadata: null },
    confirmed: { id: { value: 'confirmed' }, isFinal: false, metadata: null },
    shipped: { id: { value: 'shipped' }, isFinal: false, metadata: null },
    delivered: { id: { value: 'delivered' }, isFinal: true, metadata: null },
    cancelled: { id: { value: 'cancelled' }, isFinal: true, metadata: null },
  },
  initialState: { value: 'pending' },
  transitions: [
    { from: { value: 'pending' }, to: { value: 'confirmed' }, eventName: 'confirm', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { var: 'event' }] }, dependencies: [] },
    { from: { value: 'pending' }, to: { value: 'cancelled' }, eventName: 'cancel', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { cancelReason: { var: 'event.reason' } }] }, dependencies: [] },
    { from: { value: 'confirmed' }, to: { value: 'shipped' }, eventName: 'ship', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { trackingNumber: { var: 'event.trackingNumber' } }] }, dependencies: [] },
    { from: { value: 'shipped' }, to: { value: 'delivered' }, eventName: 'deliver', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { deliveredAt: { var: 'event.timestamp' } }] }, dependencies: [] },
  ],
  metadata: { name: 'SimpleOrder', description: 'Order fulfillment tracking' },
};

const APPROVAL_WORKFLOW_DEFINITION = {
  states: {
    draft: { id: { value: 'draft' }, isFinal: false, metadata: null },
    submitted: { id: { value: 'submitted' }, isFinal: false, metadata: null },
    approved: { id: { value: 'approved' }, isFinal: true, metadata: null },
    rejected: { id: { value: 'rejected' }, isFinal: true, metadata: null },
  },
  initialState: { value: 'draft' },
  transitions: [
    { from: { value: 'draft' }, to: { value: 'submitted' }, eventName: 'submit', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { submittedAt: { var: 'event.timestamp' } }] }, dependencies: [] },
    { from: { value: 'submitted' }, to: { value: 'approved' }, eventName: 'approve', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { approvedBy: { var: 'event.approver' } }] }, dependencies: [] },
    { from: { value: 'submitted' }, to: { value: 'rejected' }, eventName: 'reject', guard: { '==': [1, 1] }, effect: { merge: [{ var: 'state' }, { rejectedBy: { var: 'event.approver' }, reason: { var: 'event.reason' } }] }, dependencies: [] },
  ],
  metadata: { name: 'ApprovalWorkflow', description: 'Document approval process' },
};

// ============================================================================
// Data Templates
// ============================================================================

interface Wallet { address: string; publicKey: string; privateKey: string; }

const AGENT_NAMES = [
  'BlockchainBob', 'CryptoCarl', 'DeFiDana', 'EthenaEve', 'FintechFred',
  'GovernanceGina', 'HashHank', 'InvestorIvy', 'JupiterJack', 'KeeperKate',
  'LiquidityLeo', 'MinerMia', 'NodeNick', 'OracleOlivia', 'ProtocolPete',
  'QuantumQuinn', 'RelayerRita', 'StakerSam', 'TraderTom', 'ValidatorVera',
];

const VOTING_TOPICS = [
  { title: 'Treasury Allocation Q1', candidates: ['Increase staking rewards', 'Fund development grants', 'Community marketing'] },
  { title: 'Protocol Upgrade v2.0', candidates: ['Approve upgrade', 'Delay for audit', 'Reject proposal'] },
  { title: 'New Partnership Proposal', candidates: ['Accept terms', 'Negotiate', 'Decline'] },
  { title: 'Fee Structure Change', candidates: ['Lower fees 20%', 'Keep current', 'Tiered pricing'] },
  { title: 'Governance Model Update', candidates: ['Token-weighted', 'Quadratic voting', 'Delegate system'] },
];

const ORDER_ITEMS = [
  { item: 'NFT Artwork #4521', price: 2500 },
  { item: 'Premium API Access (1yr)', price: 1200 },
  { item: 'Hardware Wallet Bundle', price: 350 },
  { item: 'Conference VIP Pass', price: 800 },
  { item: 'Validator Node Setup', price: 5000 },
];

const ESCROW_SCENARIOS = [
  { purpose: 'Freelance development milestone', amount: 2500 },
  { purpose: 'OTC token trade', amount: 10000 },
  { purpose: 'NFT purchase escrow', amount: 1500 },
  { purpose: 'Service agreement deposit', amount: 3000 },
  { purpose: 'Bounty reward holding', amount: 750 },
];

const APPROVAL_DOCS = [
  { type: 'Budget Request', description: 'Q2 marketing budget allocation' },
  { type: 'Partnership Agreement', description: 'Integration with DeFi protocol' },
  { type: 'Technical Spec', description: 'New feature implementation plan' },
  { type: 'Audit Report', description: 'Security audit findings review' },
  { type: 'Grant Application', description: 'Ecosystem development grant' },
];

const CONTRACT_TASKS = [
  'Smart contract audit', 'Protocol integration', 'Security review',
  'Documentation update', 'Community management', 'Bug bounty triage',
  'Frontend development', 'API integration', 'Data analysis',
];

// ============================================================================
// Utilities
// ============================================================================

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const timestamp = () => new Date().toISOString().slice(11, 19);
const randomChoice = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const wallets: Wallet[] = [];
let actionCount = 0;
let running = true;

// ============================================================================
// API Functions
// ============================================================================

async function generateWallet(): Promise<Wallet> {
  const res = await fetch(`${BRIDGE_URL}/wallet/generate`, { method: 'POST' });
  if (!res.ok) throw new Error(`Wallet gen failed: ${res.status}`);
  return res.json();
}

async function submitToDL1(message: object, wallet: Wallet): Promise<string> {
  // Import SDK for signing (local path)
  const { batchSign } = await import('../../sdk/dist/cjs/index.js');
  
  const signedMessage = batchSign(message, [wallet.privateKey], { isDataUpdate: true });
  
  const res = await fetch(`${DL1_URL}/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signedMessage),
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DL1 submit failed: ${res.status} - ${text}`);
  }
  
  const data = await res.json();
  return data.hash || 'submitted';
}

async function registerAgentViaBridge(wallet: Wallet, name: string): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/agent/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: wallet.address,
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
      displayName: name,
    }),
  });
  if (!res.ok) throw new Error(`Register failed: ${res.status}`);
  const data = await res.json();
  return data.fiberId || data.hash;
}

async function proposeContractViaBridge(wallet: Wallet, counterpartyAddress: string, terms: object): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/contract/propose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      privateKey: wallet.privateKey,
      counterpartyAddress,
      terms,
    }),
  });
  if (!res.ok) throw new Error(`Propose failed: ${res.status}`);
  const data = await res.json();
  return data.contractId || data.hash;
}

// ============================================================================
// Traffic Actions
// ============================================================================

async function createAgent(): Promise<void> {
  const wallet = await generateWallet();
  const name = `${randomChoice(AGENT_NAMES)}_${Math.random().toString(36).slice(2, 5)}`;
  
  const fiberId = await registerAgentViaBridge(wallet, name);
  wallets.push(wallet);
  console.log(`[${timestamp()}] 👤 AGENT: ${name} joined (${wallet.address.slice(0, 12)}...)`);
}

async function createContract(): Promise<void> {
  if (wallets.length < 2) {
    await createAgent();
    return;
  }
  
  const proposer = randomChoice(wallets);
  const counterparty = randomChoice(wallets.filter(w => w.address !== proposer.address));
  const task = randomChoice(CONTRACT_TASKS);
  const value = randomInt(200, 3000);
  
  await proposeContractViaBridge(proposer, counterparty.address, {
    task,
    value,
    deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  });
  console.log(`[${timestamp()}] 📋 CONTRACT: "${task}" ($${value})`);
}

async function createVoting(): Promise<void> {
  if (wallets.length === 0) {
    await createAgent();
    return;
  }
  
  const wallet = randomChoice(wallets);
  const topic = randomChoice(VOTING_TOPICS);
  const fiberId = randomUUID();
  
  const message = {
    CreateStateMachine: {
      fiberId,
      definition: VOTING_DEFINITION,
      initialStateData: {
        schema: 'Voting',
        title: topic.title,
        candidates: topic.candidates,
        votes: {},
        createdAt: new Date().toISOString(),
        creator: wallet.address,
      },
    },
  };
  
  await submitToDL1(message, wallet);
  console.log(`[${timestamp()}] 🗳️  VOTING: "${topic.title}" (${topic.candidates.length} options)`);
}

async function createEscrow(): Promise<void> {
  if (wallets.length < 2) {
    await createAgent();
    return;
  }
  
  const depositor = randomChoice(wallets);
  const beneficiary = randomChoice(wallets.filter(w => w.address !== depositor.address));
  const scenario = randomChoice(ESCROW_SCENARIOS);
  const fiberId = randomUUID();
  
  const message = {
    CreateStateMachine: {
      fiberId,
      definition: TOKEN_ESCROW_DEFINITION,
      initialStateData: {
        schema: 'TokenEscrow',
        purpose: scenario.purpose,
        expectedAmount: scenario.amount,
        depositor: depositor.address,
        beneficiary: beneficiary.address,
        createdAt: new Date().toISOString(),
      },
    },
  };
  
  await submitToDL1(message, depositor);
  console.log(`[${timestamp()}] 🔐 ESCROW: "${scenario.purpose}" ($${scenario.amount})`);
}

async function createOrder(): Promise<void> {
  if (wallets.length < 2) {
    await createAgent();
    return;
  }
  
  const buyer = randomChoice(wallets);
  const seller = randomChoice(wallets.filter(w => w.address !== buyer.address));
  const order = randomChoice(ORDER_ITEMS);
  const fiberId = randomUUID();
  
  const message = {
    CreateStateMachine: {
      fiberId,
      definition: SIMPLE_ORDER_DEFINITION,
      initialStateData: {
        schema: 'SimpleOrder',
        item: order.item,
        price: order.price,
        buyer: buyer.address,
        seller: seller.address,
        orderedAt: new Date().toISOString(),
      },
    },
  };
  
  await submitToDL1(message, buyer);
  console.log(`[${timestamp()}] 📦 ORDER: "${order.item}" ($${order.price})`);
}

async function createApproval(): Promise<void> {
  if (wallets.length === 0) {
    await createAgent();
    return;
  }
  
  const wallet = randomChoice(wallets);
  const doc = randomChoice(APPROVAL_DOCS);
  const fiberId = randomUUID();
  
  const message = {
    CreateStateMachine: {
      fiberId,
      definition: APPROVAL_WORKFLOW_DEFINITION,
      initialStateData: {
        schema: 'ApprovalWorkflow',
        documentType: doc.type,
        description: doc.description,
        author: wallet.address,
        createdAt: new Date().toISOString(),
      },
    },
  };
  
  await submitToDL1(message, wallet);
  console.log(`[${timestamp()}] ✅ APPROVAL: ${doc.type} - "${doc.description.slice(0, 30)}..."`);
}

async function doAction(): Promise<void> {
  actionCount++;
  const roll = Math.random();
  
  try {
    // Weight different action types
    if (wallets.length < 5 || roll < 0.15) {
      await createAgent();
    } else if (roll < 0.30) {
      await createContract();
    } else if (roll < 0.45) {
      await createVoting();
    } else if (roll < 0.60) {
      await createEscrow();
    } else if (roll < 0.75) {
      await createOrder();
    } else if (roll < 0.90) {
      await createApproval();
    } else {
      await createAgent();
    }
  } catch (err) {
    console.log(`[${timestamp()}] ❌ ${err instanceof Error ? err.message : err}`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║      🦦 OttoChain Diverse Traffic Generator                  ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Workflow Types:                                             ║');
  console.log('║    👤 Agent Identity    📋 Contracts                         ║');
  console.log('║    🗳️  Voting           🔐 Token Escrow                      ║');
  console.log('║    📦 Orders            ✅ Approvals                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`   Bridge: ${BRIDGE_URL}`);
  console.log(`   DL1:    ${DL1_URL}`);
  console.log(`   Interval: ${INTERVAL_MS}ms`);
  console.log('');
  console.log('   Press Ctrl+C to stop');
  console.log('');
  console.log('═'.repeat(66));
  console.log('');

  process.on('SIGINT', () => {
    console.log('\n');
    console.log('═'.repeat(66));
    console.log('');
    console.log('📊 Final Statistics:');
    console.log(`   Total Actions: ${actionCount}`);
    console.log(`   Wallets: ${wallets.length}`);
    console.log('');
    console.log('👋 Shutting down...');
    running = false;
    process.exit(0);
  });

  while (running) {
    await doAction();
    await sleep(INTERVAL_MS);
  }
}

main().catch(console.error);
