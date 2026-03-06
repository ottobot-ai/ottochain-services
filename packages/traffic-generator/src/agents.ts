/**
 * Fixed Agent Pool — Canonical Participants
 *
 * 26 agents matching the metagraph's test participants (Alice → Zoe).
 * Private keys extracted from PKCS12 keystores at:
 *   ottochain/modules/shared-test/src/main/resources/participants/participant_N.p12
 *
 * These addresses are funded via genesis.csv with 100,000,000 OTTO each.
 * First 4 are designated oracles for market resolution.
 *
 * NEVER commit these keys to a non-test repo. They are test-only keys
 * whose addresses appear in the public genesis.csv.
 */

import { dag4 } from '@stardust-collective/dag4';

export interface FixedAgent {
  /** Agent index (0-25), matches participant_N where N = index + 1 */
  index: number;
  /** Canonical participant name from metagraph test suite */
  name: string;
  /** Platform for agent identity registration */
  platform: 'twitter' | 'github' | 'discord' | 'telegram';
  /** Private key (hex, 64 chars) */
  privateKey: string;
  /** Public key (hex, with 04 prefix) */
  publicKey: string;
  /** DAG address — matches genesis.csv */
  address: string;
  /** Is this agent an oracle? (first 4) */
  isOracle: boolean;
}

// ---------------------------------------------------------------------------
// Static key table — extracted from participant_N.p12 keystores
// Order: Alice(1) through Zoe(26), matching ParticipantRegistry.all
// ---------------------------------------------------------------------------

const PARTICIPANT_KEYS: readonly string[] = [
  'dcd17b43afb09c9760c956653a7652b2a636ff6b5df1b371703f9c818fb0f32c', // Alice
  'fdba9594ff3d3c4b4ad30a7d6647639b02393f1760e1d8d90fb32d6c3993e2ec', // Bob
  'b828a336f2b459cd9393ee67d3a9bc1f8378ea2b669b33fcbbf5775a2ef978e7', // Charlie
  'e6ce1e6378f4b318b25c003585cd5b0ca2a57b5e68bb1c98faa89bca9505db57', // Dave
  '376ea46c60c141eb9e7620d9f5fe1c086793380ca7e1c5d07468a66f122eb54f', // Eve
  '9de2852caac1c64307bc563ff410c2d54b5dca1cc211fcb5171f8f9f40c2b3db', // Faythe
  '3ba97dea568d18603933bdae371de2bfa50f8eeb50e2238ba5ab96acf4fbb4c7', // Grace
  'f3ca51962c5fc6f0a1ec6ab40da4e212ffa38b37f11b0fd8e170337572fe4496', // Heidi
  'a23e5ac182247ae79dae9cfa4f615d78e068637ba0562898d8c9c6f4f2923211', // Ivan
  '5f5c269bc6ea1602f4293d04d7c277b58f282a515d7839924f395ecd0630d519', // Judy
  '4fa85568714492734696b9fa4d22c8bfffc1d6d9ef97630b81c59b7dadc2b035', // Karl
  '4bbecd6457a8b2b7ad8fb165218e4ed659118ae1a89a5d4e1192b39bcdd07781', // Lance
  '94bf301d2d666ecb10fe467db8ae86297ecfb6a321b2ced32354feeb33ebaa56', // Mallory
  'bdefbe82823eb44b69cae889e018d01a7b48df5b80d07b46121a2af78d543745', // Niaj
  'ebbc636d03e88033487c5651c37dade15be08d3c09b32b1a773de91e6386b745', // Oscar
  'd4a4d408c91f14739acb8504b554e2e5ea8cc2d9362f2928d4c71711908177ea', // Peggy
  'aa6e0045c66014c70bc2d2e9f0d3df991e1a4ba615dd4839ee3277f3a84ad314', // Quentin
  '92388d80edb57f57f5381306c73b86dc4977bc01f5e2fe17868cf3cb38100830', // Ruth
  'b7f649632a7a4ddcfa32fb08216f216d8ded39873afbc8e4a346a7e6f87e8328', // Sybil
  '0ae40866efea18630b7ec6150bddda65dc95f8e619a03db3e8d8969340c7da31', // Trent
  '46d11c17152fc463f0b4fcf4c27b076297af74980caa0e6578453aa0a4e2853e', // Ursula
  '5293c45eab6ef3be3ac2344a0b6a7de4a8a7095287c03f224c7ac2fb7cc6d675', // Victor
  'a88c0dc1485a85cd46efca8f99ca9d9868189e9fc17d2558f1d9c5c0b154ca5d', // Walter
  'a4c0e1f09d7e9a85e786536fdb7185be386ba1d9927279a7ebe0bac960a65007', // Xavier
  'd02ad386c4fb67499b5b91cd4b6641a5dbee8987524dd792ec168e4cef782c40', // Yolanda
  '67d53f2771f3560a701aaf200209bf0f8d2c124a156233e5077621e1c169341e', // Zoe
] as const;

