#!/usr/bin/env npx tsx
/**
 * Organic Traffic Generator - Realistic lifecycle simulation
 * 
 * Creates a living ecosystem where:
 * - Agents join, activate, and sometimes leave
 * - Contracts are proposed, negotiated, and completed (or rejected/cancelled)
 * - Activity ebbs and flows naturally
 * - Respects metagraph sync delays
 */

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://5.78.121.248:3030';
const ML0_URL = process.env.ML0_URL || 'http://5.78.90.207:9200';
const TARGET_TPS = parseFloat(process.env.TPS || '10');

// Sync delay before transitions can succeed
const SYNC_DELAY_MS = 45000;

// Lifecycle timing
const MIN_ACCEPT_DELAY_MS = SYNC_DELAY_MS + 5000;  // 50s after proposal
const MIN_COMPLETE_DELAY_MS = SYNC_DELAY_MS + 5000; // 50s after accept

interface Wallet {
  privateKey: string;
  publicKey: string;
  address: string;
}

interface Agent {
  wallet: Wallet;
  fiberId: string;
  name: string;
  status: 'Registered' | 'Active';
  createdAt: number;
  activatedAt?: number;
}

interface Contract {
  fiberId: string;
  proposer: Agent;
  counterparty: Agent;
  status: 'Proposed' | 'Active' | 'Completed' | 'Rejected' | 'Cancelled';
  proposedAt: number;
  acceptedAt?: number;
  completedAt?: number;
}

// State
const agents: Agent[] = [];
const contracts: Contract[] = [];
let running = true;

// Stats
const stats = {
  agentsRegistered: 0,
  agentsActivated: 0,
  contractsProposed: 0,
  contractsAccepted: 0,
  contractsCompleted: 0,
  contractsRejected: 0,
  errors: 0,
  startTime: Date.now(),
};

const NAMES = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
  'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho',
  'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega', 'Nexus', 
  'Pulse', 'Flux', 'Vortex', 'Drift', 'Edge', 'Forge', 'Nova', 'Cipher',
];

const TASKS = [
  'API development', 'Smart contract audit', 'Frontend build', 'Security review',
  'Performance tuning', 'Documentation', 'Testing suite', 'Data pipeline',
  'ML training', 'Analytics dashboard', 'Mobile app', 'Protocol integration',
];

function randomId(len = 4): string {
  return Math.random().toString(36).slice(2, 2 + len);
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

async function generateWallet(): Promise<Wallet> {
  const resp = await fetch(`${BRIDGE_URL}/wallet/generate`, { method: 'POST' });
  if (!resp.ok) throw new Error(`Wallet gen failed: ${resp.status}`);
  return resp.json();
}

// ============================================================================
// Agent Lifecycle
// ============================================================================

async function registerAgent(): Promise<boolean> {
  try {
    const wallet = await generateWallet();
    const name = `${randomChoice(NAMES)}_${randomId()}`;
    
    const resp = await fetch(`${BRIDGE_URL}/agent/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        privateKey: wallet.privateKey,
        publicKey: wallet.publicKey,
        address: wallet.address,
        displayName: name,
      }),
    });
    
    if (!resp.ok) throw new Error(`${resp.status}`);
    const data = await resp.json();
    
    agents.push({
      wallet,
      fiberId: data.fiberId || data.hash,
      name,
      status: 'Registered',
      createdAt: Date.now(),
    });
    
    stats.agentsRegistered++;
    console.log(`[${timestamp()}] 📝 ${name} joined the network`);
    return true;
  } catch (err) {
    stats.errors++;
    return false;
  }
}

async function activateAgent(agent: Agent): Promise<boolean> {
  try {
    const resp = await fetch(`${BRIDGE_URL}/agent/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        privateKey: agent.wallet.privateKey,
        fiberId: agent.fiberId,
      }),
    });
    
    if (!resp.ok) throw new Error(`${resp.status}`);
    
    agent.status = 'Active';
    agent.activatedAt = Date.now();
    stats.agentsActivated++;
    console.log(`[${timestamp()}] ✅ ${agent.name} activated`);
    return true;
  } catch (err) {
    stats.errors++;
    return false;
  }
}

