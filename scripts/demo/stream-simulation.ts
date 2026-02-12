#!/usr/bin/env npx tsx
/**
 * Stream-based Fiber Simulation
 * 
 * Models multiple concurrent "streams" (lifecycle flows) with weighted random selection.
 * Based on OttoChain test patterns from:
 * - AgentIdentityLifecycleSuite
 * - TokenEscrowSuite
 * - Contract state machines
 */

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://5.78.121.248:3030';
const SYNC_DELAY_MS = 50000; // 50s for metagraph sync

// ============================================================================
// Stream Templates - Lifecycle Flows from OttoChain Tests
// ============================================================================

interface StreamStep {
  action: string;
  weight: number;  // Probability weight for this path
  delay?: number;  // Optional delay before this step
}

interface StreamTemplate {
  name: string;
  steps: Record<string, StreamStep[]>;  // state → possible next steps
  initialState: string;
}

// Agent Identity Flow (from AgentIdentityLifecycleSuite)
const AGENT_STREAM: StreamTemplate = {
  name: 'AgentIdentity',
  initialState: 'REGISTERED',
  steps: {
    'REGISTERED': [
      { action: 'activate', weight: 90 },
      { action: 'withdraw', weight: 10 },  // Rage quit before starting
    ],
    'ACTIVE': [
      { action: 'receive_vouch', weight: 40 },
      { action: 'receive_completion', weight: 35 },
      { action: 'receive_violation', weight: 5 },
      { action: 'withdraw', weight: 5 },
      { action: 'idle', weight: 15 },  // Stay in state
    ],
    'WITHDRAWN': [], // Terminal
  }
};

// Contract Flow (Proposed → Active → Completed)
const CONTRACT_STREAM: StreamTemplate = {
  name: 'Contract',
  initialState: 'PROPOSED',
  steps: {
    'PROPOSED': [
      { action: 'accept', weight: 70 },
      { action: 'reject', weight: 15 },
      { action: 'cancel', weight: 10 },
      { action: 'idle', weight: 5 },
    ],
    'ACTIVE': [
      { action: 'submit_completion', weight: 60 },
      { action: 'dispute', weight: 10 },
      { action: 'idle', weight: 30 },
    ],
    'DISPUTED': [
      { action: 'resolve', weight: 80 },
      { action: 'idle', weight: 20 },
    ],
    'COMPLETED': [],  // Terminal
    'REJECTED': [],   // Terminal
    'Cancelled': [],  // Terminal
  }
};

// Escrow Flow (from TokenEscrowSuite)
const ESCROW_STREAM: StreamTemplate = {
  name: 'Escrow',
  initialState: 'Pending',
  steps: {
    'Pending': [
      { action: 'fund', weight: 85 },
      { action: 'cancel', weight: 15 },
    ],
    'Funded': [
      { action: 'release', weight: 70 },
      { action: 'refund', weight: 20 },
      { action: 'expire', weight: 10 },
    ],
    'Released': [],  // Terminal
    'Refunded': [],  // Terminal
  }
};

// ============================================================================
// Simulation State
// ============================================================================

interface Wallet {
  privateKey: string;
  publicKey: string;
  address: string;
}

interface StreamInstance {
  id: string;
  template: StreamTemplate;
  fiberId: string;
  currentState: string;
  wallet: Wallet;
  counterpartyWallet?: Wallet;  // For contracts
  createdAt: number;
  lastActionAt: number;
  actionCount: number;
}

const streams: StreamInstance[] = [];
let running = true;

// Stats
const stats = {
  created: 0,
  transitions: 0,
  completed: 0,
  errors: 0,
  startTime: Date.now(),
};

// ============================================================================
// Helpers
// ============================================================================

