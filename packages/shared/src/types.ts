// Shared types for OttoChain services

import { z } from 'zod';
import {
  AgentState as SdkAgentState,
  Platform as SdkPlatform,
  AttestationType as SdkAttestationType,
  ContractState as SdkContractState,
} from '@ottochain/sdk';

// Helper to extract string keys from TypeScript numeric enums
const enumStringKeys = <T extends Record<string, string | number>>(e: T) =>
  Object.keys(e).filter((k) => isNaN(Number(k))) as [string, ...string[]];

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

// ============================================================================
// Rejection Webhook Types (from ML0 validation failures)
// ============================================================================

export const ValidationErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export type ValidationError = z.infer<typeof ValidationErrorSchema>;

export const RejectedUpdateSchema = z.object({
  updateType: z.string(),
  fiberId: z.string().uuid(),
  targetSequenceNumber: z.number().optional(),
  errors: z.array(ValidationErrorSchema),
  signers: z.array(z.string()),
  updateHash: z.string(),
});

export type RejectedUpdate = z.infer<typeof RejectedUpdateSchema>;

export const RejectionNotificationSchema = z.object({
  event: z.literal('transaction.rejected'),
  ordinal: z.number(),
  timestamp: z.string().datetime(),
  metagraphId: z.string(),
  rejection: RejectedUpdateSchema,
});

export type RejectionNotification = z.infer<typeof RejectionNotificationSchema>;

export const WebhookSubscriptionSchema = z.object({
  callbackUrl: z.string().url(),
  secret: z.string().optional(), // For HMAC verification
});

export type WebhookSubscription = z.infer<typeof WebhookSubscriptionSchema>;

// ============================================================================
// Agent Types (derived from SDK protobuf enums)
// ============================================================================

export const AgentStateSchema = z.enum(enumStringKeys(SdkAgentState));
export type AgentState = z.infer<typeof AgentStateSchema>;

export const PlatformSchema = z.enum(enumStringKeys(SdkPlatform));
export type Platform = z.infer<typeof PlatformSchema>;

export const AttestationTypeSchema = z.enum(enumStringKeys(SdkAttestationType));
export type AttestationType = z.infer<typeof AttestationTypeSchema>;

export const ContractStateSchema = z.enum(enumStringKeys(SdkContractState));
export type ContractState = z.infer<typeof ContractStateSchema>;

// Re-export SDK enums for numeric access when needed
export { SdkAgentState, SdkPlatform, SdkAttestationType, SdkContractState };

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
  status: 'ACTIVE' | 'COMPLETED' | 'Failed';
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
