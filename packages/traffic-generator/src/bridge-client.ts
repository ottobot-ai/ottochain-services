/**
 * Bridge Client
 * 
 * HTTP client for interacting with the OttoChain bridge service.
 */

import type { Agent, Contract } from './types.js';

export interface BridgeConfig {
  bridgeUrl: string;
  ml0Url: string;
  timeoutMs?: number;
}

export interface WalletResponse {
  privateKey: string;
  publicKey: string;
  address: string;
}

export interface RegisterResponse {
  fiberId: string;
  address: string;
  hash: string;
}

export interface TransitionResponse {
  hash: string;
  event: string;
  fiberId: string;
}

export interface AgentState {
  stateData: {
    reputation?: number;
    status?: string;
    vouches?: string[];
    completedContracts?: number;
    violations?: number;
  };
  currentState: { value: string };
  sequenceNumber: number;
}

export interface ContractState {
  stateData: {
    proposer?: string;
    counterparty?: string;
    status?: string;
    task?: string;
  };
  currentState: { value: string };
  sequenceNumber: number;
}

export interface SyncStatus {
  ready: boolean;
  allReady?: boolean;
  allHealthy?: boolean;
  gl0?: { nodes: Array<{ name: string; ordinal?: number; state: string }>; fork: boolean; ordinal?: number };
  ml0?: { nodes: Array<{ name: string; ordinal?: number; state: string }>; fork: boolean; ordinal?: number };
  dl1?: { nodes: Array<{ name: string; ordinal?: number; state: string }>; ordinal?: number; lag?: number };
  error?: string;
}

export interface MarketState {
  stateData: {
    marketType?: string;
    creator?: string;
    title?: string;
    status?: string;
    commitments?: Record<string, { amount: number; data: Record<string, unknown> }>;
    totalCommitted?: number;
    oracles?: string[];
    resolutions?: Array<{ oracle: string; outcome: string | number }>;
    deadline?: number;
    threshold?: number;
  };
  currentState: { value: string };
  sequenceNumber: number;
}

export class BridgeClient {
  private baseUrl: string;
  private ml0Url: string;
  private timeout: number;

  constructor(config: BridgeConfig) {
    this.baseUrl = config.bridgeUrl.replace(/\/$/, '');
    this.ml0Url = config.ml0Url.replace(/\/$/, '');
    this.timeout = config.timeoutMs ?? 30000;
  }

  // ==========================================================================
  // Wallet Operations
  // ==========================================================================

  async generateWallet(): Promise<WalletResponse> {
    const res = await this.post<WalletResponse>('/agent/wallet', {});
    return res;
  }

  // ==========================================================================
  // Agent Operations
  // ==========================================================================

  async registerAgent(
    privateKey: string,
    displayName: string,
    platform: string,
    platformUserId: string
  ): Promise<RegisterResponse> {
    return this.post<RegisterResponse>('/agent/register', {
      privateKey,
      displayName,
      platform,
      platformUserId,
    });
  }

  async activateAgent(privateKey: string, fiberId: string): Promise<TransitionResponse> {
    return this.post<TransitionResponse>('/agent/activate', {
      privateKey,
      fiberId,
    });
  }

  async transitionAgent(
    privateKey: string,
    fiberId: string,
    event: string,
    payload: Record<string, unknown> = {}
  ): Promise<TransitionResponse> {
    return this.post<TransitionResponse>('/agent/transition', {
      privateKey,
      fiberId,
      event,
      payload,
    });
  }

  async vouchForAgent(
    privateKey: string,
    targetFiberId: string,
    fromAddress: string,
    reason?: string
  ): Promise<TransitionResponse> {
    return this.post<TransitionResponse>('/agent/vouch', {
      privateKey,
      targetFiberId,
      fromAddress,
      reason,
    });
  }

  async getAgent(fiberId: string): Promise<AgentState | null> {
    try {
      return await this.get<AgentState>(`/agent/${fiberId}`);
    } catch (err) {
      if ((err as Error).message.includes('404')) return null;
      throw err;
    }
  }

  async listAgents(): Promise<{ count: number; agents: Record<string, AgentState> }> {
    return this.get('/agent');
  }

  // ==========================================================================
  // Contract Operations (SDK-compliant)
  // ==========================================================================

  /**
   * Propose a new contract (SDK: ProposeContract)
   * Creates a Contract fiber with PROPOSED state
   */
  async proposeContract(
    privateKey: string,
    counterpartyAddress: string,
    terms: Record<string, unknown>,
    options?: { title?: string; description?: string }
  ): Promise<{ contractId: string; proposer: string; counterparty: string; hash: string }> {
    return this.post('/contract/propose', {
      privateKey,
      counterpartyAddress,
      terms,
      title: options?.title,
      description: options?.description,
    });
  }

