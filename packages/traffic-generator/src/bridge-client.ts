/**
 * Bridge Client
 * 
 * HTTP client for interacting with the OttoChain bridge service.
 */

import type { Agent, Contract } from './types.js';

export interface BridgeConfig {
  bridgeUrl: string;
  ml0Url: string;
  monitorUrl?: string;
  timeoutMs?: number;
}

export interface SyncStatus {
  ready: boolean;
  allReady: boolean;
  allHealthy: boolean;
  gl0: { nodes: Array<{ name: string; ordinal?: number; state?: string }>; fork: boolean; ordinal?: number };
  ml0: { nodes: Array<{ name: string; ordinal?: number; state?: string }>; fork: boolean; ordinal?: number };
  dl1: { nodes: Array<{ name: string; ordinal?: number; state?: string }>; ordinal?: number; lag?: number };
  timestamp: number;
  error?: string;
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

export class BridgeClient {
  private baseUrl: string;
  private ml0Url: string;
  private monitorUrl: string | null;
  private timeout: number;

  constructor(config: BridgeConfig) {
    this.baseUrl = config.bridgeUrl.replace(/\/$/, '');
    this.ml0Url = config.ml0Url.replace(/\/$/, '');
    this.monitorUrl = config.monitorUrl?.replace(/\/$/, '') ?? null;
    this.timeout = config.timeoutMs ?? 30000;
  }
  
  // ==========================================================================
  // Sync Status (check before sending traffic)
  // ==========================================================================

  async checkSyncStatus(): Promise<SyncStatus> {
    if (!this.monitorUrl) {
      // No monitor configured, assume ready
      return { 
        ready: true, 
        allReady: true, 
        allHealthy: true,
        gl0: { nodes: [], fork: false },
        ml0: { nodes: [], fork: false },
        dl1: { nodes: [] },
        timestamp: Date.now(),
      };
    }
    
    try {
      const res = await fetch(`${this.monitorUrl}/api/sync-status`, {
        signal: AbortSignal.timeout(5000),
      });
      
      if (!res.ok) {
        return { 
          ready: false, 
          allReady: false, 
          allHealthy: false,
          gl0: { nodes: [], fork: false },
          ml0: { nodes: [], fork: false },
          dl1: { nodes: [] },
          timestamp: Date.now(),
          error: `Monitor returned ${res.status}`,
        };
      }
      
      return await res.json() as SyncStatus;
    } catch (err) {
      return { 
        ready: false, 
        allReady: false, 
        allHealthy: false,
        gl0: { nodes: [], fork: false },
        ml0: { nodes: [], fork: false },
        dl1: { nodes: [] },
        timestamp: Date.now(),
        error: String(err),
      };
    }
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
  // Contract Operations (convenience wrappers)
  // ==========================================================================

  async proposeContract(
    privateKey: string,
    counterpartyFiberId: string,
    task: string,
    terms: Record<string, unknown>
  ): Promise<{ fiberId: string; hash: string }> {
    return this.post('/contract/propose', {
      privateKey,
      counterpartyFiberId,
      task,
      terms,
    });
  }

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

  async getContract(fiberId: string): Promise<ContractState | null> {
    try {
      return await this.get<ContractState>(`/contract/${fiberId}`);
    } catch (err) {
      if ((err as Error).message.includes('404')) return null;
      throw err;
    }
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
