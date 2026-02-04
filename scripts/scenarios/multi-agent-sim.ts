#!/usr/bin/env npx tsx
/**
 * OttoChain Multi-Agent Simulation
 * 
 * Simulates a realistic agent ecosystem with:
 * - Agent registration
 * - Vouching networks
 * - Contract negotiations
 * - Completions and disputes
 * - Reputation dynamics
 */

import nacl from 'tweetnacl';
import { createHash } from 'crypto';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  ML0_URL: process.env.ML0_URL || 'http://localhost:9200',
  DL1_URL: process.env.DL1_URL || 'http://localhost:9400',
  BRIDGE_URL: process.env.BRIDGE_URL || 'http://localhost:3030',
  INDEXER_URL: process.env.INDEXER_URL || 'http://localhost:3031',
  SNAPSHOT_WAIT_MS: 45000,  // Time to wait for snapshot confirmation
  NUM_AGENTS: 5,
};

// ============================================================================
// Agent Wallet
// ============================================================================

interface Agent {
  name: string;
  address: string;
  publicKey: string;
  secretKey: Uint8Array;
  reputation: number;
}

function createAgent(name: string): Agent {
  const keypair = nacl.sign.keyPair();
  const publicKey = Buffer.from(keypair.publicKey).toString('hex');
  // Simplified DAG address derivation
  const hash = createHash('sha256').update(keypair.publicKey).digest('hex');
  const address = `DAG${hash.slice(0, 40)}`;
  
  return {
    name,
    address,
    publicKey,
    secretKey: keypair.secretKey,
    reputation: 10, // Starting reputation
  };
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
    proofs: [{ id: signature.slice(0, 64), signature }],
  };

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

async function getCheckpoint(): Promise<{ ordinal: number }> {
  const response = await fetch(`${CONFIG.ML0_URL}/data-application/v1/checkpoint`);
  return response.json() as Promise<{ ordinal: number }>;
}

