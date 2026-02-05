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
  // Contract Operations
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
  // Metagraph State Queries (direct to ML0)
  // ==========================================================================

  async getCheckpoint(): Promise<{
    ordinal: number;
    state: {
      stateMachines: Record<string, unknown>;
      scriptOracles: Record<string, unknown>;
    };
  }> {
    const url = `${this.ml0Url}/data-application/v1/checkpoint`;
    const res = await fetch(url, { signal: AbortSignal.timeout(this.timeout) });
    if (!res.ok) {
      throw new Error(`ML0 checkpoint failed: ${res.status}`);
    }
    return res.json();
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

    return res.json();
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

    return res.json();
  }
}
