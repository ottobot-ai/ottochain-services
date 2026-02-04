// Shared types for OttoChain services

import { z } from 'zod';

// ============================================================================
// Snapshot Webhook Types
// ============================================================================

export const SnapshotNotificationSchema = z.object({
  ordinal: z.number(),
  hash: z.string(),
  timestamp: z.string().datetime(),
  agentsUpdated: z.number().optional(),
  contractsUpdated: z.number().optional(),
});

export type SnapshotNotification = z.infer<typeof SnapshotNotificationSchema>;

export const WebhookSubscriptionSchema = z.object({
  callbackUrl: z.string().url(),
  secret: z.string().optional(), // For HMAC verification
});

export type WebhookSubscription = z.infer<typeof WebhookSubscriptionSchema>;

// ============================================================================
// Agent Types
// ============================================================================

export const AgentStateSchema = z.enum(['REGISTERED', 'ACTIVE', 'WITHDRAWN']);
export type AgentState = z.infer<typeof AgentStateSchema>;

export const PlatformSchema = z.enum(['DISCORD', 'TELEGRAM', 'TWITTER', 'GITHUB', 'CUSTOM']);
export type Platform = z.infer<typeof PlatformSchema>;

export const AttestationTypeSchema = z.enum(['COMPLETION', 'VOUCH', 'VIOLATION', 'BEHAVIORAL']);
export type AttestationType = z.infer<typeof AttestationTypeSchema>;

export const ContractStateSchema = z.enum(['PROPOSED', 'ACTIVE', 'COMPLETED', 'REJECTED', 'DISPUTED']);
export type ContractState = z.infer<typeof ContractStateSchema>;

// ============================================================================
// API Request/Response Types
// ============================================================================

export const RegisterAgentRequestSchema = z.object({
  platform: PlatformSchema,
  platformUserId: z.string(),
  platformUsername: z.string().optional(),
  displayName: z.string().optional(),
});

export type RegisterAgentRequest = z.infer<typeof RegisterAgentRequestSchema>;

export const VouchRequestSchema = z.object({
  fromAddress: z.string(),
  toAddress: z.string(),
  reason: z.string().optional(),
  signature: z.string(),
});

export type VouchRequest = z.infer<typeof VouchRequestSchema>;

export const ProposeContractRequestSchema = z.object({
  proposerAddress: z.string(),
  counterpartyAddress: z.string(),
  terms: z.record(z.any()),
  signature: z.string(),
});

export type ProposeContractRequest = z.infer<typeof ProposeContractRequestSchema>;

export const ContractActionRequestSchema = z.object({
  contractId: z.string(),
  agentAddress: z.string(),
  proof: z.string().optional(),
  signature: z.string(),
});

export type ContractActionRequest = z.infer<typeof ContractActionRequestSchema>;

// ============================================================================
// Metagraph Response Types
// ============================================================================

export interface MetagraphFiber {
  id: string;
  kind: 'StateMachine' | 'Script';
  status: 'Active' | 'Completed' | 'Failed';
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MetagraphSnapshot {
  ordinal: number;
  hash: string;
  timestamp: string;
  updates: MetagraphUpdate[];
}

export interface MetagraphUpdate {
  fiberId: string;
  action: string;
  result: 'Success' | 'Failure';
  receipt?: Record<string, unknown>;
}

// ============================================================================
// Utility Types
// ============================================================================

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface TransactionResult {
  success: boolean;
  txHash?: string;
  error?: string;
}
