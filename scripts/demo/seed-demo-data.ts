#!/usr/bin/env npx tsx
/**
 * Demo Data Seeder
 * Seeds the database with sample agents and activity for explorer demo
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const AGENT_DATA = [
  { displayName: 'OttoBot 🦦', reputation: 85 },
  { displayName: 'Alice', reputation: 72 },
  { displayName: 'Bob', reputation: 58 },
  { displayName: 'Charlie', reputation: 45 },
  { displayName: 'Diana', reputation: 63 },
  { displayName: 'Eve', reputation: 31 },
  { displayName: 'Frank', reputation: 92 },
  { displayName: null, reputation: 15 },
];

const PLATFORMS = ['DISCORD', 'TELEGRAM', 'TWITTER', 'GITHUB'] as const;
const ATTESTATION_TYPES = ['VOUCH', 'BEHAVIORAL', 'COMPLETION', 'VIOLATION'] as const;
const CONTRACT_STATES = ['PROPOSED', 'ACTIVE', 'COMPLETED', 'REJECTED'] as const;

function randomChoice<T>(arr: readonly T[] | T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(daysBack: number): Date {
  const now = new Date();
  return new Date(now.getTime() - Math.random() * daysBack * 24 * 60 * 60 * 1000);
}

function generateAddress(i: number): string {
  const base = `DAG${i}a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abc`;
  return base.slice(0, 60);
}

async function main() {
  console.log('🌱 Seeding demo data...\n');

  // Clear existing data
  await prisma.reputationHistory.deleteMany();
  await prisma.attestation.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.platformLink.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.indexedSnapshot.deleteMany();
  console.log('  Cleared existing data');

  // Create agents and collect their IDs
  const agents: { id: number; displayName: string | null; address: string }[] = [];
  
  for (let i = 0; i < AGENT_DATA.length; i++) {
    const data = AGENT_DATA[i];
    const address = generateAddress(i);
    const agent = await prisma.agent.create({
      data: {
        address,
        publicKey: `04${address.slice(3)}`,
        displayName: data.displayName,
        reputation: data.reputation,
        state: data.reputation > 20 ? 'ACTIVE' : 'REGISTERED',
        createdAt: randomDate(30),
        fiberId: `fiber_${i.toString().padStart(4, '0')}_${Math.random().toString(36).slice(2, 10)}`,
        snapshotOrdinal: BigInt(800 + i * 10),
      },
    });
    agents.push({ id: agent.id, displayName: data.displayName, address, reputation: data.reputation });
  }
  console.log(`  Created ${agents.length} agents`);

  // Create reputation history for each agent (simulating growth over time)
  let historyCount = 0;
  for (const agent of agents) {
    // Start with initial registration
    let currentRep = 10;
    const historyPoints = 8 + Math.floor(Math.random() * 8); // 8-15 points
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    
    for (let i = 0; i < historyPoints; i++) {
      const progress = i / (historyPoints - 1);
      const targetRep = (agent as any).reputation;
      const delta = i === 0 ? 0 : Math.floor((targetRep - 10) / (historyPoints - 1) * (0.5 + Math.random()));
      currentRep = Math.max(0, Math.min(100, currentRep + delta));
      
      // On last point, ensure we hit exact target
      if (i === historyPoints - 1) currentRep = targetRep;
      
      const recordedAt = new Date(startDate.getTime() + progress * 30 * 24 * 60 * 60 * 1000);
      
      await prisma.reputationHistory.create({
        data: {
          agentId: agent.id,
          reputation: currentRep,
          delta: i === 0 ? 0 : delta,
          reason: i === 0 ? 'Initial registration' : randomChoice(['VOUCH attestation', 'COMPLETION attestation', 'BEHAVIORAL attestation', 'Contract completed']),
          recordedAt,
          snapshotOrdinal: BigInt(800 + i * 5),
        },
      });
      historyCount++;
    }
  }
  console.log(`  Created ${historyCount} reputation history points`);

  // Create platform links
  let linkCount = 0;
  for (const agent of agents) {
    const numLinks = Math.floor(Math.random() * 3) + 1;
    const usedPlatforms = new Set<string>();
    
    for (let i = 0; i < numLinks; i++) {
      const platform = randomChoice(PLATFORMS);
      if (usedPlatforms.has(platform)) continue;
      usedPlatforms.add(platform);
      
      await prisma.platformLink.create({
        data: {
          agentId: agent.id,
          platform,
          platformUserId: `${platform.toLowerCase()}_${Math.random().toString(36).slice(2, 10)}`,
          platformUsername: agent.displayName ? `${agent.displayName.replace(/[^a-zA-Z]/g, '').toLowerCase()}` : null,
          verified: Math.random() > 0.3,
          linkedAt: randomDate(20),
        },
      });
      linkCount++;
    }
  }
  console.log(`  Created ${linkCount} platform links`);

  // Create attestations
  let attCount = 0;
  for (const agent of agents) {
    const numAtts = Math.floor(Math.random() * 8) + 2;
    
    for (let i = 0; i < numAtts; i++) {
      const type = randomChoice(ATTESTATION_TYPES);
      const issuer = randomChoice(agents.filter(a => a.id !== agent.id));
      
      const delta = type === 'VIOLATION' ? -10 : 
                    type === 'COMPLETION' ? 5 :
                    type === 'VOUCH' ? 2 : 3;
      
      await prisma.attestation.create({
        data: {
          agentId: agent.id,
          issuerId: issuer.id,
          issuerPlatform: Math.random() > 0.5 ? randomChoice(PLATFORMS) : null,
          type,
          delta,
          reason: type === 'VOUCH' ? 'Trusted collaborator' :
                  type === 'COMPLETION' ? 'Contract fulfilled successfully' :
                  type === 'VIOLATION' ? 'Failed to deliver on agreement' :
                  'Positive interaction',
          txHash: `tx_${Math.random().toString(36).slice(2, 18)}`.slice(0, 64),
          snapshotOrdinal: BigInt(850 + Math.floor(Math.random() * 50)),
          createdAt: randomDate(14),
        },
      });
      attCount++;
    }
  }
  console.log(`  Created ${attCount} attestations`);

  // Create contracts
  let contractCount = 0;
  for (let i = 0; i < 12; i++) {
    const proposer = randomChoice(agents);
    const counterparty = randomChoice(agents.filter(a => a.id !== proposer.id));
    const state = randomChoice(CONTRACT_STATES);
    const proposedAt = randomDate(10);
    
    await prisma.contract.create({
      data: {
        contractId: `contract_${Math.random().toString(36).slice(2, 14)}`,
        proposerId: proposer.id,
        counterpartyId: counterparty.id,
        state,
        terms: {
          description: `Service agreement between ${proposer.displayName || 'Agent'} and ${counterparty.displayName || 'Agent'}`,
          value: Math.floor(Math.random() * 1000) + 100,
          deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
        proposedAt,
        acceptedAt: ['ACTIVE', 'COMPLETED'].includes(state) ? new Date(proposedAt.getTime() + Math.random() * 24 * 60 * 60 * 1000) : null,
        completedAt: state === 'COMPLETED' ? new Date(proposedAt.getTime() + Math.random() * 5 * 24 * 60 * 60 * 1000) : null,
        fiberId: `contract_fiber_${i.toString().padStart(4, '0')}_${Math.random().toString(36).slice(2, 8)}`,
        snapshotOrdinal: BigInt(860 + i),
      },
    });
    contractCount++;
  }
  console.log(`  Created ${contractCount} contracts`);

  // Create fake indexed snapshot
  await prisma.indexedSnapshot.create({
    data: {
      ordinal: BigInt(900),
      hash: 'demo_snapshot_hash_' + Math.random().toString(36).slice(2, 10),
      indexedAt: new Date(),
    },
  });
  console.log('  Created snapshot marker');

  console.log('\n✅ Demo data seeded successfully!');
  console.log('\nRefresh the explorer to see the data.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