// ============================================================================
// Contract Lifecycle
// ============================================================================

async function proposeContract(proposer: Agent, counterparty: Agent): Promise<boolean> {
  try {
    const task = randomChoice(TASKS);
    const value = Math.floor(Math.random() * 4000) + 500;
    
    const resp = await fetch(`${BRIDGE_URL}/contract/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        privateKey: proposer.wallet.privateKey,
        counterpartyAddress: counterparty.wallet.address,
        title: `${task} project`,
        description: `${proposer.name} proposes ${task} work for ${counterparty.name}`,
        terms: { task, value, deadline: '2026-03-01' },
      }),
    });
    
    if (!resp.ok) throw new Error(`${resp.status}`);
    const data = await resp.json();
    
    contracts.push({
      fiberId: data.fiberId || data.hash,
      proposer,
      counterparty,
      status: 'Proposed',
      proposedAt: Date.now(),
    });
    
    stats.contractsProposed++;
    console.log(`[${timestamp()}] 📋 ${proposer.name} → ${counterparty.name}: ${task} ($${value})`);
    return true;
  } catch (err) {
    stats.errors++;
    return false;
  }
}

async function acceptContract(contract: Contract): Promise<boolean> {
  try {
    const resp = await fetch(`${BRIDGE_URL}/contract/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        privateKey: contract.counterparty.wallet.privateKey,
        fiberId: contract.fiberId,
      }),
    });
    
    if (!resp.ok) throw new Error(`${resp.status}`);
    
    contract.status = 'Active';
    contract.acceptedAt = Date.now();
    stats.contractsAccepted++;
    console.log(`[${timestamp()}] 🤝 ${contract.counterparty.name} accepted contract from ${contract.proposer.name}`);
    return true;
  } catch (err) {
    stats.errors++;
    return false;
  }
}

