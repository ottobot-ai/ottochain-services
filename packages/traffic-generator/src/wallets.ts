/**
 * Wallet Persistence for Traffic Simulator
 * 
 * Generates and manages a persistent pool of agent wallets
 * that can be pre-funded in genesis.csv
 */

import { dag4 } from '@stardust-collective/dag4';
import { existsSync, readFileSync, writeFileSync } from 'fs';

export interface KeyPair {
  privateKey: string;
  publicKey: string;
  address: string;
}

/**
 * Generate a new random key pair
 */
function generateKeyPair(): KeyPair {
  const privateKey = dag4.keyStore.generatePrivateKey();
  return keyPairFromPrivateKey(privateKey);
}

/**
 * Derive a key pair from an existing private key
 */
function keyPairFromPrivateKey(privateKey: string): KeyPair {
  const publicKey = dag4.keyStore.getPublicKeyFromPrivate(privateKey, false);
  const normalizedPubKey = publicKey.length === 128 ? '04' + publicKey : publicKey;
  const address = dag4.keyStore.getDagAddressFromPublicKey(normalizedPubKey);
  
  return { privateKey, publicKey: normalizedPubKey, address };
}

export interface PersistedWallet {
  id: string;
  address: string;
  publicKey: string;
  privateKey: string;
  platform: 'twitter' | 'github' | 'discord' | 'telegram';
  handle: string;
  createdAt: string;
  registeredAt?: string;
  agentId?: string;
}

export interface WalletPool {
  version: number;
  generatedAt: string;
  count: number;
  wallets: PersistedWallet[];
}

const PLATFORMS = ['twitter', 'github', 'discord', 'telegram'] as const;

/**
 * Generate a pool of wallets for traffic simulation
 */
export function generateWalletPool(count: number, prefix: string = 'sim'): WalletPool {
  console.log(`🔑 Generating ${count} wallets...`);
  
  const wallets: PersistedWallet[] = [];
  
  for (let i = 0; i < count; i++) {
    const keyPair = generateKeyPair();
    const platform = PLATFORMS[i % PLATFORMS.length];
    const handle = `${prefix}_${String(i + 1).padStart(3, '0')}`;
    
    wallets.push({
      id: `${prefix}_${i + 1}`,
      address: keyPair.address,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      platform,
      handle,
      createdAt: new Date().toISOString(),
    });
    
    if ((i + 1) % 50 === 0) {
      console.log(`  Generated ${i + 1}/${count}`);
    }
  }
  
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    count,
    wallets,
  };
}

/**
 * Save wallet pool to JSON file
 */
export function saveWalletPool(pool: WalletPool, outputPath: string): void {
  writeFileSync(outputPath, JSON.stringify(pool, null, 2));
  console.log(`💾 Saved ${pool.count} wallets to ${outputPath}`);
}

/**
 * Load wallet pool from JSON file
 */
export function loadWalletPool(inputPath: string): WalletPool | null {
  if (!existsSync(inputPath)) {
    return null;
  }
  
  const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
  console.log(`📂 Loaded ${data.count} wallets from ${inputPath}`);
  return data as WalletPool;
}

/**
 * Export wallet addresses for genesis.csv
 * 
 * @param pool - Wallet pool to export
 * @param outputPath - Path to write genesis CSV
 * @param amount - Amount per wallet in smallest units (10000 OTTO = 1000000000000)
 */
export function exportGenesisCSV(
  pool: WalletPool, 
  outputPath: string, 
  amount: bigint = 1_000_000_000_000n  // 10000 OTTO with 8 decimals
): void {
  const lines = ['address,balance'];
  
  for (const wallet of pool.wallets) {
    lines.push(`${wallet.address},${amount.toString()}`);
  }
  
  writeFileSync(outputPath, lines.join('\n') + '\n');
  console.log(`📄 Exported ${pool.count} addresses to ${outputPath}`);
  console.log(`   Each funded with ${Number(amount) / 100_000_000} OTTO`);
}

