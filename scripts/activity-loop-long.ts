#!/usr/bin/env npx tsx
import { PrismaClient } from '@prisma/client';
import { publishEvent, CHANNELS } from '../packages/shared/src/redis.js';

const prisma = new PrismaClient();
const PLATFORMS = ['DISCORD', 'TELEGRAM', 'TWITTER', 'GITHUB'] as const;
const ATTESTATION_TYPES = ['VOUCH', 'BEHAVIORAL', 'COMPLETION'] as const;

const randomChoice = <T>(arr: readonly T[] | T[]): T => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const iterations = 100; // ~5 min at 3s intervals
  console.log(`🔄 Starting 5-minute activity loop (${iterations} iterations)...\n`);

  const agents = await prisma.agent.findMany();
  if (agents.length < 2) { console.log('❌ Need agents. Run seed first.'); return; }

  for (let i = 1; i <= iterations; i++) {
    const agent = randomChoice(agents);
    const other = randomChoice(agents.filter(a => a.id !== agent.id));
    const action = Math.random();
    
    if (action < 0.4) {
      const type = randomChoice(ATTESTATION_TYPES);
      const delta = type === 'COMPLETION' ? 5 : type === 'VOUCH' ? 2 : 3;
      const attestation = await prisma.attestation.create({
        data: {
          agentId: agent.id, issuerId: other.id, issuerPlatform: randomChoice(PLATFORMS),
          type, delta, reason: `${type} from ${other.displayName || 'Agent'}`,
          txHash: `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`.slice(0,64),
          snapshotOrdinal: BigInt(900 + i), createdAt: new Date(),
        },
      });
      await prisma.agent.update({ where: { id: agent.id }, data: { reputation: { increment: delta } } });
      console.log(`[${i}/${iterations}] ✨ ${type}: ${other.displayName||'?'} → ${agent.displayName||'?'} (+${delta})`);

      // Publish event to Redis
      await publishEvent(CHANNELS.ACTIVITY_FEED, {
        eventType: type,
        timestamp: new Date(),
        agent: { address: agent.address, displayName: agent.displayName },
        action: 'attest',
        reputationDelta: delta,
      });
    } else if (action < 0.7) {
      const contract = await prisma.contract.create({
        data: {
          contractId: `contract_${Date.now().toString(36)}`, proposerId: agent.id, counterpartyId: other.id,
          state: 'PROPOSED', terms: { task: `Task from ${agent.displayName}`, value: Math.floor(Math.random()*500)+50 },
          proposedAt: new Date(), fiberId: `fiber_${Date.now().toString(36)}`, snapshotOrdinal: BigInt(900 + i),
        },
      });
      console.log(`[${i}/${iterations}] 📝 CONTRACT: ${agent.displayName||'?'} → ${other.displayName||'?'}`);

      // Publish event to Redis
      await publishEvent(CHANNELS.ACTIVITY_FEED, {
        eventType: 'CONTRACT',
        timestamp: new Date(),
        agent: { address: agent.address, displayName: agent.displayName },
        action: 'propose',
      });
    } else if (action < 0.85) {
      const c = await prisma.contract.findFirst({ where: { state: 'PROPOSED' }, orderBy: { proposedAt: 'desc' } });
      if (c) {
        await prisma.contract.update({ where: { id: c.id }, data: { state: 'ACTIVE', acceptedAt: new Date() } });
        console.log(`[${i}/${iterations}] ✅ ACCEPTED: ${c.contractId.slice(0,20)}`);

        // Publish event to Redis
        await publishEvent(CHANNELS.ACTIVITY_FEED, {
          eventType: 'CONTRACT',
          timestamp: new Date(),
          agent: { address: c.proposerId, displayName: p.displayName },
          action: 'accept',
        });
      } else console.log(`[${i}/${iterations}] ⏭️ No pending contracts`);
    } else {
      const c = await prisma.contract.findFirst({ where: { state: 'ACTIVE' }, orderBy: { acceptedAt: 'desc' } });
      if (c) {
        await prisma.contract.update({ where: { id: c.id }, data: { state: 'COMPLETED', completedAt: new Date() } });
        const p = agents.find(a => a.id === c.proposerId)!;
        const cp = agents.find(a => a.id === c.counterpartyId)!;

        await prisma.attestation.createMany({ data: [
          { agentId: p.id, issuerId: cp.id, type: 'COMPLETION', delta: 5, reason: 'Contract done', txHash: `tx_c_${Date.now()}_a`.slice(0,64), snapshotOrdinal: BigInt(900+i) },
          { agentId: cp.id, issuerId: p.id, type: 'COMPLETION', delta: 5, reason: 'Contract done', txHash: `tx_c_${Date.now()}_b`.slice(0,64), snapshotOrdinal: BigInt(900+i) },
        ]});

        await prisma.agent.update({ where: { id: p.id }, data: { reputation: { increment: 5 } } });
        await prisma.agent.update({ where: { id: cp.id }, data: { reputation: { increment: 5 } } });

        console.log(`[${i}/${iterations}] 🎉 COMPLETED: ${c.contractId.slice(0,20)} (+5 each)`);

        // Publish event to Redis
        await publishEvent(CHANNELS.ACTIVITY_FEED, {
          eventType: 'CONTRACT',
          timestamp: new Date(),
          agent: { address: p.address, displayName: p.displayName },
          action: 'complete',
        });
      } else console.log(`[${i}/${iterations}] ⏭️ No active contracts`);
    }
    await prisma.indexedSnapshot.create({ data: { ordinal: BigInt(900+i), hash: `snap_${900+i}`, indexedAt: new Date() } }).catch(()=>{});
    if (i < iterations) await sleep(3000);
  }
  console.log('\n✅ Activity loop complete!');
}
main().catch(console.error).finally(() => prisma.$disconnect());
