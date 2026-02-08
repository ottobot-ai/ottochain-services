/**
 * Indexer Client
 * 
 * HTTP client for querying the OttoChain indexer to verify transaction processing
 * and check for rejections before proceeding with next transitions.
 */

export interface IndexerConfig {
  indexerUrl: string;
  timeoutMs?: number;
}

export interface IndexerStatus {
  lastIndexedOrdinal: number | null;
  lastConfirmedOrdinal: number | null;
  totalFibers: number;
  totalRejections: number;
}

export interface IndexedFiber {
  fiberId: string;
  workflowType: string;
  currentState: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'FAILED';
  sequenceNumber: number;
  updatedOrdinal: number;
  updatedGl0Ordinal: number | null;
}

export interface FiberTransition {
  id: number;
  fiberId: string;
  eventName: string;
  fromState: string;
  toState: string;
  success: boolean;
  snapshotOrdinal: number;
  gl0Ordinal: number | null;
  createdAt: string;
}

export interface RejectedTransaction {
  id: number;
  ordinal: number;
  timestamp: string;
  updateType: string;
  fiberId: string;
  updateHash: string;
  errors: Array<{ code: string; message: string }>;
  signers: string[];
  createdAt: string;
}

export interface FiberVerification {
  found: boolean;
  fiber: IndexedFiber | null;
  lastTransition: FiberTransition | null;
  rejections: RejectedTransaction[];
  hasUnprocessedRejection: boolean;
}

export class IndexerClient {
  private baseUrl: string;
  private timeout: number;

  constructor(config: IndexerConfig) {
    this.baseUrl = config.indexerUrl.replace(/\/$/, '');
    this.timeout = config.timeoutMs ?? 10000;
  }

  // ==========================================================================
  // Status
  // ==========================================================================

  async getStatus(): Promise<IndexerStatus> {
    const res = await this.get<IndexerStatus>('/status');
    return res;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000)
      });
      const data = await res.json() as { status: string };
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Fiber Queries
  // ==========================================================================

  async getFiber(fiberId: string): Promise<IndexedFiber | null> {
    try {
      const res = await this.get<IndexedFiber>(`/fibers/${fiberId}`);
      return res;
    } catch (err) {
      if ((err as Error).message.includes('404')) {
        return null;
      }
      throw err;
    }
  }

  async getFiberTransitions(fiberId: string, limit: number = 10): Promise<FiberTransition[]> {
    try {
      const res = await this.get<{ transitions: FiberTransition[] }>(
        `/fibers/${fiberId}/transitions?limit=${limit}`
      );
      return res.transitions ?? [];
    } catch {
      return [];
    }
  }

  // ==========================================================================
  // Rejection Queries
  // ==========================================================================

  async getFiberRejections(fiberId: string, limit: number = 10): Promise<RejectedTransaction[]> {
    try {
      const res = await this.get<{ rejections: RejectedTransaction[] }>(
        `/fibers/${fiberId}/rejections?limit=${limit}`
      );
      return res.rejections ?? [];
    } catch {
      return [];
    }
  }

  async hasRecentRejection(fiberId: string, sinceOrdinal?: number): Promise<boolean> {
    const rejections = await this.getFiberRejections(fiberId, 5);
    if (rejections.length === 0) return false;
    
    if (sinceOrdinal !== undefined) {
      return rejections.some(r => r.ordinal >= sinceOrdinal);
    }
    return true;
  }

  // ==========================================================================
  // Verification (Combined Queries)
  // ==========================================================================

  /**
   * Verify a fiber's state in the indexer
   * Returns comprehensive status including last transition and any rejections
   */
  async verifyFiber(fiberId: string): Promise<FiberVerification> {
    const [fiber, transitions, rejections] = await Promise.all([
      this.getFiber(fiberId),
      this.getFiberTransitions(fiberId, 1),
      this.getFiberRejections(fiberId, 5),
    ]);

    // Check if there are rejections newer than the last successful transition
    const lastTransition = transitions[0] ?? null;
    const lastTransitionOrdinal = lastTransition?.snapshotOrdinal ?? 0;
    const hasUnprocessedRejection = rejections.some(r => r.ordinal > lastTransitionOrdinal);

    return {
      found: fiber !== null,
      fiber,
      lastTransition,
      rejections,
      hasUnprocessedRejection,
    };
  }

  /**
   * Wait for a fiber to appear in the indexer
   * Polls until found or timeout
   */
  async waitForFiber(
    fiberId: string,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<{ found: boolean; fiber: IndexedFiber | null }> {
    const timeout = options.timeoutMs ?? 30000;
    const pollInterval = options.pollIntervalMs ?? 2000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const fiber = await this.getFiber(fiberId);
      if (fiber) {
        return { found: true, fiber };
      }
      await this.sleep(pollInterval);
    }

    return { found: false, fiber: null };
  }

  /**
   * Wait for a fiber to reach a specific state in the indexer
   */
  async waitForState(
    fiberId: string,
    expectedState: string,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<{ found: boolean; fiber: IndexedFiber | null; actualState: string | null }> {
    const timeout = options.timeoutMs ?? 30000;
    const pollInterval = options.pollIntervalMs ?? 2000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const fiber = await this.getFiber(fiberId);
      if (fiber) {
        if (fiber.currentState === expectedState) {
          return { found: true, fiber, actualState: fiber.currentState };
        }
        // Found but wrong state - keep polling
      }
      await this.sleep(pollInterval);
    }

    // Final check
    const fiber = await this.getFiber(fiberId);
    return { 
      found: fiber?.currentState === expectedState, 
      fiber, 
      actualState: fiber?.currentState ?? null 
    };
  }

  /**
   * Wait for indexer to process up to a specific ML0 ordinal
   */
  async waitForOrdinal(
    targetOrdinal: number,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<{ reached: boolean; currentOrdinal: number | null }> {
    const timeout = options.timeoutMs ?? 60000;
    const pollInterval = options.pollIntervalMs ?? 3000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const status = await this.getStatus();
      if (status.lastIndexedOrdinal !== null && status.lastIndexedOrdinal >= targetOrdinal) {
        return { reached: true, currentOrdinal: status.lastIndexedOrdinal };
      }
      await this.sleep(pollInterval);
    }

    const status = await this.getStatus();
    return { reached: false, currentOrdinal: status.lastIndexedOrdinal };
  }

  // ==========================================================================
  // Internal Helpers
  // ==========================================================================

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`Indexer GET ${path} failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<T>;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