// Canonical names matching Participant sealed trait in Scala
const PARTICIPANT_NAMES = [
  'Alice', 'Bob', 'Charlie', 'Dave', 'Eve', 'Faythe',
  'Grace', 'Heidi', 'Ivan', 'Judy', 'Karl', 'Lance',
  'Mallory', 'Niaj', 'Oscar', 'Peggy', 'Quentin', 'Ruth',
  'Sybil', 'Trent', 'Ursula', 'Victor', 'Walter', 'Xavier',
  'Yolanda', 'Zoe',
] as const;

const PLATFORMS = ['twitter', 'github', 'discord', 'telegram'] as const;

// ---------------------------------------------------------------------------
// Pool generation (cached — same result every call)
// ---------------------------------------------------------------------------

let _pool: FixedAgent[] | null = null;

/**
 * Derive keypair from private key using dag4.
 */
function deriveKeypair(privateKey: string): { publicKey: string; address: string } {
  const publicKey = dag4.keyStore.getPublicKeyFromPrivate(privateKey, false);
  const normalizedPubKey = publicKey.length === 128 ? '04' + publicKey : publicKey;
  const address = dag4.keyStore.getDagAddressFromPublicKey(normalizedPubKey);
  return { publicKey: normalizedPubKey, address };
}

/**
 * Get the fixed pool of 26 canonical participants.
 *
 * Deterministic: addresses match genesis.csv exactly.
 * First 4 (Alice, Bob, Charlie, Dave) are designated oracles.
 */
export function generateFixedAgentPool(): FixedAgent[] {
  if (_pool) return _pool;

  _pool = PARTICIPANT_KEYS.map((privateKey, i) => {
    const { publicKey, address } = deriveKeypair(privateKey);
    return {
      index: i,
      name: PARTICIPANT_NAMES[i],
      platform: PLATFORMS[i % PLATFORMS.length],
      privateKey,
      publicKey,
      address,
      isOracle: i < 4,
    };
  });

  return _pool;
}

/** Get agent by index */
export function getAgentByIndex(index: number): FixedAgent | undefined {
  if (index < 0 || index >= 26) return undefined;
  return generateFixedAgentPool()[index];
}

/** Get agent by DAG address */
export function getAgentByAddress(address: string): FixedAgent | undefined {
  return generateFixedAgentPool().find(a => a.address === address);
}

/** Get all oracle agents (first 4) */
export function getOracleAgents(): FixedAgent[] {
  return generateFixedAgentPool().filter(a => a.isOracle);
}