  /**
   * Accept a contract (SDK: AcceptContract)
   * Counterparty only - transitions PROPOSED → ACTIVE
   */
  async acceptContract(
    privateKey: string,
    contractId: string
  ): Promise<{ hash: string; contractId: string; status: string }> {
    return this.post('/contract/accept', {
      privateKey,
      contractId,
    });
  }

  /**
   * Reject a contract
   * Counterparty only - transitions PROPOSED → REJECTED
   */
  async rejectContract(
    privateKey: string,
    contractId: string,
    reason?: string
  ): Promise<{ hash: string; contractId: string; status: string }> {
    return this.post('/contract/reject', {
      privateKey,
      contractId,
      reason,
    });
  }

  /**
   * Submit completion proof (SDK: CompleteContract)
   * Either party - records completion, both must complete to finalize
   */
  async submitCompletion(
    privateKey: string,
    contractId: string,
    proof?: string
  ): Promise<{ hash: string; contractId: string; message: string }> {
    return this.post('/contract/complete', {
      privateKey,
      contractId,
      proof,
    });
  }

  /**
   * Finalize a contract
   * Transitions ACTIVE → COMPLETED after both parties submit completion
   */
  async finalizeContract(
    privateKey: string,
    contractId: string
  ): Promise<{ hash: string; contractId: string; status: string }> {
    return this.post('/contract/finalize', {
      privateKey,
      contractId,
    });
  }

  /**
   * Dispute a contract
   * Either party - transitions ACTIVE → DISPUTED
   */
  async disputeContract(
    privateKey: string,
    contractId: string,
    reason: string
  ): Promise<{ hash: string; contractId: string; status: string }> {
    return this.post('/contract/dispute', {
      privateKey,
      contractId,
      reason,
    });
  }

  /**
   * Get contract state by ID
   */
  async getContract(contractId: string): Promise<ContractState | null> {
    try {
      return await this.get<ContractState>(`/contract/${contractId}`);
    } catch (err) {
      if ((err as Error).message.includes('404')) return null;
      throw err;
    }
  }

  /**
   * List all contracts
   */
  async listContracts(): Promise<{ count: number; contracts: Record<string, ContractState> }> {
    return this.get('/contract');
  }

  // Legacy method for backward compatibility
  async transitionContract(
    privateKey: string,
    fiberId: string,
    event: string,
    payload: Record<string, unknown> = {}
  ): Promise<TransitionResponse> {
    return this.post<TransitionResponse>('/contract/transition', {
      privateKey,
      fiberId,
      event,
      payload,
    });
  }

  // ==========================================================================
  // Market Operations
  // ==========================================================================

  /**
   * Create a new market fiber with the given definition and initial data.
   */
  async createMarket(
    privateKey: string,
    definition: Record<string, unknown>,
    initialData: Record<string, unknown>
  ): Promise<{ fiberId: string; hash: string }> {
    return this.createFiber(privateKey, definition, initialData);
  }

