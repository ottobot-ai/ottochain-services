/**
 * Fixed Agent Pool
 * 
 * 26 deterministic keypairs for traffic generation.
 * Generated from a seed phrase, so they're identical on every restart.
 * This enables idempotent registration - agents won't duplicate.
 * 
 * Distribution:
 *  - 4 oracles (for market resolution)
 *  - 22 regular agents
 *  - Platforms: distributed across twitter, github, discord, telegram
 */

import { dag4 } from '@stardust-collective/dag4';
import * as crypto from 'crypto';

export interface FixedAgent {
  /** Agent index (0-25) */
  index: number;
  /** Display name */
  name: string;
  /** Platform for agent identity */
  platform: 'twitter' | 'github' | 'discord' | 'telegram';
  /** Private key (hex) */
  privateKey: string;
  /** Public key (hex, with 04 prefix) */
  publicKey: string;
  /** DAG address */
  address: string;
  /** Is this agent an oracle? */
  isOracle: boolean;
}

// Seed for deterministic key generation
// This should be stable - changing it would create new agents
const AGENT_SEED = 'ottochain-traffic-gen-v2-fixed-agents-2026';

const PLATFORMS = ['twitter', 'github', 'discord', 'telegram'] as const;

// Agent names - mix of personas for realistic traffic
const AGENT_NAMES = [
  // Oracles (indices 0-3)
  'Oracle_Alpha',
  'Oracle_Beta', 
  'Oracle_Gamma',
  'Oracle_Delta',
  // Regular agents (indices 4-25)
  'Agent_Alice',
  'Agent_Bob',
  'Agent_Charlie',
  'Agent_Diana',
  'Agent_Eve',
  'Agent_Frank',
  'Agent_Grace',
  'Agent_Henry',
  'Agent_Iris',
  'Agent_Jack',
  'Agent_Kate',
  'Agent_Leo',
  'Agent_Maya',
  'Agent_Nick',
  'Agent_Olivia',
  'Agent_Paul',
  'Agent_Quinn',
  'Agent_Rose',
  'Agent_Sam',
  'Agent_Tara',
  'Agent_Uma',
  'Agent_Victor',
];

/**
 * Generate a deterministic private key from seed + index
 */
function generateDeterministicPrivateKey(seed: string, index: number): string {
  const data = `${seed}:agent:${index}`;
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  return hash;
}

/**
 * Derive keypair from private key using dag4
 */
function deriveKeypair(privateKey: string): { publicKey: string; address: string } {
  const publicKey = dag4.keyStore.getPublicKeyFromPrivate(privateKey, false);
  const normalizedPubKey = publicKey.length === 128 ? '04' + publicKey : publicKey;
  const address = dag4.keyStore.getDagAddressFromPublicKey(normalizedPubKey);
  
  return { publicKey: normalizedPubKey, address };
}

/**
 * Generate the fixed pool of 26 agents
 * 
 * This is deterministic - calling it multiple times returns the same agents.
 * The first 4 agents are oracles, the rest are regular agents.
 */
export function generateFixedAgentPool(): FixedAgent[] {
  const agents: FixedAgent[] = [];
  
  for (let i = 0; i < 26; i++) {
    const privateKey = generateDeterministicPrivateKey(AGENT_SEED, i);
    const { publicKey, address } = deriveKeypair(privateKey);
    
    agents.push({
      index: i,
      name: AGENT_NAMES[i],
      platform: PLATFORMS[i % PLATFORMS.length],
      privateKey,
      publicKey,
      address,
      isOracle: i < 4, // First 4 are oracles
    });
  }
  
  return agents;
}

/**
 * Get agent by index
 */
export function getAgentByIndex(index: number): FixedAgent | undefined {
  if (index < 0 || index >= 26) return undefined;
  const pool = generateFixedAgentPool();
  return pool[index];
}

/**
 * Get agent by address
 */
export function getAgentByAddress(address: string): FixedAgent | undefined {
  const pool = generateFixedAgentPool();
  return pool.find(a => a.address === address);
}

/**
 * Get all oracle agents
 */
export function getOracleAgents(): FixedAgent[] {
  return generateFixedAgentPool().filter(a => a.isOracle);
}

/**
 * Get all non-oracle agents
 */
export function getRegularAgents(): FixedAgent[] {
  return generateFixedAgentPool().filter(a => !a.isOracle);
}

/**
 * Export addresses for genesis.csv funding
 * 
 * @param amount - Amount per agent in smallest units (10000 OTTO = 1000000000000)
 */
export function exportGenesisAddresses(amount: bigint = 1_000_000_000_000n): string {
  const pool = generateFixedAgentPool();
  const lines = ['address,balance'];
  
  for (const agent of pool) {
    lines.push(`${agent.address},${amount.toString()}`);
  }
  
  return lines.join('\n') + '\n';
}

// CLI handling
if (process.argv[1]?.endsWith('agents.ts') || process.argv[1]?.endsWith('agents.js')) {
  const command = process.argv[2];
  
  switch (command) {
    case 'list': {
      const pool = generateFixedAgentPool();
      console.log('\n🔑 Fixed Agent Pool (26 agents)\n');
      console.log('Idx  Name                Platform   Oracle  Address');
      console.log('───  ──────────────────  ─────────  ──────  ────────────────────────────────────────────');
      for (const agent of pool) {
        const oracleFlag = agent.isOracle ? '  ✓   ' : '      ';
        console.log(
          `${String(agent.index).padStart(2)}   ${agent.name.padEnd(18)}  ${agent.platform.padEnd(9)}  ${oracleFlag}  ${agent.address}`
        );
      }
      console.log('\n');
      break;
    }
    
    case 'genesis': {
      const amount = parseInt(process.argv[3] || '10000', 10);
      const amountSmallest = BigInt(amount) * 100_000_000n;
      const csv = exportGenesisAddresses(amountSmallest);
      console.log(csv);
      console.log(`# ${amount} OTTO per agent`);
      break;
    }
    
    case 'json': {
      const pool = generateFixedAgentPool();
      console.log(JSON.stringify(pool, null, 2));
      break;
    }
    
    default:
      console.log(`
🔑 Fixed Agent Pool Manager

Usage:
  npx tsx src/agents.ts list
    List all 26 agents with their addresses

  npx tsx src/agents.ts genesis [amount]
    Export genesis.csv format for funding (default: 10000 OTTO each)

  npx tsx src/agents.ts json
    Export full agent pool as JSON

Examples:
  npx tsx src/agents.ts list
  npx tsx src/agents.ts genesis 50000 > genesis-agents.csv
`);
  }
}