/** Get all non-oracle agents (5-26) */
export function getRegularAgents(): FixedAgent[] {
  return generateFixedAgentPool().filter(a => !a.isOracle);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (process.argv[1]?.endsWith('agents.ts') || process.argv[1]?.endsWith('agents.js')) {
  const command = process.argv[2];

  switch (command) {
    case 'list': {
      const pool = generateFixedAgentPool();
      console.log('\n🔑 Canonical Participant Pool (26 agents)\n');
      console.log('Idx  Name        Platform   Oracle  Address');
      console.log('───  ──────────  ─────────  ──────  ────────────────────────────────────────────');
      for (const agent of pool) {
        const oracleFlag = agent.isOracle ? '  ✓   ' : '      ';
        console.log(
          `${String(agent.index).padStart(2)}   ${agent.name.padEnd(10)}  ${agent.platform.padEnd(9)}  ${oracleFlag}  ${agent.address}`
        );
      }
      console.log('\n');
      break;
    }

    case 'verify': {
      const pool = generateFixedAgentPool();
      // Expected addresses from genesis.csv
      const genesis = [
        'DAG6HdXmFyEwgKKdaEyAjU6SJPxGNAjUSbHgiRct','DAG7W5afpD7RRszc5zT8GySJMEUyTR2s7ezXc9z9',
        'DAG7Ey8rYLpaSCYk89Rqxp6hcAutUfhKo3MAQCTf','DAG8H7iqqqkq2CjVvweM4RBh3LHy2z7v285MnH4k',
        'DAG8zRen4wupjnvVpz1cg18z8xcg3w1g1qFuq3u5','DAG8GWFnGBv1gwhgJB9buPerFRTGgD9JE8845NJv',
        'DAG6qWVAbG8JjQ5Pa8Si6RQWDWus6eqWxevjGdXp','DAG7k57hwDRrWcTm5GbTZ8QowA5N994h9AvzJXjD',
        'DAG2uzDvxjmJUgMhZ2GEiV3PepQ8B5t8rcvZCu48','DAG2BAUcXKujRhzk4XZ6RDYL2ifXWMgfw1v7YxZu',
        'DAG3qjH8kHTHcuj9TCNPxJysvJg3butLAoM2611u','DAG3UyH1L8arBRiSMFBg2y6sJQPTaq2A1SHt1MrG',
        'DAG67iYv2JRfAKCaxuEcakTPVocJfLaCSASqFv33','DAG7be17G7oXKDWtcSLMwqi83UzHVwNSR1U5oyG2',
        'DAG6PCmg1uE3af2byfvnBYGBGJwe9fHdKd5sDHY4','DAG8X3S5HZV8zr8Ce2hANtS5E581TxpGN8JHELzo',
        'DAG4vzEkArWGBtQqGJsnxotyxsaEH9fXsYnmF76P','DAG6qfzTgyBhnfCtur4bKS5Wu58SZqZBXyVCYu2d',
        'DAG4vjfRzqQwy1TvkwNct7TdKma9tKrsuhp1v58y','DAG35jxr6cTWeofVyT27DEANzSWPLvEZikBURT1S',
        'DAG3ZgK96aqCENHtHD5tsiKaYHY8VY98cd62b4fy','DAG0wv8gAEnhwvF8xns5Pvu5CJzyfUYVqigEJ1WU',
        'DAG0xzh5wFzPUh1YnHSDxrQzUxEcXwgGA3dwwhAk','DAG5FTzci6JbDgqrhpGQAakQBxr8bccPA1BcV8ix',
        'DAG8Q6b6HUiG8oMJ5CcN1KW7bSJWta3QKyEAxc8N','DAG8a3BV4YvGYgnL6wMF6Lc6mx37EtbRG9PQYGRs',
      ];
      let ok = true;
      for (let i = 0; i < 26; i++) {
        if (pool[i].address !== genesis[i]) {
          console.log(`❌ ${pool[i].name}: ${pool[i].address} !== ${genesis[i]}`);
          ok = false;
        }
      }
      console.log(ok ? '✅ All 26 addresses match genesis.csv' : '❌ Some addresses mismatched');
      break;
    }

    default:
      console.log(`
🔑 Canonical Participant Pool

Usage:
  npx tsx src/agents.ts list      List all 26 agents with addresses
  npx tsx src/agents.ts verify    Verify addresses match genesis.csv
`);
  }
}