async function getStateMachines(): Promise<Record<string, unknown>> {
  const response = await fetch(`${CONFIG.ML0_URL}/data-application/v1/state-machines`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function waitForSnapshot(minOrdinal: number): Promise<number> {
  console.log(`    ⏳ Waiting for snapshot > ${minOrdinal}...`);
  const start = Date.now();
  
  while (Date.now() - start < CONFIG.SNAPSHOT_WAIT_MS) {
    const checkpoint = await getCheckpoint();
    if (checkpoint.ordinal > minOrdinal) {
      console.log(`    ✓ Snapshot ${checkpoint.ordinal} confirmed`);
      return checkpoint.ordinal;
    }
    await sleep(2000);
  }
  
  throw new Error(`Snapshot timeout (waited ${CONFIG.SNAPSHOT_WAIT_MS}ms)`);
}

// ============================================================================
// OttoChain Actions
// ============================================================================

async function registerAgent(agent: Agent, platform: string = 'DISCORD'): Promise<void> {
  const message = {
    RegisterAgent: {
      address: agent.address,
      publicKey: agent.publicKey,
      displayName: agent.name,
      platform,
      platformUserId: `${platform.toLowerCase()}_${agent.name.toLowerCase()}`,
    },
  };
  
  const signature = signMessage(agent, message);
  await submitTransaction(message, signature);
}

async function vouch(from: Agent, to: Agent, reason: string): Promise<void> {
  const message = {
    Vouch: {
      fromAddress: from.address,
      toAddress: to.address,
      reason,
    },
  };
  
  const signature = signMessage(from, message);
  await submitTransaction(message, signature);
}

async function proposeContract(
  proposer: Agent,
  counterparty: Agent,
  terms: Record<string, unknown>
): Promise<string> {
  const contractId = `contract_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  const message = {
    ProposeContract: {
      contractId,
      proposerAddress: proposer.address,
      counterpartyAddress: counterparty.address,
      terms,
    },
  };
  
  const signature = signMessage(proposer, message);
  await submitTransaction(message, signature);
  return contractId;
}

async function acceptContract(agent: Agent, contractId: string): Promise<void> {
  const message = {
    AcceptContract: {
      contractId,
      agentAddress: agent.address,
    },
  };
  
  const signature = signMessage(agent, message);
  await submitTransaction(message, signature);
}

async function completeContract(agent: Agent, contractId: string, proof?: string): Promise<void> {
  const message = {
    CompleteContract: {
      contractId,
      agentAddress: agent.address,
      proof: proof || 'Work completed successfully',
    },
  };
  
  const signature = signMessage(agent, message);
  await submitTransaction(message, signature);
}

async function disputeContract(agent: Agent, contractId: string, reason: string): Promise<void> {
  const message = {
    DisputeContract: {
      contractId,
      agentAddress: agent.address,
      reason,
    },
  };
  
  const signature = signMessage(agent, message);
  await submitTransaction(message, signature);
}

async function reportViolation(reporter: Agent, target: Agent, reason: string): Promise<void> {
  const message = {
    ReportViolation: {
      reporterAddress: reporter.address,
      targetAddress: target.address,
      reason,
    },
  };
  
  const signature = signMessage(reporter, message);
  await submitTransaction(message, signature);
}

// ============================================================================
// Simulation Scenarios
// ============================================================================

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface SimulationResult {
  scenario: string;
  success: boolean;
  message: string;
  duration: number;
}

const results: SimulationResult[] = [];

async function runScenario(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n📋 Scenario: ${name}`);
  const start = Date.now();
  
  try {
    await fn();
    results.push({ scenario: name, success: true, message: 'OK', duration: Date.now() - start });
    console.log(`   ✅ Passed (${Date.now() - start}ms)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ scenario: name, success: false, message, duration: Date.now() - start });
    console.log(`   ❌ Failed: ${message}`);
  }
}

// ============================================================================
// Main Simulation
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('       OttoChain Multi-Agent Simulation');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`ML0: ${CONFIG.ML0_URL}`);
  console.log(`DL1: ${CONFIG.DL1_URL}`);
  console.log(`Agents: ${CONFIG.NUM_AGENTS}`);
  console.log('');

  // Create agents
  const agents: Agent[] = [
    createAgent('Alice'),
    createAgent('Bob'),
    createAgent('Charlie'),
    createAgent('Diana'),
    createAgent('Eve'),
  ].slice(0, CONFIG.NUM_AGENTS);

  console.log('Created agents:');
  agents.forEach(a => console.log(`  - ${a.name}: ${a.address.slice(0, 20)}...`));

  let currentOrdinal = (await getCheckpoint()).ordinal;

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 1: Agent Registration
  // ──────────────────────────────────────────────────────────────────────────
  await runScenario('Agent Registration', async () => {
    console.log('    Registering all agents...');
    
    for (const agent of agents) {
      await registerAgent(agent);
      console.log(`    → ${agent.name} submitted registration`);
      await sleep(500); // Small delay between txs
    }
    
    currentOrdinal = await waitForSnapshot(currentOrdinal);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 2: Vouching Network
  // ──────────────────────────────────────────────────────────────────────────
  await runScenario('Vouching Network', async () => {
    const [alice, bob, charlie] = agents;
    
    // Alice vouches for Bob
    await vouch(alice, bob, 'Worked together on project X');
    console.log(`    → ${alice.name} vouched for ${bob.name}`);
    
    // Bob vouches for Charlie
    await vouch(bob, charlie, 'Reliable contractor');
    console.log(`    → ${bob.name} vouched for ${charlie.name}`);
    
    // Charlie vouches for Alice (completing a trust triangle)
    await vouch(charlie, alice, 'Excellent communication');
    console.log(`    → ${charlie.name} vouched for ${alice.name}`);
    
    currentOrdinal = await waitForSnapshot(currentOrdinal);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 3: Successful Contract
  // ──────────────────────────────────────────────────────────────────────────
  await runScenario('Successful Contract Completion', async () => {
    const [alice, bob] = agents;
    
    // Alice proposes a contract to Bob
    const contractId = await proposeContract(alice, bob, {
      type: 'ServiceAgreement',
      description: 'Build a landing page',
      payment: 100,
      deadline: '2026-02-15',
    });
    console.log(`    → ${alice.name} proposed contract ${contractId.slice(0, 20)}...`);
    
    await sleep(1000);
    
    // Bob accepts
    await acceptContract(bob, contractId);
    console.log(`    → ${bob.name} accepted contract`);
    
    currentOrdinal = await waitForSnapshot(currentOrdinal);
    
    // Bob completes work
    await completeContract(bob, contractId, 'Deployed to https://example.com');
    console.log(`    → ${bob.name} marked work complete`);
    
    await sleep(1000);
    
    // Alice confirms completion
    await completeContract(alice, contractId, 'Work verified and approved');
    console.log(`    → ${alice.name} confirmed completion`);
    
    currentOrdinal = await waitForSnapshot(currentOrdinal);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 4: Disputed Contract
  // ──────────────────────────────────────────────────────────────────────────
  await runScenario('Disputed Contract', async () => {
    const [_, __, charlie, diana] = agents;
    
    // Charlie proposes a contract to Diana
    const contractId = await proposeContract(charlie, diana, {
      type: 'DataDelivery',
      description: 'Provide dataset for ML training',
      payment: 50,
    });
    console.log(`    → ${charlie.name} proposed contract`);
    
    await sleep(1000);
    
    // Diana accepts
    await acceptContract(diana, contractId);
    console.log(`    → ${diana.name} accepted`);
    
    currentOrdinal = await waitForSnapshot(currentOrdinal);
    
    // Charlie disputes (claims data was poor quality)
    await disputeContract(charlie, contractId, 'Data quality below agreed standards');
    console.log(`    → ${charlie.name} disputed contract`);
    
    currentOrdinal = await waitForSnapshot(currentOrdinal);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 5: Violation Report
  // ──────────────────────────────────────────────────────────────────────────
  await runScenario('Violation Report', async () => {
    const [alice, _, __, ___, eve] = agents;
    
    // Alice reports Eve for spam behavior
    await reportViolation(alice, eve, 'Sending unsolicited promotional messages');
    console.log(`    → ${alice.name} reported ${eve.name} for violation`);
    
    currentOrdinal = await waitForSnapshot(currentOrdinal);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 6: New Agent Onboarding
  // ──────────────────────────────────────────────────────────────────────────
  await runScenario('New Agent Onboarding', async () => {
    const newAgent = createAgent('Frank');
    console.log(`    → Created new agent: ${newAgent.name}`);
    
    await registerAgent(newAgent, 'TELEGRAM');
    console.log(`    → ${newAgent.name} registered via Telegram`);
    
    currentOrdinal = await waitForSnapshot(currentOrdinal);
    
    // Existing agent vouches for newcomer
    const [alice] = agents;
    await vouch(alice, newAgent, 'Known from Telegram community');
    console.log(`    → ${alice.name} vouched for ${newAgent.name}`);
    
    currentOrdinal = await waitForSnapshot(currentOrdinal);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Results Summary
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                    Simulation Results');
  console.log('═══════════════════════════════════════════════════════════\n');

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  results.forEach(r => {
    const status = r.success ? '✅' : '❌';
    const time = `${(r.duration / 1000).toFixed(1)}s`;
    console.log(`${status} ${r.scenario.padEnd(35)} ${time.padStart(8)}`);
  });

  console.log('');
  console.log(`Total: ${passed} passed, ${failed} failed`);
  
  // Final state check
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                    Final State');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  try {
    const checkpoint = await getCheckpoint();
    console.log(`Final ordinal: ${checkpoint.ordinal}`);
    
    const stateMachines = await getStateMachines();
    const count = Object.keys(stateMachines).length;
    console.log(`State machines: ${count}`);
    
    // If indexer is running, show its stats
    try {
      const indexerStatus = await fetch(`${CONFIG.INDEXER_URL}/status`).then(r => r.json()) as {
        lastIndexedOrdinal: number;
        totalAgents: number;
        totalContracts: number;
      };
      console.log(`\nIndexer status:`);
      console.log(`  Last indexed: ${indexerStatus.lastIndexedOrdinal}`);
      console.log(`  Agents: ${indexerStatus.totalAgents}`);
      console.log(`  Contracts: ${indexerStatus.totalContracts}`);
    } catch {
      console.log('(Indexer not available)');
    }
  } catch (err) {
    console.log('Could not fetch final state:', err);
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
  
  if (failed > 0) {
    console.log('❌ Some scenarios failed');
    process.exit(1);
  }
  
  console.log('✅ All scenarios passed!');
}

main().catch(err => {
  console.error('Simulation error:', err);
  process.exit(1);
});
