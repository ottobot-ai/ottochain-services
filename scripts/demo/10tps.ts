#!/usr/bin/env npx tsx
/**
 * Continuous 10 TPS traffic generator
 * Runs until killed - creates agents and contracts via Bridge
 */

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://5.78.121.248:3030';
const TPS = parseInt(process.env.TPS || '10');
const INTERVAL_MS = 1000 / TPS;

const NAMES = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
  'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho',
  'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega',
  'Nexus', 'Pulse', 'Flux', 'Vortex', 'Drift', 'Edge', 'Forge', 'Glyph',
];

const TASKS = [
  'API development', 'Smart contract audit', 'Frontend build', 'Backend refactor',
  'Security review', 'Performance tuning', 'Documentation', 'Testing suite',
  'DevOps setup', 'Data pipeline', 'ML model training', 'Analytics dashboard',
];

interface Wallet {
  privateKey: string;
  publicKey: string;
  address: string;
}

interface Agent {
  wallet: Wallet;
  fiberId: string;
  status: 'REGISTERED' | 'ACTIVE';
}

interface Contract {
  fiberId: string;
  proposer: Agent;
  counterparty: Agent;
  status: 'PROPOSED' | 'ACTIVE' | 'COMPLETED';
}

// Stats
let txCount = 0;
let successCount = 0;
let errorCount = 0;
let startTime = Date.now();

// Pools
const agents: Agent[] = [];
const contracts: Contract[] = [];

function randomId(len = 4): string {
  return Math.random().toString(36).slice(2, 2 + len);
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function generateWallet(): Promise<Wallet> {
  const resp = await fetch(`${BRIDGE_URL}/wallet/generate`, { method: 'POST' });
  if (!resp.ok) throw new Error(`Wallet gen failed: ${resp.status}`);
  return resp.json();
}

async function registerAgent(): Promise<void> {
  const wallet = await generateWallet();
  const displayName = `${randomChoice(NAMES)}_${randomId()}`;
  
  const resp = await fetch(`${BRIDGE_URL}/agent/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      privateKey: wallet.privateKey,
      publicKey: wallet.publicKey,
      address: wallet.address,
      displayName,
    }),
  });
  
  if (!resp.ok) throw new Error(`Register failed: ${resp.status}`);
  const data = await resp.json();
  
  agents.push({
    wallet,
    fiberId: data.fiberId || data.hash,
    status: 'REGISTERED',
  });
  
  successCount++;
}

async function activateAgent(): Promise<void> {
  const registered = agents.filter(a => a.status === 'REGISTERED');
  if (registered.length === 0) {
    await registerAgent();
    return;
  }
  
  const agent = randomChoice(registered);
  
  const resp = await fetch(`${BRIDGE_URL}/agent/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      privateKey: agent.wallet.privateKey,
      fiberId: agent.fiberId,
    }),
  });
  
  if (!resp.ok) throw new Error(`Activate failed: ${resp.status}`);
  agent.status = 'ACTIVE';
  successCount++;
}

async function proposeContract(): Promise<void> {
  if (agents.length < 2) {
    await registerAgent();
    return;
  }
  
  const proposer = randomChoice(agents);
  let counterparty = randomChoice(agents);
  while (counterparty === proposer) {
    counterparty = randomChoice(agents);
  }
  
  const resp = await fetch(`${BRIDGE_URL}/contract/propose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      privateKey: proposer.wallet.privateKey,
      counterpartyAddress: counterparty.wallet.address,
      title: `Contract ${randomId()}`,
      description: randomChoice(TASKS),
      terms: {
        task: randomChoice(TASKS),
        value: Math.floor(Math.random() * 5000) + 100,
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      },
    }),
  });
  
  if (!resp.ok) throw new Error(`Propose failed: ${resp.status}`);
  const data = await resp.json();
  
  contracts.push({
    fiberId: data.fiberId || data.hash,
    proposer,
    counterparty,
    status: 'PROPOSED',
  });
  
  successCount++;
}

async function acceptContract(): Promise<void> {
  const proposed = contracts.filter(c => c.status === 'PROPOSED');
  if (proposed.length === 0) {
    await proposeContract();
    return;
  }
  
  const contract = randomChoice(proposed);
  
  const resp = await fetch(`${BRIDGE_URL}/contract/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      privateKey: contract.counterparty.wallet.privateKey,
      fiberId: contract.fiberId,
    }),
  });
  
  if (!resp.ok) throw new Error(`Accept failed: ${resp.status}`);
  contract.status = 'ACTIVE';
  successCount++;
}