/**
 * Get unregistered wallets from pool
 */
export function getUnregisteredWallets(pool: WalletPool): PersistedWallet[] {
  return pool.wallets.filter(w => !w.registeredAt);
}

/**
 * Mark wallet as registered
 */
export function markWalletRegistered(
  pool: WalletPool, 
  address: string, 
  agentId: string
): void {
  const wallet = pool.wallets.find(w => w.address === address);
  if (wallet) {
    wallet.registeredAt = new Date().toISOString();
    wallet.agentId = agentId;
  }
}

/**
 * Get wallet by address
 */
export function getWalletByAddress(pool: WalletPool, address: string): PersistedWallet | undefined {
  return pool.wallets.find(w => w.address === address);
}

/**
 * Get wallet by agent ID
 */
export function getWalletByAgentId(pool: WalletPool, agentId: string): PersistedWallet | undefined {
  return pool.wallets.find(w => w.agentId === agentId);
}

/**
 * Reconstruct KeyPair from persisted wallet
 */
export function getKeyPair(wallet: PersistedWallet): KeyPair {
  return keyPairFromPrivateKey(wallet.privateKey);
}

// CLI handling
if (process.argv[1]?.endsWith('wallets.ts') || process.argv[1]?.endsWith('wallets.js')) {
  const command = process.argv[2];
  
  switch (command) {
    case 'generate': {
      const count = parseInt(process.argv[3] || '200', 10);
      const output = process.argv[4] || 'wallets.json';
      const prefix = process.argv[5] || 'sim';
      
      const pool = generateWalletPool(count, prefix);
      saveWalletPool(pool, output);
      break;
    }
    
    case 'export-genesis': {
      const input = process.argv[3] || 'wallets.json';
      const output = process.argv[4] || 'genesis-agents.csv';
      const amountOtto = parseInt(process.argv[5] || '10000', 10);
      const amount = BigInt(amountOtto) * 100_000_000n;
      
      const pool = loadWalletPool(input);
      if (!pool) {
        console.error(`❌ Wallet file not found: ${input}`);
        process.exit(1);
      }
      exportGenesisCSV(pool, output, amount);
      break;
    }
    
    case 'show': {
      const input = process.argv[3] || 'wallets.json';
      const pool = loadWalletPool(input);
      if (!pool) {
        console.error(`❌ Wallet file not found: ${input}`);
        process.exit(1);
      }
      
      console.log(`\n📊 Wallet Pool Stats:`);
      console.log(`   Version: ${pool.version}`);
      console.log(`   Generated: ${pool.generatedAt}`);
      console.log(`   Count: ${pool.count}`);
      
      const registered = pool.wallets.filter(w => w.registeredAt).length;
      console.log(`   Registered: ${registered}/${pool.count}`);
      
      console.log(`\n📋 First 10 addresses:`);
      pool.wallets.slice(0, 10).forEach((w, i) => {
        const status = w.registeredAt ? '✅' : '⬜';
        console.log(`   ${status} ${w.address}`);
      });
      break;
    }
    
    default:
      console.log(`
🔑 Wallet Manager for Traffic Simulator

Usage:
  npx ts-node src/wallets.ts generate [count] [output] [prefix]
    Generate a new wallet pool
    Default: 200 wallets to wallets.json with prefix 'sim'

  npx ts-node src/wallets.ts export-genesis [input] [output] [amount]
    Export addresses for genesis.csv
    Default: 10000 OTTO per wallet

  npx ts-node src/wallets.ts show [input]
    Show wallet pool stats

Examples:
  npx ts-node src/wallets.ts generate 200 wallets.json sim
  npx ts-node src/wallets.ts export-genesis wallets.json genesis-agents.csv 10000
  npx ts-node src/wallets.ts show wallets.json
`);
  }
}
