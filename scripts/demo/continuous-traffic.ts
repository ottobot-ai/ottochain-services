#!/usr/bin/env npx tsx
/**
 * OttoChain Continuous Traffic Generator v2
 * Simulates realistic agent ecosystem with varied participants
 * 
 * Usage:
 *   BRIDGE_URL=http://... npx tsx continuous-traffic.ts
 *   
 * Environment:
 *   BRIDGE_URL     - Bridge API URL (default: http://localhost:3030)
 *   ML0_URL        - ML0 URL for state verification (default: http://localhost:9200)
 *   INTERVAL_MS    - Milliseconds between actions (default: 3000)
 */

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3030';
const ML0_URL = process.env.ML0_URL || process.env.BRIDGE_URL?.replace(':3030', ':9200').replace('121.248', '90.207') || 'http://localhost:9200';
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '3000');

interface Wallet {
  address: string;
  publicKey: string;
  privateKey: string;
}

interface Agent {
  wallet: Wallet;
  name: string;
  persona: string;
  fiberId?: string;
  status: 'registered' | 'active';
  registeredAt: number;
}

interface Contract {
  contractId: string;
  proposer: Agent;
  counterparty: Agent;
  task: string;
  value: number;
  status: 'proposed' | 'active' | 'completed';
  proposedAt: number;
  acceptedAt?: number;
}

const agents: Agent[] = [];
const contracts: Contract[] = [];
let actionCount = 0;
let running = true;

// More interesting agent names and personas
const AGENT_POOLS = {
  developers: ['CodeNinja', 'ByteMaster', 'DevOps_Dan', 'Alice_Dev', 'BugHunter', 'GitGuru', 'StackSam', 'LogicLee'],
  designers: ['PixelPete', 'UX_Uma', 'DesignDiva', 'ArtfulAndy', 'StyleSage', 'ColorCris'],
  analysts: ['DataDrake', 'ChartChris', 'MetricsMia', 'InsightIvy', 'TrendyTom', 'AnalyzeAce'],
  managers: ['PMPaula', 'LeadLucy', 'AgileAlex', 'ScrumSam', 'TeamTina'],
  specialists: ['SecuritySue', 'CloudCarl', 'MLMike', 'BlockchainBob', 'AIAmy', 'Web3Will'],
  freelancers: ['FreelanceFred', 'GigGina', 'ContractorCal', 'RemoteRita', 'NomadNick'],
};

const TASK_TEMPLATES = [
  { task: 'Smart contract audit', minValue: 500, maxValue: 2000 },
  { task: 'UI/UX redesign', minValue: 300, maxValue: 1500 },
  { task: 'API integration', minValue: 200, maxValue: 800 },
  { task: 'Security review', minValue: 400, maxValue: 1200 },
  { task: 'Performance optimization', minValue: 250, maxValue: 900 },
  { task: 'Documentation update', minValue: 100, maxValue: 400 },
  { task: 'Bug bounty submission', minValue: 150, maxValue: 1000 },
  { task: 'Code review', minValue: 100, maxValue: 500 },
  { task: 'Data analysis report', minValue: 200, maxValue: 700 },
  { task: 'ML model training', minValue: 500, maxValue: 2500 },
  { task: 'Cloud migration', minValue: 400, maxValue: 1800 },
  { task: 'Testing suite', minValue: 200, maxValue: 600 },
  { task: 'DevOps pipeline', minValue: 300, maxValue: 1000 },
  { task: 'Mobile app feature', minValue: 350, maxValue: 1200 },
  { task: 'Blockchain integration', minValue: 600, maxValue: 3000 },
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const timestamp = () => new Date().toISOString().slice(11, 19);
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomChoice = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function generateAgentName(): { name: string; persona: string } {
  const pools = Object.entries(AGENT_POOLS);
  const [persona, names] = randomChoice(pools);
  const baseName = randomChoice(names);
  const suffix = Math.random().toString(36).slice(2, 5);
  return { name: `${baseName}_${suffix}`, persona };
}

function generateTask(): { task: string; value: number } {
  const template = randomChoice(TASK_TEMPLATES);
  return {
    task: template.task,
    value: randomInt(template.minValue, template.maxValue),
  };
}

// API helpers
async function generateWallet(): Promise<Wallet> {
  const res = await fetch(`${BRIDGE_URL}/wallet/generate`, { method: 'POST' });
  if (!res.ok) throw new Error(`Wallet gen failed: ${res.status}`);
  return res.json();
}

async function registerAgent(wallet: Wallet, displayName: string): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/agent/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: wallet.address,
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
      displayName,
    }),
  });
  if (!res.ok) throw new Error(`Register failed: ${res.status}`);
  const data = await res.json();
  return data.fiberId || data.hash;
}

