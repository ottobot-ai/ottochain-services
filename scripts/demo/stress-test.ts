#!/usr/bin/env npx tsx
/**
 * OttoChain Stress Test - Scale to 1000 participants
 * 
 * Usage:
 *   BRIDGE_URL=http://... TARGET=100 BATCH=10 npx tsx stress-test.ts
 *   
 * Environment:
 *   BRIDGE_URL    - Bridge API URL
 *   TARGET        - Target number of agents (default: 100)
 *   BATCH         - Concurrent batch size (default: 5)
 *   DELAY_MS      - Delay between batches (default: 1000)
 */

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3030';
const TARGET = parseInt(process.env.TARGET || '100');
const BATCH = parseInt(process.env.BATCH || '5');
const DELAY_MS = parseInt(process.env.DELAY_MS || '1000');

interface Wallet {
  address: string;
  publicKey: string;
  privateKey: string;
}

interface Agent {
  wallet: Wallet;
  name: string;
  fiberId: string;
}

const agents: Agent[] = [];
const contracts: string[] = [];
let errors = 0;
let running = true;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const timestamp = () => new Date().toISOString().slice(11, 19);

const NAMES = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
  'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi',
  'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega',
  'Aether', 'Blaze', 'Cipher', 'Drift', 'Echo', 'Flux', 'Glyph', 'Helix',
  'Iris', 'Jade', 'Karma', 'Lumen', 'Matrix', 'Nova', 'Orion', 'Prism',
  'Quark', 'Rune', 'Spark', 'Terra', 'Unity', 'Vortex', 'Wave', 'Xenon',
  'Yield', 'Zero', 'Apex', 'Bolt', 'Core', 'Dawn', 'Edge', 'Forge',
];

const TASKS = [
  'Smart contract audit', 'Protocol integration', 'Security review',
  'API development', 'Frontend build', 'Testing suite', 'Documentation',
  'DevOps setup', 'Data pipeline', 'Analytics dashboard', 'Mobile app',
  'Blockchain integration', 'ML model training', 'Performance tuning',
];

function randomName(): string {
  const base = NAMES[Math.floor(Math.random() * NAMES.length)];
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}_${suffix}`;
}

async function generateWallet(): Promise<Wallet> {
  const res = await fetch(`${BRIDGE_URL}/wallet/generate`, { method: 'POST' });
  if (!res.ok) throw new Error(`Wallet: ${res.status}`);
  return res.json();
}

async function registerAgent(wallet: Wallet, name: string): Promise<string> {
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
  if (!res.ok) throw new Error(`Register: ${res.status}`);
  const data = await res.json();
  return data.fiberId || data.hash;
}

async function proposeContract(wallet: Wallet, counterpartyAddress: string): Promise<string> {
  const task = TASKS[Math.floor(Math.random() * TASKS.length)];
  const value = Math.floor(Math.random() * 5000) + 100;
  
  const res = await fetch(`${BRIDGE_URL}/contract/propose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      privateKey: wallet.privateKey,
      counterpartyAddress,
      terms: { task, value, deadline: '2026-03-01' },
    }),
  });
  if (!res.ok) throw new Error(`Propose: ${res.status}`);
  const data = await res.json();
  return data.contractId || data.hash;
}

async function createAgentBatch(count: number): Promise<number> {
  const promises = Array(count).fill(null).map(async () => {
    try {
      const wallet = await generateWallet();
      const name = randomName();
      const fiberId = await registerAgent(wallet, name);
      agents.push({ wallet, name, fiberId });
      return true;
    } catch (err) {
      errors++;
      return false;
    }
  });
  
  const results = await Promise.all(promises);
  return results.filter(Boolean).length;
}

async function createContractBatch(count: number): Promise<number> {
  if (agents.length < 2) return 0;
  
  const promises = Array(count).fill(null).map(async () => {
    try {
      const proposer = agents[Math.floor(Math.random() * agents.length)];
      let counterparty = agents[Math.floor(Math.random() * agents.length)];
      while (counterparty.wallet.address === proposer.wallet.address) {
        counterparty = agents[Math.floor(Math.random() * agents.length)];
      }
      
      const contractId = await proposeContract(proposer.wallet, counterparty.wallet.address);
      contracts.push(contractId);
      return true;
    } catch (err) {
      errors++;
      return false;
    }
  });
  
  const results = await Promise.all(promises);
  return results.filter(Boolean).length;
}

function printProgress() {
  const pct = ((agents.length / TARGET) * 100).toFixed(1);
  const bar = '█'.repeat(Math.floor(agents.length / TARGET * 30)) + '░'.repeat(30 - Math.floor(agents.length / TARGET * 30));
  console.log(`\r[${timestamp()}] [${bar}] ${agents.length}/${TARGET} agents (${pct}%) | ${contracts.length} contracts | ${errors} errors`);
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           🦦 OttoChain Stress Test                           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`   Bridge:      ${BRIDGE_URL}`);
  console.log(`   Target:      ${TARGET} agents`);
  console.log(`   Batch Size:  ${BATCH} concurrent`);
  console.log(`   Delay:       ${DELAY_MS}ms between batches`);
  console.log('');
  console.log('   Press Ctrl+C to stop');
  console.log('');
  console.log('═'.repeat(66));
  console.log('');

  const startTime = Date.now();

  process.on('SIGINT', () => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (agents.length / parseFloat(elapsed)).toFixed(1);
    console.log('\n\n');
    console.log('═'.repeat(66));
    console.log('');
    console.log('📊 Final Statistics:');
    console.log(`   Agents Created:    ${agents.length}`);
    console.log(`   Contracts Created: ${contracts.length}`);
    console.log(`   Errors:            ${errors}`);
    console.log(`   Time Elapsed:      ${elapsed}s`);
    console.log(`   Rate:              ${rate} agents/sec`);
    console.log('');
    console.log('👋 Shutting down...');
    running = false;
    process.exit(0);
  });

  // Phase 1: Create agents
  console.log(`[${timestamp()}] 🚀 Phase 1: Creating ${TARGET} agents...\n`);
  
  while (agents.length < TARGET && running) {
    const needed = Math.min(BATCH, TARGET - agents.length);
    const created = await createAgentBatch(needed);
    printProgress();
    
    if (created > 0) {
      // Also create some contracts between existing agents
      if (agents.length >= 2) {
        await createContractBatch(Math.min(2, agents.length));
      }
    }
    
    await sleep(DELAY_MS);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = (agents.length / parseFloat(elapsed)).toFixed(1);
  
  console.log('\n\n');
  console.log('═'.repeat(66));
  console.log('');
  console.log('✅ Phase 1 Complete!');
  console.log(`   Agents:    ${agents.length}`);
  console.log(`   Contracts: ${contracts.length}`);
  console.log(`   Time:      ${elapsed}s`);
  console.log(`   Rate:      ${rate} agents/sec`);
  console.log('');

  // Phase 2: Generate contract activity
  console.log(`[${timestamp()}] 🔄 Phase 2: Generating contract activity...`);
  console.log('   (Press Ctrl+C to stop)\n');
  
  while (running) {
    await createContractBatch(BATCH);
    console.log(`[${timestamp()}] 📋 Contracts: ${contracts.length} total`);
    await sleep(DELAY_MS * 2);
  }
}

main().catch(console.error);
