// Bridge HTTP Client
// Provides typed interface for calling Bridge service endpoints

import { getConfig } from './config.js';

export interface BridgeResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface BridgeRegisterAgentRequest {
  privateKey: string;
  displayName?: string;
  platform?: string;
  platformUserId?: string;
}

export interface BridgeRegisterAgentResponse {
  fiberId: string;
  address: string;
  hash: string;
  message: string;
}

export interface BridgeVouchRequest {
  privateKey: string;
  targetFiberId: string;
  fromAddress?: string;
  reason?: string;
}

export interface BridgeVouchResponse {
  hash: string;
  event: string;
  targetFiberId: string;
  from: string;
}

export interface BridgeProposeContractRequest {
  privateKey: string;
  counterpartyAddress: string;
  terms: Record<string, unknown>;
  title?: string;
  description?: string;
}

export interface BridgeProposeContractResponse {
  contractId: string;
  hash: string;
  proposer: string;
  counterparty: string;
}

export interface BridgeContractActionRequest {
  privateKey: string;
  contractId: string;
  proof?: string;
  reason?: string;
}

export interface BridgeContractActionResponse {
  hash: string;
  contractId: string;
  action: string;
}

class BridgeClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = getConfig().BRIDGE_URL;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<BridgeResponse<T>> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        return {
          success: false,
          error: (data.error as string) || `Bridge returned ${response.status}`,
        };
      }

      return { success: true, data: data as T };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Bridge request failed',
      };
    }
  }

  // Agent endpoints
  async registerAgent(req: BridgeRegisterAgentRequest): Promise<BridgeResponse<BridgeRegisterAgentResponse>> {
    return this.request<BridgeRegisterAgentResponse>('POST', '/agent/register', req);
  }

  async activateAgent(privateKey: string, fiberId: string): Promise<BridgeResponse<{ hash: string; fiberId: string; status: string }>> {
    return this.request('POST', '/agent/activate', { privateKey, fiberId });
  }

  async vouch(req: BridgeVouchRequest): Promise<BridgeResponse<BridgeVouchResponse>> {
    return this.request<BridgeVouchResponse>('POST', '/agent/vouch', req);
  }

  async getAgent(fiberId: string): Promise<BridgeResponse<unknown>> {
    return this.request('GET', `/agent/${fiberId}`);
  }

  // Contract endpoints
  async proposeContract(req: BridgeProposeContractRequest): Promise<BridgeResponse<BridgeProposeContractResponse>> {
    return this.request<BridgeProposeContractResponse>('POST', '/contract/propose', req);
  }

  async acceptContract(req: BridgeContractActionRequest): Promise<BridgeResponse<BridgeContractActionResponse>> {
    return this.request<BridgeContractActionResponse>('POST', '/contract/accept', req);
  }

  async completeContract(req: BridgeContractActionRequest): Promise<BridgeResponse<BridgeContractActionResponse>> {
    return this.request<BridgeContractActionResponse>('POST', '/contract/complete', req);
  }

  async rejectContract(req: BridgeContractActionRequest): Promise<BridgeResponse<BridgeContractActionResponse>> {
    return this.request<BridgeContractActionResponse>('POST', '/contract/reject', req);
  }

  async disputeContract(req: BridgeContractActionRequest): Promise<BridgeResponse<BridgeContractActionResponse>> {
    return this.request<BridgeContractActionResponse>('POST', '/contract/dispute', req);
  }

  // Health check
  async health(): Promise<BridgeResponse<{ status: string; service: string }>> {
    return this.request('GET', '/health');
  }
}

// Singleton instance
let bridgeClient: BridgeClient | null = null;

export function getBridgeClient(): BridgeClient {
  if (!bridgeClient) {
    bridgeClient = new BridgeClient();
  }
  return bridgeClient;
}

export { BridgeClient };
