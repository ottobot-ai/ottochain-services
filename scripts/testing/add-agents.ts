#!/usr/bin/env npx tsx
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

const NAMES = [
  'Atlas', 'Nova', 'Cipher', 'Echo', 'Flux', 'Helix', 'Ion', 'Juno',
  'Kira', 'Luna', 'Matrix', 'Neon', 'Onyx', 'Pixel', 'Quark', 'Raven',
  'Sage', 'Terra', 'Unity', 'Vex', 'Wren', 'Xeno', 'Yara', 'Zephyr',
  'Aero', 'Blaze', 'Cosmo', 'Delta', 'Ember', 'Frost'
];

const PLATFORMS = ['DISCORD', 'TELEGRAM', 'TWITTER', 'GITHUB'] as const;

async function main() {
  const count = parseInt(process.argv[2] || '20');
  console.log(`🤖 Creating ${count} new agents...\n`);

  for (let i = 0; i < count; i++) {
    const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? `_${Math.floor(i / NAMES.length) + 1}` : '');
    const address = 'DAG' + crypto.randomBytes(20).toString('hex').slice(0, 37);
    const publicKey = '04' + crypto.randomBytes(32).toString('hex');
    
    const agent = await prisma.agent.create({
      data: {
        address,
        publicKey,
        displayName: name,
        reputation: 10 + Math.floor(Math.random() * 50),
        state: Math.random() > 0.2 ? 'ACTIVE' : 'REGISTERED',
        snapshotOrdinal: BigInt(100 + i),
        platformLinks: {
          create: [{
            platform: PLATFORMS[Math.floor(Math.random() * PLATFORMS.length)],
            platformUserId: crypto.randomBytes(8).toString('hex'),
            platformUsername: name.toLowerCase(),
            verified: Math.random() > 0.3,
          }]
        }
      }
    });
    
    console.log(`  ✓ ${name} (${agent.address.slice(0, 12)}...) rep=${agent.reputation}`);
  }

  const total = await prisma.agent.count();
  console.log(`\n✨ Done! Total agents: ${total}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