  /**
   * Submit a commitment (stake/bid/pledge/order) to an open market.
   */
  async commitToMarket(
    privateKey: string,
    fiberId: string,
    amount: number,
    data: Record<string, unknown> = {}
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'commit', {
      agent: '', // Will be filled by bridge from privateKey
      amount,
      data,
    });
  }

  /**
   * Open a market for participation (creator only).
   */
  async openMarket(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'open', {
      agent: '', // Will be filled by bridge from privateKey
    });
  }

  /**
   * Close a market for new commitments (creator or deadline).
   */
  async closeMarket(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'close', {
      agent: '', // Will be filled by bridge from privateKey
    });
  }

  /**
   * Submit a resolution (oracle or creator).
   */
  async submitResolution(
    privateKey: string,
    fiberId: string,
    outcome: string | number,
    proof?: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'submit_resolution', {
      agent: '', // Will be filled by bridge from privateKey
      outcome,
      proof,
    });
  }

  /**
   * Finalize a market after quorum is reached.
   */
  async finalizeMarket(
    privateKey: string,
    fiberId: string,
    outcome: string | number,
    settlement: Record<string, unknown> = {}
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'finalize', {
      outcome,
      settlement,
    });
  }

  /**
   * Cancel a market (creator only, from PROPOSED state).
   */
  async cancelMarket(
    privateKey: string,
    fiberId: string,
    reason?: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'cancel', {
      agent: '', // Will be filled by bridge from privateKey
      reason,
    });
  }

  /**
   * Trigger a refund (threshold not met or dispute).
   */
  async refundMarket(
    privateKey: string,
    fiberId: string,
    reason?: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'refund', {
      agent: '', // Will be filled by bridge from privateKey
      reason,
    });
  }

  /**
   * Claim winnings/rewards after settlement.
   */
  async claimFromMarket(
    privateKey: string,
    fiberId: string,
    amount: number
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'claim', {
      agent: '', // Will be filled by bridge from privateKey
      amount,
    });
  }

  /**
   * Get market state by fiber ID.
   */
  async getMarket(fiberId: string): Promise<MarketState | null> {
    try {
      return await this.get<MarketState>(`/fiber/${fiberId}`);
    } catch (err) {
      if ((err as Error).message.includes('404')) return null;
      throw err;
    }
  }

  /**
   * List all markets.
   */
  async listMarkets(limit = 100): Promise<{
    count: number;
    fibers: Array<{
      fiberId: string;
      currentState?: string;
      stateData?: Record<string, unknown>;
    }>;
  }> {
    return this.listFibers('Market', limit);
  }

  // ==========================================================================
  // Generic Fiber Operations (for all workflow types)
  // ==========================================================================

  async createFiber(
    privateKey: string,
    definition: Record<string, unknown>,
    initialData: Record<string, unknown>,
    options?: { fiberId?: string; parentFiberId?: string }
  ): Promise<{ fiberId: string; hash: string; schema?: string }> {
    return this.post('/fiber/create', {
      privateKey,
      definition,
      initialData,
      fiberId: options?.fiberId,
      parentFiberId: options?.parentFiberId,
    });
  }

  async transitionFiber(
    privateKey: string,
    fiberId: string,
    event: string,
    payload: Record<string, unknown> = {},
    targetSequenceNumber?: number
  ): Promise<TransitionResponse> {
    return this.post<TransitionResponse>('/fiber/transition', {
      privateKey,
      fiberId,
      event,
      payload,
      targetSequenceNumber,
    });
  }

  async batchTransition(
    transitions: Array<{
      privateKey: string;
      fiberId: string;
      event: string;
      payload?: Record<string, unknown>;
    }>
  ): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    successes: Array<{ fiberId: string; event: string; hash: string }>;
    failures: Array<{ index: number; fiberId: string; error: string }>;
  }> {
    return this.post('/fiber/batch', { transitions });
  }

  async getFiber(fiberId: string): Promise<unknown | null> {
    try {
      return await this.get(`/fiber/${fiberId}`);
    } catch (err) {
      if ((err as Error).message.includes('404')) return null;
      throw err;
    }
  }

  async listFibers(
    schema?: string,
    limit = 100
  ): Promise<{
    count: number;
    fibers: Array<{
      fiberId: string;
      schema?: string;
      currentState?: string;
      stateData?: Record<string, unknown>;
    }>;
  }> {
    const params = new URLSearchParams();
    if (schema) params.set('schema', schema);
    params.set('limit', limit.toString());
    return this.get(`/fiber?${params.toString()}`);
  }

  // ==========================================================================
  // Metagraph State Queries (direct to ML0)
  // ==========================================================================

  async getCheckpoint(): Promise<{
    ordinal: number;
    state: {
      stateMachines: Record<string, unknown>;
      scripts: Record<string, unknown>;
    };
  }> {
    const url = `${this.ml0Url}/data-application/v1/checkpoint`;
    const res = await fetch(url, { signal: AbortSignal.timeout(this.timeout) });
    if (!res.ok) {
      throw new Error(`ML0 checkpoint failed: ${res.status}`);
    }
    return res.json() as Promise<{
      ordinal: number;
      state: {
        stateMachines: Record<string, unknown>;
        scripts: Record<string, unknown>;
      };
    }>;
  }

  async getStateMachine(fiberId: string): Promise<unknown | null> {
    try {
      const url = `${this.ml0Url}/data-application/v1/state-machines/${fiberId}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(this.timeout) });
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`ML0 query failed: ${res.status}`);
      }
      return res.json();
    } catch (err) {
      if ((err as Error).message.includes('404')) return null;
      throw err;
    }
  }

  // ==========================================================================
  // Sync Status (Monitor API)
  // ==========================================================================

  /**
   * Check network sync status from monitor service
   * Returns { ready, allReady, allHealthy, gl0, ml0, dl1 }
   */
  async checkSyncStatus(monitorUrl?: string): Promise<SyncStatus> {
    const url = monitorUrl ?? process.env.MONITOR_URL ?? 'http://localhost:3032';
    try {
      const res = await fetch(`${url}/api/sync-status`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!res.ok) {
        throw new Error(`Monitor sync-status failed: ${res.status}`);
      }

      return res.json() as Promise<SyncStatus>;
    } catch (err) {
      // Return not-ready if monitor is unavailable
      return {
        ready: false,
        allReady: false,
        allHealthy: false,
        error: (err as Error).message,
      };
    }
  }

  // ==========================================================================
  // HTTP Helpers
  // ==========================================================================

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GET ${path} failed: ${res.status} ${text}`);
    }

    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST ${path} failed: ${res.status} ${text}`);
    }

    return res.json() as Promise<T>;
  }
}