async function completeContract(contract: Contract): Promise<boolean> {
  try {
    // Both parties submit completion
    const actor = Math.random() < 0.5 ? contract.proposer : contract.counterparty;
    
    const resp = await fetch(`${BRIDGE_URL}/contract/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        privateKey: actor.wallet.privateKey,
        fiberId: contract.fiberId,
        proof: `Work completed by ${actor.name}`,
      }),
    });
    
    if (!resp.ok) throw new Error(`${resp.status}`);
    
    contract.status = 'Completed';
    contract.completedAt = Date.now();
    stats.contractsCompleted++;
    console.log(`[${timestamp()}] 🎉 Contract completed: ${contract.proposer.name} ↔ ${contract.counterparty.name}`);
    return true;
  } catch (err) {
    stats.errors++;
    return false;
  }
}

// ============================================================================
// Organic Activity Loops
// ============================================================================

async function agentGrowthLoop(): Promise<void> {
  while (running) {
    // Register new agents at varying rates
    const targetAgents = Math.floor(Date.now() - stats.startTime) / 5000 + 10; // Grow over time
    
    if (agents.length < targetAgents) {
      await registerAgent();
    }
    
    // Small random delay (100-500ms)
    await new Promise(r => setTimeout(r, 100 + Math.random() * 400));
  }
}

async function activationLoop(): Promise<void> {
  while (running) {
    const now = Date.now();
    
    // Find agents ready to activate (registered for > SYNC_DELAY)
    const readyToActivate = agents.filter(a => 
      a.status === 'Registered' && 
      (now - a.createdAt) > SYNC_DELAY_MS
    );
    
    if (readyToActivate.length > 0) {
      const agent = randomChoice(readyToActivate);
      await activateAgent(agent);
    }
    
    await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
  }
}

async function contractProposalLoop(): Promise<void> {
  while (running) {
    // Need at least 2 active agents
    const activeAgents = agents.filter(a => a.status === 'Active');
    
    if (activeAgents.length >= 2) {
      const proposer = randomChoice(activeAgents);
      let counterparty = randomChoice(activeAgents);
      while (counterparty === proposer && activeAgents.length > 1) {
        counterparty = randomChoice(activeAgents);
      }
      
      if (counterparty !== proposer) {
        await proposeContract(proposer, counterparty);
      }
    }
    
    // Propose every 200-600ms on average
    await new Promise(r => setTimeout(r, 200 + Math.random() * 400));
  }
}

async function contractAcceptLoop(): Promise<void> {
  while (running) {
    const now = Date.now();
    
    // Find contracts ready for acceptance
    const readyToAccept = contracts.filter(c =>
      c.status === 'Proposed' &&
      (now - c.proposedAt) > MIN_ACCEPT_DELAY_MS
    );
    
    if (readyToAccept.length > 0) {
      // 80% accept, 20% might reject/ignore
      if (Math.random() < 0.8) {
        const contract = readyToAccept[0]; // FIFO
        await acceptContract(contract);
      }
    }
    
    await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
  }
}

async function contractCompleteLoop(): Promise<void> {
  while (running) {
    const now = Date.now();
    
    // Find contracts ready for completion
    const readyToComplete = contracts.filter(c =>
      c.status === 'Active' &&
      c.acceptedAt &&
      (now - c.acceptedAt) > MIN_COMPLETE_DELAY_MS
    );
    
    if (readyToComplete.length > 0) {
      const contract = readyToComplete[0]; // FIFO
      await completeContract(contract);
    }
    
    await new Promise(r => setTimeout(r, 400 + Math.random() * 500));
  }
}

function printStats(): void {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const totalTx = stats.agentsRegistered + stats.agentsActivated + 
                  stats.contractsProposed + stats.contractsAccepted + stats.contractsCompleted;
  const tps = totalTx / elapsed;
  
  const pending = contracts.filter(c => c.status === 'Proposed').length;
  const active = contracts.filter(c => c.status === 'Active').length;
  const completed = contracts.filter(c => c.status === 'Completed').length;
  const registeredAgents = agents.filter(a => a.status === 'Registered').length;
  const activeAgents = agents.filter(a => a.status === 'Active').length;
  
  console.log(`\n📊 [${timestamp()}] Stats:`);
  console.log(`   TPS: ${tps.toFixed(1)} | Errors: ${stats.errors} | Elapsed: ${elapsed.toFixed(0)}s`);
  console.log(`   Agents: ${registeredAgents} registered, ${activeAgents} active`);
  console.log(`   Contracts: ${pending} pending → ${active} active → ${completed} completed`);
  console.log(`   Totals: ${stats.agentsRegistered} reg, ${stats.agentsActivated} act, ${stats.contractsProposed} prop, ${stats.contractsAccepted} acc, ${stats.contractsCompleted} done\n`);
}

async function main(): Promise<void> {
  console.log(`🌱 Starting organic traffic generator`);
  console.log(`📡 Bridge: ${BRIDGE_URL}`);
  console.log(`⏱️  Sync delay: ${SYNC_DELAY_MS / 1000}s`);
  console.log(`⏹️  Press Ctrl+C to stop\n`);
  
  // Print stats every 30 seconds
  const statsInterval = setInterval(printStats, 30000);
  
  // Handle shutdown
  process.on('SIGINT', () => {
    running = false;
    clearInterval(statsInterval);
    console.log('\n\n🛑 Shutting down...');
    printStats();
    process.exit(0);
  });
  
  // Start all loops concurrently
  await Promise.all([
    agentGrowthLoop(),
    activationLoop(),
    contractProposalLoop(),
    contractAcceptLoop(),
    contractCompleteLoop(),
  ]);
}

main().catch(console.error);
