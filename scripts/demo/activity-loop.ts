#!/usr/bin/env npx tsx
/**
 * Activity Loop - Simulates live activity for dashboard demo
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PLATFORMS = ['DISCORD', 'TELEGRAM', 'TWITTER', 'GITHUB'] as const;
const ATTESTATION_TYPES = ['VOUCH', 'BEHAVIORAL', 'COMPLETION'] as const;

function randomChoice<T>(arr: readonly T[] | T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🔄 Starting activity loop (10 iterations)...\n');

  const agents = await prisma.agent.findMany();
  if (agents.length < 2) {
    console.log('❌ Need at least 2 agents. Run seed-demo-data.ts first.');
    return;
  }

  for (let i = 1; i <= 10; i++) {
    console.log(`\n━━━ Iteration ${i}/10 ━━━`);
    
    // Pick random agents
    const agent = randomChoice(agents);
    const other = randomChoice(agents.filter(a => a.id !== agent.id));
    
    // Randomly choose an action
    const action = Math.random();
    
    if (action < 0.4) {
      // Create attestation (vouch/behavioral/completion)
      const type = randomChoice(ATTESTATION_TYPES);
      const delta = type === 'COMPLETION' ? 5 : type === 'VOUCH' ? 2 : 3;
      
      await prisma.attestation.create({
        data: {
          agentId: agent.id,
          issuerId: other.id,
          issuerPlatform: randomChoice(PLATFORMS),
          type,
          delta,
          reason: type === 'VOUCH' ? `${other.displayName || 'Agent'} vouched for ${agent.displayName || 'Agent'}` :
                  type === 'COMPLETION' ? 'Successfully delivered on contract' :
                  'Positive collaboration experience',
          txHash: `tx_live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`.slice(0, 64),
          snapshotOrdinal: BigInt(900 + i),
          createdAt: new Date(),
        },
      });
      
      // Update reputation
      await prisma.agent.update({
        where: { id: agent.id },
        data: { reputation: { increment: delta } },
      });
      
      console.log(`  ✨ ${type}: ${other.displayName || 'Agent'} → ${agent.displayName || 'Agent'} (+${delta} rep)`);
      
    } else if (action < 0.7) {
      // Create new contract
      const contractId = `contract_live_${Date.now().toString(36)}`;
      
      await prisma.contract.create({
        data: {
          contractId,
          proposerId: agent.id,
          counterpartyId: other.id,
          state: 'PROPOSED',
          terms: {
            description: `New task from ${agent.displayName || 'Agent'} to ${other.displayName || 'Agent'}`,
            value: Math.floor(Math.random() * 500) + 50,
          },
          proposedAt: new Date(),
          fiberId: `fiber_live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          snapshotOrdinal: BigInt(900 + i),
        },
      });
      
      console.log(`  📝 CONTRACT PROPOSED: ${agent.displayName || 'Agent'} → ${other.displayName || 'Agent'}`);
      
    } else if (action < 0.85) {
      // Accept/complete a pending contract
      const pendingContract = await prisma.contract.findFirst({
        where: { state: 'PROPOSED' },
        orderBy: { proposedAt: 'desc' },
      });
      
      if (pendingContract) {
        await prisma.contract.update({
          where: { id: pendingContract.id },
          data: { 
            state: 'ACTIVE',
            acceptedAt: new Date(),
          },
        });
        console.log(`  ✅ CONTRACT ACCEPTED: ${pendingContract.contractId}`);
      } else {
        console.log(`  ⏭️  No pending contracts to accept`);
      }
      
    } else {
      // Complete an active contract
      const activeContract = await prisma.contract.findFirst({
        where: { state: 'ACTIVE' },
        orderBy: { acceptedAt: 'desc' },
      });
      
      if (activeContract) {
        await prisma.contract.update({
          where: { id: activeContract.id },
          data: { 
            state: 'COMPLETED',
            completedAt: new Date(),
          },
        });
        
        // Add completion attestations for both parties
        const proposer = agents.find(a => a.id === activeContract.proposerId)!;
        const counterparty = agents.find(a => a.id === activeContract.counterpartyId)!;
        
        await prisma.attestation.createMany({
          data: [
            {
              agentId: proposer.id,
              issuerId: counterparty.id,
              type: 'COMPLETION',
              delta: 5,
              reason: 'Contract completed successfully',
              txHash: `tx_complete_${Date.now().toString(36)}_a`.slice(0, 64),
              snapshotOrdinal: BigInt(900 + i),
            },
            {
              agentId: counterparty.id,
              issuerId: proposer.id,
              type: 'COMPLETION',
              delta: 5,
              reason: 'Contract completed successfully',
              txHash: `tx_complete_${Date.now().toString(36)}_b`.slice(0, 64),
              snapshotOrdinal: BigInt(900 + i),
            },
          ],
        });
        
        await prisma.agent.update({ where: { id: proposer.id }, data: { reputation: { increment: 5 } } });
        await prisma.agent.update({ where: { id: counterparty.id }, data: { reputation: { increment: 5 } } });
        
        console.log(`  🎉 CONTRACT COMPLETED: ${activeContract.contractId}`);
        console.log(`     +5 rep for ${proposer.displayName}, +5 rep for ${counterparty.displayName}`);
      } else {
        console.log(`  ⏭️  No active contracts to complete`);
      }
    }
    
    // Create new snapshot record
    await prisma.indexedSnapshot.create({
      data: { 
        ordinal: BigInt(900 + i), 
        hash: `snapshot_${900 + i}_${Math.random().toString(36).slice(2, 10)}`,
        indexedAt: new Date(),
      },
    }).catch(() => {}); // Ignore if exists
    
    // Wait 3 seconds between iterations
    if (i < 10) {
      console.log(`  ⏳ Waiting 3s...`);
      await sleep(3000);
    }
  }
  
  console.log('\n\n✅ Activity loop complete!');
  
  // Print final stats
  const stats = {
    agents: await prisma.agent.count(),
    attestations: await prisma.attestation.count(),
    contracts: await prisma.contract.count(),
  };
  console.log(`\nFinal stats: ${stats.agents} agents, ${stats.attestations} attestations, ${stats.contracts} contracts`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