async function completeContract(): Promise<void> {
  const active = contracts.filter(c => c.status === 'ACTIVE');
  if (active.length === 0) {
    await acceptContract();
    return;
  }
  
  const contract = randomChoice(active);
  const actor = Math.random() < 0.5 ? contract.proposer : contract.counterparty;
  
  const resp = await fetch(`${BRIDGE_URL}/contract/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      privateKey: actor.wallet.privateKey,
      fiberId: contract.fiberId,
      proof: `Completed by ${actor.wallet.address.slice(0, 12)}...`,
    }),
  });
  
  if (!resp.ok) throw new Error(`Complete failed: ${resp.status}`);
  contract.status = 'COMPLETED';
  successCount++;
}

async function sendTransaction(): Promise<void> {
  txCount++;
  
  // Weight distribution: 40% register, 25% propose, 15% activate, 15% accept, 5% complete
  const roll = Math.random();
  
  try {
    if (roll < 0.40) {
      await registerAgent();
    } else if (roll < 0.65) {
      await proposeContract();
    } else if (roll < 0.80) {
      await activateAgent();
    } else if (roll < 0.95) {
      await acceptContract();
    } else {
      await completeContract();
    }
  } catch (err) {
    errorCount++;
    // Silent errors to avoid log spam
  }
}

function printStats(): void {
  const elapsed = (Date.now() - startTime) / 1000;
  const actualTps = successCount / elapsed;
  const successRate = txCount > 0 ? ((successCount / txCount) * 100).toFixed(1) : '0';
  const proposedCount = contracts.filter(c => c.status === 'PROPOSED').length;
  const activeCount = contracts.filter(c => c.status === 'ACTIVE').length;
  const completedCount = contracts.filter(c => c.status === 'COMPLETED').length;
  
  process.stdout.write(
    `\r⚡ TPS: ${actualTps.toFixed(1)} | Sent: ${txCount} | ✅ ${successCount} | ❌ ${errorCount} | ` +
    `Agents: ${agents.length} | Contracts: ${proposedCount}P/${activeCount}A/${completedCount}C | ` +
    `${elapsed.toFixed(0)}s   `
  );
}

async function main(): Promise<void> {
  console.log(`🚀 Starting continuous traffic at ${TPS} TPS`);
  console.log(`📡 Bridge: ${BRIDGE_URL}`);
  console.log(`⏹️  Press Ctrl+C to stop\n`);
  
  // Stats display every second
  const statsInterval = setInterval(printStats, 1000);
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(statsInterval);
    console.log('\n\n📊 Final Stats:');
    printStats();
    console.log('\n');
    process.exit(0);
  });
  
  // Transaction loop with concurrency for 10 TPS
  const promises: Promise<void>[] = [];
  
  while (true) {
    const start = Date.now();
    promises.push(sendTransaction());
    
    // Keep only last 20 pending to avoid memory issues
    if (promises.length > 20) {
      await Promise.race(promises);
      promises.length = 0;
    }
    
    const elapsed = Date.now() - start;
    const sleep = Math.max(0, INTERVAL_MS - elapsed);
    if (sleep > 0) {
      await new Promise(r => setTimeout(r, sleep));
    }
  }
}

main().catch(console.error);
