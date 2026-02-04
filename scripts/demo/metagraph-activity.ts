#!/usr/bin/env npx tsx
/**
 * Real Metagraph Activity Generator
 * Uses the Bridge API to create actual on-chain state machines
 */

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3030';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const randomName = () => ['Alice', 'Bob', 'Charlie', 'Dave', 'Eve', 'Frank'][Math.floor(Math.random() * 6)] + '_' + Math.random().toString(36).slice(2, 6);

interface Wallet {
  address: string;
  publicKey: string;
  privateKey: string;
}

async function generateWallet(): Promise<Wallet> {
  const res = await fetch(`${BRIDGE_URL}/wallet/generate`, { method: 'POST' });
  if (!res.ok) throw new Error(`Wallet generation failed: ${res.status}`);
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Agent registration failed: ${res.status} - ${text}`);
  }
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Contract proposal failed: ${res.status} - ${text}`);
  }
  const data = await res.json();
  return data.contractId || data.hash;
}

async function main() {
  console.log('🚀 Real Metagraph Activity Generator\n');
  console.log(`Bridge: ${BRIDGE_URL}`);
  
  // Check bridge health
  try {
    const health = await fetch(`${BRIDGE_URL}/health`).catch(() => null);
    if (!health?.ok) {
      console.log('⚠️  Bridge health check failed, but continuing...\n');
    }
  } catch {}

  const iterations = parseInt(process.env.ITERATIONS || '10');
  const agents: { wallet: Wallet; name: string }[] = [];

  console.log(`\n📝 Creating ${Math.min(iterations, 5)} agents first...\n`);

  // Create some agents first
  for (let i = 0; i < Math.min(iterations, 5); i++) {
    try {
      const wallet = await generateWallet();
      const name = randomName();
      console.log(`  [${i + 1}] Generating wallet ${wallet.address.slice(0, 12)}...`);
      
      const hash = await registerAgent(wallet, name);
      console.log(`  ✅ Registered "${name}" → ${hash.slice(0, 16)}...`);
      agents.push({ wallet, name });
      
      await sleep(2000); // Wait for metagraph processing
    } catch (err) {
      console.log(`  ❌ Failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (agents.length < 2) {
    console.log('\n❌ Need at least 2 agents. Check bridge and metagraph status.');
    return;
  }

  console.log(`\n🤝 Creating contracts between agents...\n`);

  // Create some contracts
  for (let i = 0; i < Math.min(iterations, 5); i++) {
    try {
      const proposer = agents[i % agents.length];
      const counterparty = agents[(i + 1) % agents.length];
      
      const terms = {
        task: `Task #${i + 1}: ${['Code review', 'Data analysis', 'Design work', 'Testing', 'Documentation'][i % 5]}`,
        value: Math.floor(Math.random() * 500) + 100,
        deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      
      console.log(`  [${i + 1}] ${proposer.name} → ${counterparty.name}`);
      const contractId = await proposeContract(proposer.wallet, counterparty.wallet.address, terms);
      console.log(`  ✅ Contract proposed: ${contractId.slice(0, 16)}...`);
      
      await sleep(2000);
    } catch (err) {
      console.log(`  ❌ Failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log('\n✨ Done! Check the explorer for new fibers.\n');
}

main().catch(console.error);