function randomId(len = 4): string {
  return Math.random().toString(36).slice(2, 2 + len);
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function weightedSelect<T extends { weight: number }>(options: T[]): T | null {
  if (options.length === 0) return null;
  
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let random = Math.random() * total;
  
  for (const option of options) {
    random -= option.weight;
    if (random <= 0) return option;
  }
  return options[options.length - 1];
}

async function generateWallet(): Promise<Wallet> {
  const resp = await fetch(`${BRIDGE_URL}/wallet/generate`, { method: 'POST' });
  if (!resp.ok) throw new Error(`Wallet gen failed`);
  return resp.json();
}

// ============================================================================
// Stream Actions
// ============================================================================

async function createAgentStream(): Promise<StreamInstance | null> {
  try {
    const wallet = await generateWallet();
    const name = `Agent_${randomId()}`;
    
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
    
    if (!resp.ok) throw new Error(`Register failed`);
    const data = await resp.json();
    
    stats.created++;
    console.log(`[${timestamp()}] 🆕 Agent stream: ${name}`);
    
    return {
      id: `agent-${randomId(8)}`,
      template: AGENT_STREAM,
      fiberId: data.fiberId || data.hash,
      currentState: 'REGISTERED',
      wallet,
      createdAt: Date.now(),
      lastActionAt: Date.now(),
      actionCount: 0,
    };
  } catch (err) {
    stats.errors++;
    return null;
  }
}

async function createContractStream(proposer: Wallet, counterparty: Wallet): Promise<StreamInstance | null> {
  try {
    const resp = await fetch(`${BRIDGE_URL}/contract/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        privateKey: proposer.privateKey,
        counterpartyAddress: counterparty.address,
        title: `Contract_${randomId()}`,
        description: 'Simulated contract',
        terms: {
          task: 'Work item',
          value: Math.floor(Math.random() * 5000) + 100,
          deadline: '2026-03-01',
        },
      }),
    });
    
    if (!resp.ok) throw new Error(`Propose failed`);
    const data = await resp.json();
    
    stats.created++;
    console.log(`[${timestamp()}] 📋 Contract stream: ${proposer.address.slice(0, 12)} → ${counterparty.address.slice(0, 12)}`);
    
    return {
      id: `contract-${randomId(8)}`,
      template: CONTRACT_STREAM,
      fiberId: data.fiberId || data.hash,
      currentState: 'PROPOSED',
      wallet: proposer,
      counterpartyWallet: counterparty,
      createdAt: Date.now(),
      lastActionAt: Date.now(),
      actionCount: 0,
    };
  } catch (err) {
    stats.errors++;
    return null;
  }
}

async function advanceStream(stream: StreamInstance): Promise<boolean> {
  const steps = stream.template.steps[stream.currentState];
  if (!steps || steps.length === 0) {
    // Terminal state
    return false;
  }
  
  const selected = weightedSelect(steps);
  if (!selected || selected.action === 'idle') {
    return true; // Stay in current state
  }
  
  // Check sync delay
  if (Date.now() - stream.lastActionAt < SYNC_DELAY_MS) {
    return true; // Not ready yet
  }
  
  try {
    let resp: Response;
    let newState = stream.currentState;
    
    // Route to appropriate bridge endpoint
    if (stream.template.name === 'AgentIdentity') {
      if (selected.action === 'activate') {
        resp = await fetch(`${BRIDGE_URL}/agent/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            privateKey: stream.wallet.privateKey,
            fiberId: stream.fiberId,
          }),
        });
        if (resp.ok) newState = 'ACTIVE';
      } else if (selected.action === 'withdraw') {
        resp = await fetch(`${BRIDGE_URL}/agent/transition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            privateKey: stream.wallet.privateKey,
            fiberId: stream.fiberId,
            event: 'withdraw',
          }),
        });
        if (resp.ok) newState = 'WITHDRAWN';
      } else {
        // Attestation events (receive_vouch, etc.) - stay in Active
        resp = await fetch(`${BRIDGE_URL}/agent/transition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            privateKey: stream.wallet.privateKey,
            fiberId: stream.fiberId,
            event: selected.action,
            payload: { from: stream.wallet.address },
          }),
        });
      }
    } else if (stream.template.name === 'Contract') {
      const actor = selected.action === 'accept' || selected.action === 'reject' 
        ? stream.counterpartyWallet! 
        : stream.wallet;
      
      if (selected.action === 'accept') {
        resp = await fetch(`${BRIDGE_URL}/contract/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            privateKey: actor.privateKey,
            fiberId: stream.fiberId,
          }),
        });
        if (resp.ok) newState = 'ACTIVE';
      } else if (selected.action === 'submit_completion') {
        resp = await fetch(`${BRIDGE_URL}/contract/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            privateKey: actor.privateKey,
            fiberId: stream.fiberId,
            proof: 'Work completed',
          }),
        });
        if (resp.ok) newState = 'COMPLETED';
      } else {
        // Generic transition
        resp = await fetch(`${BRIDGE_URL}/contract/transition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            privateKey: actor.privateKey,
            fiberId: stream.fiberId,
            event: selected.action,
          }),
        });
      }
    } else {
      return true;
    }
    
    if (resp!.ok) {
      stream.currentState = newState;
      stream.lastActionAt = Date.now();
      stream.actionCount++;
      stats.transitions++;
      
      const icon = newState === stream.template.steps[stream.currentState]?.length === 0 ? '✅' : '➡️';
      console.log(`[${timestamp()}] ${icon} ${stream.template.name} ${stream.id.slice(0, 8)}: ${selected.action} → ${newState}`);
      
      if (stream.template.steps[newState]?.length === 0) {
        stats.completed++;
      }
      return true;
    } else {
      stats.errors++;
      return true;
    }
  } catch (err) {
    stats.errors++;
    return true;
  }
}

// ============================================================================
// Simulation Loops
// ============================================================================

async function spawnLoop(): Promise<void> {
  const walletPool: Wallet[] = [];
  let spawnCount = 0;
  
  console.log(`[${timestamp()}] 🚀 Spawn loop started`);
  
  while (running) {
    spawnCount++;
    
    // Always try to spawn agents at start to build pool
    if (walletPool.length < 20 || Math.random() < 0.5) {
      const stream = await createAgentStream();
      if (stream) {
        streams.push(stream);
        walletPool.push(stream.wallet);
      }
    }
    
    // Spawn contract streams (need at least 2 wallets)
    if (walletPool.length >= 2 && Math.random() < 0.4) {
      const i1 = Math.floor(Math.random() * walletPool.length);
      let i2 = Math.floor(Math.random() * walletPool.length);
      while (i2 === i1) i2 = Math.floor(Math.random() * walletPool.length);
      
      const stream = await createContractStream(walletPool[i1], walletPool[i2]);
      if (stream) streams.push(stream);
    }
    
    // Log progress every 10 spawns
    if (spawnCount % 10 === 0) {
      console.log(`[${timestamp()}] 📈 Spawn progress: ${streams.length} streams, ${walletPool.length} wallets`);
    }
    
    await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
  }
}

async function advanceLoop(): Promise<void> {
  while (running) {
    // Select a random active stream
    const activeStreams = streams.filter(s => 
      s.template.steps[s.currentState]?.length > 0 &&
      Date.now() - s.lastActionAt >= SYNC_DELAY_MS
    );
    
    if (activeStreams.length > 0) {
      const stream = activeStreams[Math.floor(Math.random() * activeStreams.length)];
      await advanceStream(stream);
    }
    
    await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
  }
}

function printStats(): void {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const activeCount = streams.filter(s => s.template.steps[s.currentState]?.length > 0).length;
  const completedCount = streams.filter(s => s.template.steps[s.currentState]?.length === 0).length;
  
  console.log(`\n📊 [${timestamp()}] Simulation Stats:`);
  console.log(`   Elapsed: ${elapsed.toFixed(0)}s | Errors: ${stats.errors}`);
  console.log(`   Streams: ${streams.length} total, ${activeCount} active, ${completedCount} completed`);
  console.log(`   Actions: ${stats.created} created, ${stats.transitions} transitions, ${stats.completed} lifecycles done`);
  
  // Breakdown by template
  const byTemplate: Record<string, { active: number; done: number }> = {};
  for (const s of streams) {
    const key = s.template.name;
    if (!byTemplate[key]) byTemplate[key] = { active: 0, done: 0 };
    if (s.template.steps[s.currentState]?.length > 0) {
      byTemplate[key].active++;
    } else {
      byTemplate[key].done++;
    }
  }
  for (const [name, counts] of Object.entries(byTemplate)) {
    console.log(`   ${name}: ${counts.active} active, ${counts.done} completed`);
  }
  console.log('');
}

async function main(): Promise<void> {
  console.log(`🌊 Stream-based Fiber Simulation`);
  console.log(`📡 Bridge: ${BRIDGE_URL}`);
  console.log(`⏱️  Sync delay: ${SYNC_DELAY_MS / 1000}s`);
  console.log(`⏹️  Press Ctrl+C to stop\n`);
  
  const statsInterval = setInterval(printStats, 30000);
  
  process.on('SIGINT', () => {
    running = false;
    clearInterval(statsInterval);
    console.log('\n🛑 Stopping simulation...');
    printStats();
    process.exit(0);
  });
  
  // Run spawn and advance loops concurrently
  await Promise.all([
    spawnLoop(),
    advanceLoop(),
  ]);
}

main().catch(console.error);