async function activateAgent(wallet: Wallet, fiberId: string): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/agent/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ privateKey: wallet.privateKey, fiberId }),
  });
  if (!res.ok) throw new Error(`Activate failed: ${res.status}`);
  const data = await res.json();
  return data.hash || data.fiberId;
}

async function proposeContract(proposer: Wallet, counterpartyAddress: string, terms: object): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/contract/propose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      privateKey: proposer.privateKey,
      counterpartyAddress,
      terms,
    }),
  });
  if (!res.ok) throw new Error(`Propose failed: ${res.status}`);
  const data = await res.json();
  return data.contractId || data.fiberId || data.hash;
}

// Query ML0 to verify state machine status
async function getStateMachineState(fiberId: string): Promise<{ currentState: string; stateData: any } | null> {
  try {
    const res = await fetch(`${ML0_URL}/data-application/v1/state-machines/${fiberId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      currentState: data.currentState?.value || 'unknown',
      stateData: data.stateData || {},
    };
  } catch {
    return null;
  }
}

async function acceptContract(contractId: string, counterparty: Wallet): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/contract/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractId,
      privateKey: counterparty.privateKey,
    }),
  });
  if (!res.ok) throw new Error(`Accept failed: ${res.status}`);
  const data = await res.json();
  return data.hash || 'accepted';
}

async function completeContract(contractId: string, completer: Wallet): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/contract/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractId,
      privateKey: completer.privateKey,
    }),
  });
  if (!res.ok) throw new Error(`Complete failed: ${res.status}`);
  const data = await res.json();
  return data.hash || 'completed';
}

// Actions
async function doRegisterAgent(): Promise<boolean> {
  const { name, persona } = generateAgentName();
  try {
    const wallet = await generateWallet();
    const fiberId = await registerAgent(wallet, name);
    agents.push({ wallet, name, persona, fiberId, status: 'registered', registeredAt: Date.now() });
    console.log(`[${timestamp()}] 📝 NEW AGENT: ${name} (${persona}) joined the network`);
    return true;
  } catch (err) {
    console.log(`[${timestamp()}] ❌ Register: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

const SYNC_DELAY_MS = 45000;

async function doActivateAgent(): Promise<boolean> {
  const now = Date.now();
  const pending = agents.filter(a => 
    a.status === 'registered' && 
    a.fiberId && 
    (now - a.registeredAt) > SYNC_DELAY_MS
  );
  if (pending.length === 0) return false;
  
  const agent = randomChoice(pending);
  try {
    await activateAgent(agent.wallet, agent.fiberId!);
    agent.status = 'active';
    console.log(`[${timestamp()}] ✅ ACTIVATED: ${agent.name} is now active!`);
    return true;
  } catch (err) {
    console.log(`[${timestamp()}] ❌ Activate ${agent.name}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

async function doProposeContract(): Promise<boolean> {
  const active = agents.filter(a => a.status === 'active');
  if (active.length < 2) return false;
  
  const proposer = randomChoice(active);
  const counterparty = randomChoice(active.filter(a => a.wallet.address !== proposer.wallet.address));
  const { task, value } = generateTask();
  
  try {
    const contractId = await proposeContract(proposer.wallet, counterparty.wallet.address, {
      task,
      value,
      deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
    contracts.push({ 
      contractId, proposer, counterparty, task, value,
      status: 'proposed', proposedAt: Date.now() 
    });
    console.log(`[${timestamp()}] 📋 CONTRACT: ${proposer.name} → ${counterparty.name}: "${task}" ($${value})`);
    return true;
  } catch (err) {
    console.log(`[${timestamp()}] ❌ Propose: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

async function doAcceptContract(): Promise<boolean> {
  const now = Date.now();
  const pending = contracts.filter(c => 
    c.status === 'proposed' && 
    (now - c.proposedAt) > SYNC_DELAY_MS
  );
  if (pending.length === 0) return false;
  
  // Pick oldest first (most likely to be synced)
  pending.sort((a, b) => a.proposedAt - b.proposedAt);
  const contract = pending[0];
  
  // Verify on ML0 before accepting
  const state = await getStateMachineState(contract.contractId);
  if (!state || state.currentState !== 'PROPOSED') {
    // Not ready yet, skip
    return false;
  }
  
  try {
    await acceptContract(contract.contractId, contract.counterparty.wallet);
    contract.status = 'active';
    contract.acceptedAt = Date.now();
    console.log(`[${timestamp()}] 🤝 ACCEPTED: ${contract.counterparty.name} accepts "${contract.task}" from ${contract.proposer.name}`);
    return true;
  } catch (err) {
    console.log(`[${timestamp()}] ❌ Accept: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

async function doCompleteContract(): Promise<boolean> {
  const now = Date.now();
  const active = contracts.filter(c => 
    c.status === 'active' && 
    c.acceptedAt && 
    (now - c.acceptedAt) > SYNC_DELAY_MS
  );
  if (active.length === 0) return false;
  
  // Pick oldest first
  active.sort((a, b) => (a.acceptedAt || 0) - (b.acceptedAt || 0));
  const contract = active[0];
  
  // Verify on ML0 before completing
  const state = await getStateMachineState(contract.contractId);
  if (!state || state.currentState !== 'ACTIVE') {
    return false;
  }
  
  const completer = Math.random() > 0.5 ? contract.proposer : contract.counterparty;
  try {
    await completeContract(contract.contractId, completer.wallet);
    contract.status = 'completed';
    console.log(`[${timestamp()}] ✨ COMPLETED: "${contract.task}" ($${contract.value}) - ${completer.name} marked done!`);
    return true;
  } catch (err) {
    console.log(`[${timestamp()}] ❌ Complete: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

async function pickAndDoAction(): Promise<void> {
  actionCount++;
  
  const now = Date.now();
  const registered = agents.filter(a => a.status === 'registered').length;
  const readyToActivate = agents.filter(a => 
    a.status === 'registered' && 
    a.fiberId && 
    (now - a.registeredAt) > SYNC_DELAY_MS
  ).length;
  const active = agents.filter(a => a.status === 'active').length;
  const proposedContracts = contracts.filter(c => c.status === 'proposed').length;
  const readyToAccept = contracts.filter(c => 
    c.status === 'proposed' && 
    (now - c.proposedAt) > SYNC_DELAY_MS
  ).length;
  const activeContracts = contracts.filter(c => c.status === 'active').length;
  const readyToComplete = contracts.filter(c => 
    c.status === 'active' && 
    c.acceptedAt && 
    (now - c.acceptedAt) > SYNC_DELAY_MS
  ).length;
  
  const roll = Math.random();
  
  // PRIORITY 1: Always activate ready agents first (they've been waiting)
  if (readyToActivate > 0) {
    if (await doActivateAgent()) return;
  }
  
  // PRIORITY 2: Complete ready contracts
  if (readyToComplete > 0) {
    if (await doCompleteContract()) return;
  }
  
  // PRIORITY 3: Accept ready contracts  
  if (readyToAccept > 0) {
    if (await doAcceptContract()) return;
  }
  
  // PRIORITY 4: Propose contracts if we have active agents
  if (active >= 2 && roll < 0.6) {
    if (await doProposeContract()) return;
  }
  
  // PRIORITY 5: Register new agents (but cap at reasonable number waiting)
  if (registered < 10 || roll < 0.2) {
    if (await doRegisterAgent()) return;
  }
  
  // Fallback: propose if possible, otherwise register
  if (active >= 2) {
    await doProposeContract();
  } else {
    await doRegisterAgent();
  }
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        🦦 OttoChain Continuous Traffic Generator v2          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`   Bridge:   ${BRIDGE_URL}`);
  console.log(`   ML0:      ${ML0_URL}`);
  console.log(`   Interval: ${INTERVAL_MS}ms`);
  console.log('');
  console.log('   Press Ctrl+C to stop');
  console.log('');
  console.log('═'.repeat(66));
  console.log('');
  
  process.on('SIGINT', () => {
    const completedCount = contracts.filter(c => c.status === 'completed').length;
    console.log('\n');
    console.log('═'.repeat(66));
    console.log('');
    console.log('📊 Final Statistics:');
    console.log(`   Total Actions:    ${actionCount}`);
    console.log(`   Agents:           ${agents.length} (${agents.filter(a => a.status === 'active').length} active)`);
    console.log(`   Contracts:        ${contracts.length} total`);
    console.log(`     - Proposed:     ${contracts.filter(c => c.status === 'proposed').length}`);
    console.log(`     - Active:       ${contracts.filter(c => c.status === 'active').length}`);
    console.log(`     - Completed:    ${completedCount}`);
    console.log(`   Total Value:      $${contracts.reduce((sum, c) => sum + c.value, 0).toLocaleString()}`);
    console.log('');
    console.log('👋 Shutting down...');
    running = false;
    process.exit(0);
  });
  
  // Main loop
  while (running) {
    await pickAndDoAction();
    await sleep(INTERVAL_MS);
  }
}

main().catch(console.error);
