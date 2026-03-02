/**
 * Shared utility: submit a DL1 transaction and wait for it to appear on ML0.
 * Resubmits if the fiber hasn't appeared after ORDINALS_BEFORE_RETRY snapshot cycles.
 */
import { batchSign, HttpClient } from '@ottochain/sdk';

const DEFAULT_ML0_URL = process.env.ML0_URL || 'http://localhost:9200';
const DEFAULT_DL1_URL = process.env.DL1_URL || 'http://localhost:9400';
const SUBMIT_MAX_RETRIES = parseInt(process.env.SUBMIT_MAX_RETRIES || '3');
const ORDINALS_BEFORE_RETRY = parseInt(process.env.ORDINALS_BEFORE_RETRY || '2');
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '2000');

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function getML0Ordinal(ml0Url: string): Promise<number> {
  try {
    const res = await fetch(`${ml0Url}/snapshots/latest`);
    if (!res.ok) {
      console.warn(`  [submit] ⚠ ML0 returned ${res.status} for /snapshots/latest`);
      return -1;
    }
    const data = await res.json() as { value?: { ordinal?: number } };
    return data?.value?.ordinal ?? 0;
  } catch (err) {
    console.warn(`  [submit] ⚠ ML0 unreachable: ${(err as Error).message}`);
    return -1;
  }
}

export interface SubmitOptions {
  /** The update message (e.g. { CreateStateMachine: {...} }) */
  message: Record<string, unknown>;
  /** Private keys to sign with */
  privateKeys: string[];
  /** Fiber ID to poll for on ML0 */
  fiberId: string;
  /** ML0 URL (default: ML0_URL env or localhost:9200) */
  ml0Url?: string;
  /** DL1 URL (default: DL1_URL env or localhost:9400) */
  dl1Url?: string;
  /** Whether to wait for ML0 confirmation (default: true) */
  waitForML0?: boolean;
}

export interface SubmitResult {
  hash: string;
  attempt: number;
  ml0Confirmed: boolean;
}

/**
 * Submit a signed transaction to DL1 with ordinal-aware retry.
 * After each submission, polls ML0 for the fiber. If it hasn't appeared
 * after ORDINALS_BEFORE_RETRY snapshot cycles, resubmits (up to SUBMIT_MAX_RETRIES).
 */
export async function submitWithRetry(opts: SubmitOptions): Promise<SubmitResult> {
  const ml0Url = opts.ml0Url || DEFAULT_ML0_URL;
  const dl1Url = opts.dl1Url || DEFAULT_DL1_URL;
  const waitForML0 = opts.waitForML0 !== false;
  const client = new HttpClient(dl1Url);

  let lastHash = '';

  for (let attempt = 1; attempt <= SUBMIT_MAX_RETRIES; attempt++) {
    const startOrdinal = await getML0Ordinal(ml0Url);
    console.log(`  [submit] Attempt ${attempt}/${SUBMIT_MAX_RETRIES} (ML0 ordinal: ${startOrdinal})`);

    const signed = await batchSign(opts.message, opts.privateKeys, { isDataUpdate: true });
    try {
      const result = await client.post<{ hash: string }>('/data', signed);
      lastHash = result.hash;
      console.log(`  [submit] DL1 accepted: ${lastHash.substring(0, 16)}...`);
    } catch (err) {
      const error = err as Error & { response?: string };
      console.log(`  [submit] DL1 rejected: ${error.message}`);
      if (error.response) console.log(`  [submit] Response: ${error.response}`);
      throw err;
    }

    if (!waitForML0) {
      return { hash: lastHash, attempt, ml0Confirmed: false };
    }

    // Poll ML0 until fiber appears or enough ordinals pass
    const ordinalDeadline = startOrdinal + ORDINALS_BEFORE_RETRY;
    const timeDeadline = Date.now() + 60_000;
    process.stdout.write(`  [submit] Waiting for fiber on ML0 (until ordinal ${ordinalDeadline})...`);

    while (Date.now() < timeDeadline) {
      try {
        const res = await fetch(`${ml0Url}/data-application/v1/state-machines/${opts.fiberId}`);
        if (res.ok) {
          console.log(' confirmed');
          return { hash: lastHash, attempt, ml0Confirmed: true };
        }
      } catch { /* not ready */ }

      const currentOrdinal = await getML0Ordinal(ml0Url);
      if (currentOrdinal < 0) {
        // ML0 unreachable — fall through to time deadline only
        await sleep(POLL_INTERVAL);
        process.stdout.write('!');
        continue;
      }
      if (currentOrdinal >= ordinalDeadline) {
        console.log(` (ordinal ${currentOrdinal} >= ${ordinalDeadline}, resubmitting)`);
        break;
      }
      await sleep(POLL_INTERVAL);
      process.stdout.write('.');
    }
  }

  throw new Error(`Fiber ${opts.fiberId} not on ML0 after ${SUBMIT_MAX_RETRIES} attempts`);
}
