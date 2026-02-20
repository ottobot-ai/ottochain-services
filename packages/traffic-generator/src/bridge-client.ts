/**
 * Bridge Client
 * 
 * HTTP client for interacting with the OttoChain bridge service.
 */

import type { Agent, Contract } from './types.js';

export interface BridgeConfig {
  bridgeUrl: string;
  ml0Url: string;
  indexerUrl?: string;
  timeoutMs?: number;
}

export interface RejectionEntry {
  id?: number;
  fiberId: string;
  ordinal?: number;
  timestamp?: string;
  errors: Array<{ code: string; message: string }>;
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
  private indexerUrl: string | undefined;
  private timeout: number;

  constructor(config: BridgeConfig) {
    this.baseUrl = config.bridgeUrl.replace(/\/$/, '');
    this.ml0Url = config.ml0Url.replace(/\/$/, '');
    this.indexerUrl = config.indexerUrl?.replace(/\/$/, '');
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
  // DAO Operations
  // ==========================================================================

  /**
   * Create a new DAO fiber.
   */
  async createDAO(
    privateKey: string,
    daoType: 'token' | 'multisig' | 'threshold',
    initialData: Record<string, unknown>
  ): Promise<{ fiberId: string; hash: string }> {
    const definition = {
      workflowType: 'DAO',
      daoType,
      name: initialData.name || `${daoType} DAO`,
    };
    return this.createFiber(privateKey, definition, initialData);
  }

  /**
   * Propose an action in the DAO.
   */
  async daoPropose(
    privateKey: string,
    fiberId: string,
    proposalId: string,
    proposalData: Record<string, unknown>
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'propose', {
      proposalId,
      ...proposalData,
    });
  }

  /**
   * Vote on a DAO proposal.
   */
  async daoVote(
    privateKey: string,
    fiberId: string,
    vote: string,
    weight?: number
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'vote', {
      vote,
      weight,
    });
  }

  /**
   * Sign a multisig proposal.
   */
  async daoSign(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'sign', {});
  }

  /**
   * Execute a passed DAO proposal.
   */
  async daoExecute(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'execute', {});
  }

  /**
   * Delegate voting power.
   */
  async daoDelegate(
    privateKey: string,
    fiberId: string,
    delegateTo: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'delegate', {
      delegateTo,
    });
  }

  /**
   * Queue a passed proposal for timelock.
   */
  async daoQueue(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'queue', {});
  }

  /**
   * Cancel a proposal.
   */
  async daoCancel(
    privateKey: string,
    fiberId: string,
    reason?: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'cancel', { reason });
  }

  /**
   * Reject a proposal (did not pass).
   */
  async daoReject(
    privateKey: string,
    fiberId: string,
    reason?: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'reject', { reason });
  }

  /**
   * Join a threshold DAO.
   */
  async daoJoin(
    privateKey: string,
    fiberId: string,
    agentReputation: number
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'join', { agentReputation });
  }

  /**
   * Leave a DAO.
   */
  async daoLeave(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'leave', {});
  }

  /**
   * Add a signer to multisig.
   */
  async daoAddSigner(
    privateKey: string,
    fiberId: string,
    newSigner: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'add_signer', { newSigner });
  }

  /**
   * Remove a signer from multisig.
   */
  async daoRemoveSigner(
    privateKey: string,
    fiberId: string,
    removeSigner: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'remove_signer', { removeSigner });
  }

  /**
   * Dissolve a DAO.
   */
  async daoDissolve(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'dissolve', {});
  }

  /**
   * List all DAOs.
   */
  async listDAOs(limit = 100): Promise<{
    count: number;
    fibers: Array<{
      fiberId: string;
      currentState?: string;
      stateData?: Record<string, unknown>;
    }>;
  }> {
    return this.listFibers('DAO', limit);
  }

  // ==========================================================================
  // Governance Operations
  // ==========================================================================

  /**
   * Create a new Governance fiber.
   */
  async createGovernance(
    privateKey: string,
    initialData: Record<string, unknown>
  ): Promise<{ fiberId: string; hash: string }> {
    const definition = {
      workflowType: 'Governance',
      name: initialData.name || 'Governance',
    };
    return this.createFiber(privateKey, definition, initialData);
  }

  /**
   * Add a member to governance.
   */
  async govAddMember(
    privateKey: string,
    fiberId: string,
    member: string,
    role: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'add_member', { member, role });
  }

  /**
   * Remove a member from governance.
   */
  async govRemoveMember(
    privateKey: string,
    fiberId: string,
    member: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'remove_member', { member });
  }

  /**
   * Propose a governance change (rules, parameters, etc.).
   */
  async govPropose(
    privateKey: string,
    fiberId: string,
    proposalId: string,
    type: string,
    changes: Record<string, unknown>
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'propose', {
      proposalId,
      type,
      changes,
    });
  }

  /**
   * Vote on a governance proposal.
   */
  async govVote(
    privateKey: string,
    fiberId: string,
    vote: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'vote', { vote });
  }

  /**
   * Finalize a governance vote.
   */
  async govFinalize(
    privateKey: string,
    fiberId: string,
    forCount: number
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'finalize', { forCount });
  }

  /**
   * Raise a dispute in governance.
   */
  async govRaiseDispute(
    privateKey: string,
    fiberId: string,
    disputeId: string,
    defendant: string,
    claim: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'raise_dispute', {
      disputeId,
      defendant,
      claim,
    });
  }

  /**
   * Submit evidence for a dispute.
   */
  async govSubmitEvidence(
    privateKey: string,
    fiberId: string,
    content: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'submit_evidence', { content });
  }

  /**
   * Resolve a dispute.
   */
  async govResolve(
    privateKey: string,
    fiberId: string,
    ruling: string,
    remedy: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'resolve', { ruling, remedy });
  }

  /**
   * Dissolve governance.
   */
  async govDissolve(
    privateKey: string,
    fiberId: string,
    approvalCount: number
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'dissolve', { approvalCount });
  }

  /**
   * List all governance fibers.
   */
  async listGovernance(limit = 100): Promise<{
    count: number;
    fibers: Array<{
      fiberId: string;
      currentState?: string;
      stateData?: Record<string, unknown>;
    }>;
  }> {
    return this.listFibers('Governance', limit);
  }

  // ==========================================================================
  // Corporate Entity Operations
  // ==========================================================================

  /**
   * Create a new Corporate Entity fiber.
   */
  async createCorporateEntity(
    privateKey: string,
    initialData: Record<string, unknown>
  ): Promise<{ fiberId: string; hash: string }> {
    const definition = {
      workflowType: 'CorporateEntity',
      name: initialData.legalName || 'Corporate Entity',
    };
    return this.createFiber(privateKey, definition, initialData);
  }

  /**
   * Incorporate the entity (state approves articles).
   */
  async corpEntityIncorporate(
    privateKey: string,
    fiberId: string,
    approvalDate: string,
    stateFileNumber: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'incorporate', {
      approvalDate,
      stateFileNumber,
    });
  }

  /**
   * Create a new share class.
   */
  async corpEntityCreateClass(
    privateKey: string,
    fiberId: string,
    classData: {
      classId: string;
      className: string;
      authorized: number;
      parValue: number;
      votingRights: boolean;
      votesPerShare: number;
    }
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'update_share_class', classData);
  }

  /**
   * Issue shares from authorized pool.
   */
  async corpEntityIssueShares(
    privateKey: string,
    fiberId: string,
    classId: string,
    shares: number,
    holderId: string,
    price: number
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'issue_shares', {
      classId,
      shares,
      holderId,
      issuancePrice: price,
    });
  }

  /**
   * Transfer shares between holders.
   */
  async corpEntityTransferShares(
    privateKey: string,
    fiberId: string,
    classId: string,
    shares: number,
    fromHolderId: string,
    toHolderId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'transfer_shares', {
      classId,
      shares,
      fromHolderId,
      toHolderId,
    });
  }

  /**
   * Amend the corporate charter.
   */
  async corpEntityAmendCharter(
    privateKey: string,
    fiberId: string,
    amendmentId: string,
    description: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'amend_charter', {
      amendmentId,
      description,
      effectiveDate: new Date().toISOString().split('T')[0],
    });
  }

  /**
   * Suspend corporate powers.
   */
  async corpEntitySuspend(
    privateKey: string,
    fiberId: string,
    reason: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'suspend', {
      reason,
      suspensionDate: new Date().toISOString().split('T')[0],
    });
  }

  /**
   * Reinstate corporate powers after suspension.
   */
  async corpEntityReinstate(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'reinstate', {
      reinstatementDate: new Date().toISOString().split('T')[0],
      curativeActions: ['Paid outstanding taxes', 'Filed required reports'],
    });
  }

  /**
   * Dissolve the corporate entity.
   */
  async corpEntityDissolve(
    privateKey: string,
    fiberId: string,
    dissolutionType: 'VOLUNTARY' | 'ADMINISTRATIVE'
  ): Promise<TransitionResponse> {
    const event = dissolutionType === 'VOLUNTARY' ? 'dissolve_voluntary' : 'dissolve_administrative';
    return this.transitionFiber(privateKey, fiberId, event, {
      dissolutionDate: new Date().toISOString().split('T')[0],
    });
  }

  // ==========================================================================
  // Corporate Board Operations
  // ==========================================================================

  /**
   * Create a new Corporate Board fiber.
   */
  async createCorporateBoard(
    privateKey: string,
    initialData: Record<string, unknown>
  ): Promise<{ fiberId: string; hash: string }> {
    const definition = {
      workflowType: 'CorporateBoard',
      name: 'Board of Directors',
    };
    return this.createFiber(privateKey, definition, initialData);
  }

  /**
   * Elect a new director to the board.
   */
  async corpBoardElectDirector(
    privateKey: string,
    fiberId: string,
    directorId: string,
    name: string,
    termYears: number,
    isIndependent: boolean
  ): Promise<TransitionResponse> {
    const termStart = new Date().toISOString().split('T')[0];
    const termEnd = new Date(Date.now() + termYears * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return this.transitionFiber(privateKey, fiberId, 'elect_director', {
      directorId,
      name,
      termStart,
      termEnd,
      isIndependent,
      electionResolutionRef: `RES-ELECT-${Date.now().toString(36)}`,
    });
  }

  /**
   * Director resigns from board.
   */
  async corpBoardResignDirector(
    privateKey: string,
    fiberId: string,
    directorId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'resign_director', {
      directorId,
      effectiveDate: new Date().toISOString().split('T')[0],
    });
  }

  /**
   * Call a board meeting.
   */
  async corpBoardCallMeeting(
    privateKey: string,
    fiberId: string,
    meetingId: string,
    type: 'REGULAR' | 'SPECIAL' | 'ANNUAL' | 'ORGANIZATIONAL',
    scheduledDate: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'call_meeting', {
      meetingId,
      type,
      scheduledDate,
      noticeDate: new Date().toISOString().split('T')[0],
      calledBy: 'chairperson',
    });
  }

  /**
   * Open a board meeting.
   */
  async corpBoardOpenMeeting(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'open_meeting', {
      openedAt: new Date().toISOString(),
    });
  }

  /**
   * Pass a board resolution.
   */
  async corpBoardPassResolution(
    privateKey: string,
    fiberId: string,
    resolutionId: string,
    resolutionType: string,
    description: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'pass_resolution', {
      resolutionId,
      resolutionType,
      description,
      passedAt: new Date().toISOString(),
    });
  }

  /**
   * Execute a written consent action (no meeting required).
   */
  async corpBoardWrittenConsent(
    privateKey: string,
    fiberId: string,
    consentId: string,
    description: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'written_consent', {
      consentId,
      description,
      consentDate: new Date().toISOString().split('T')[0],
    });
  }

  /**
   * Adjourn a board meeting.
   */
  async corpBoardAdjourn(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'adjourn', {
      closedAt: new Date().toISOString(),
    });
  }

  // ==========================================================================
  // Corporate Shareholders Operations
  // ==========================================================================

  /**
   * Create a new Corporate Shareholders meeting fiber.
   */
  async createCorporateShareholders(
    privateKey: string,
    initialData: Record<string, unknown>
  ): Promise<{ fiberId: string; hash: string }> {
    const definition = {
      workflowType: 'CorporateShareholders',
      name: 'Shareholder Meeting',
    };
    return this.createFiber(privateKey, definition, initialData);
  }

  /**
   * Set the record date for determining eligible shareholders.
   */
  async corpShareholdersSetRecordDate(
    privateKey: string,
    fiberId: string,
    recordDate: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'set_record_date', {
      recordDate,
      resolutionRef: `RES-RECORD-${Date.now().toString(36)}`,
    });
  }

  /**
   * Register eligible shareholders.
   */
  async corpShareholdersRegister(
    privateKey: string,
    fiberId: string,
    shareholders: Array<{
      shareholderId: string;
      name: string;
      shares: number;
      shareClass: string;
    }>
  ): Promise<TransitionResponse> {
    const totalShares = shareholders.reduce((sum, s) => sum + s.shares, 0);
    return this.transitionFiber(privateKey, fiberId, 'register_eligible_shareholders', {
      shareholders: shareholders.map(s => ({
        shareholderId: s.shareholderId,
        name: s.name,
        shareholdings: [{ shareClass: s.shareClass, shares: s.shares, votes: s.shares }],
      })),
      totalSharesOutstanding: totalShares,
    });
  }

  /**
   * Open proxy solicitation period.
   */
  async corpShareholdersOpenProxy(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'open_proxy_period', {
      startDate: new Date().toISOString().split('T')[0],
      proxyStatementRef: `PROXY-${Date.now().toString(36)}`,
      formOfProxyRef: `FORM-${Date.now().toString(36)}`,
      agenda: [],
    });
  }

  /**
   * Grant proxy to another holder.
   */
  async corpShareholdersGrantProxy(
    privateKey: string,
    fiberId: string,
    grantorId: string,
    proxyHolderId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'grant_proxy', {
      grantorId,
      proxyHolderId,
      grantedAt: new Date().toISOString(),
    });
  }

  /**
   * Open polls for voting.
   */
  async corpShareholdersOpenPolls(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'open_polls', {
      pollsOpenedAt: new Date().toISOString(),
    });
  }

  /**
   * Cast a vote on an agenda item.
   */
  async corpShareholdersCastVote(
    privateKey: string,
    fiberId: string,
    voteId: string,
    agendaItemId: string,
    voteType: string,
    votes: number
  ): Promise<TransitionResponse> {
    const voteData: Record<string, number> = {
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
    };
    if (voteType === 'for') voteData.votesFor = votes;
    else if (voteType === 'against') voteData.votesAgainst = votes;
    else voteData.votesAbstain = votes;

    return this.transitionFiber(privateKey, fiberId, 'cast_vote', {
      voteId,
      agendaItemId,
      ...voteData,
    });
  }

  /**
   * Close polls.
   */
  async corpShareholdersClosePolls(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'close_polls', {
      pollsClosedAt: new Date().toISOString(),
    });
  }

  /**
   * Certify meeting results.
   */
  async corpShareholdersCertify(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'certify_results', {
      certifiedAt: new Date().toISOString(),
      certifiedBy: 'Inspector of Elections',
      certificateRef: `CERT-${Date.now().toString(36)}`,
      results: [],
    });
  }

  /**
   * Adjourn meeting without completing agenda.
   */
  async corpShareholdersAdjourn(
    privateKey: string,
    fiberId: string,
    reason: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'adjourn_without_action', {
      adjournedAt: new Date().toISOString(),
      reason,
    });
  }

  // ==========================================================================
  // Corporate Securities Operations
  // ==========================================================================

  /**
   * Create a new Corporate Securities fiber.
   */
  async createCorporateSecurities(
    privateKey: string,
    initialData: Record<string, unknown>
  ): Promise<{ fiberId: string; hash: string }> {
    const definition = {
      workflowType: 'CorporateSecurities',
      name: 'Securities',
    };
    return this.createFiber(privateKey, definition, initialData);
  }

  /**
   * Authorize shares per charter.
   */
  async corpSecuritiesAuthorize(
    privateKey: string,
    fiberId: string,
    shares: number
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'authorize_shares', {
      shareCount: shares,
      authorizedDate: new Date().toISOString().split('T')[0],
    });
  }

  /**
   * Issue shares to a holder.
   */
  async corpSecuritiesIssue(
    privateKey: string,
    fiberId: string,
    holderId: string,
    holderName: string,
    shares: number,
    price: number
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'issue_shares', {
      holderId,
      holderName,
      holderType: 'INDIVIDUAL',
      issuanceDate: new Date().toISOString().split('T')[0],
      issuancePrice: price,
      form: 'BOOK_ENTRY',
      boardResolutionRef: `RES-ISSUE-${Date.now().toString(36)}`,
      consideration: { type: 'CASH', value: shares * price },
    });
  }

  /**
   * Initiate share transfer.
   */
  async corpSecuritiesTransfer(
    privateKey: string,
    fiberId: string,
    toHolderId: string,
    toHolderName: string,
    pricePerShare: number
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'initiate_transfer', {
      transferId: `XFER-${Date.now().toString(36)}`,
      toHolderId,
      toHolderName,
      toHolderType: 'INDIVIDUAL',
      transferType: 'SALE',
      pricePerShare,
      transferDate: new Date().toISOString().split('T')[0],
    });
  }

  /**
   * Complete a pending transfer.
   */
  async corpSecuritiesCompleteTransfer(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'complete_transfer', {
      completedDate: new Date().toISOString().split('T')[0],
      transferAgentConfirmation: `CONF-${Date.now().toString(36)}`,
    });
  }

  /**
   * Repurchase shares into treasury.
   */
  async corpSecuritiesRepurchase(
    privateKey: string,
    fiberId: string,
    pricePerShare: number
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'repurchase', {
      repurchaseDate: new Date().toISOString().split('T')[0],
      pricePerShare,
      boardResolutionRef: `RES-REPURCHASE-${Date.now().toString(36)}`,
    });
  }

  /**
   * Execute stock split.
   */
  async corpSecuritiesSplit(
    privateKey: string,
    fiberId: string,
    splitRatio: string
  ): Promise<TransitionResponse> {
    const [multiplier, divisor] = splitRatio.split(':').map(Number);
    return this.transitionFiber(privateKey, fiberId, 'stock_split', {
      actionId: `SPLIT-${Date.now().toString(36)}`,
      splitRatio,
      effectiveDate: new Date().toISOString().split('T')[0],
      resolutionRef: `RES-SPLIT-${Date.now().toString(36)}`,
      newShareCount: Math.floor(multiplier / divisor * 1000), // Placeholder
    });
  }

  /**
   * Declare dividend.
   */
  async corpSecuritiesDividend(
    privateKey: string,
    fiberId: string,
    dividendType: 'CASH' | 'STOCK',
    amount: number
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'declare_dividend', {
      actionId: `DIV-${Date.now().toString(36)}`,
      dividendType,
      recordDate: new Date().toISOString().split('T')[0],
      paymentDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      cashAmount: dividendType === 'CASH' ? amount : undefined,
      stockShares: dividendType === 'STOCK' ? amount : undefined,
      resolutionRef: `RES-DIV-${Date.now().toString(36)}`,
    });
  }

  /**
   * Retire shares.
   */
  async corpSecuritiesRetire(
    privateKey: string,
    fiberId: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'retire', {
      retiredDate: new Date().toISOString().split('T')[0],
      retirementMethod: 'CANCELLATION',
      boardResolutionRef: `RES-RETIRE-${Date.now().toString(36)}`,
    });
  }

  /**
   * Remove restriction from securities.
   */
  async corpSecuritiesRemoveRestriction(
    privateKey: string,
    fiberId: string,
    restrictionType: string
  ): Promise<TransitionResponse> {
    return this.transitionFiber(privateKey, fiberId, 'remove_restriction', {
      restrictionType,
      removedDate: new Date().toISOString().split('T')[0],
    });
  }

  /**
   * List all corporate entities.
   */
  async listCorporateEntities(limit = 100): Promise<{
    count: number;
    fibers: Array<{
      fiberId: string;
      currentState?: string;
      stateData?: Record<string, unknown>;
    }>;
  }> {
    return this.listFibers('CorporateEntity', limit);
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
  // Rejection API (Indexer)
  // ==========================================================================

  /**
   * Get rejections for a fiber from the indexer.
   * Implements the Trello specification pattern:
   *   const rejections = await client.getRejections({ fiberId });
   *   assert.strictEqual(rejections.length, 0, ...);
   */
  async getRejections({ fiberId }: { fiberId: string }): Promise<RejectionEntry[]> {
    if (!this.indexerUrl) return [];
    try {
      const res = await fetch(`${this.indexerUrl}/fibers/${fiberId}/rejections?limit=10`, {
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!res.ok) return [];
      const data = await res.json() as { rejections: RejectionEntry[]; total?: number };
      return data.rejections ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Assert that a fiber has no rejections. Throws if rejections are found.
   * Use after each major operation (register, activate, transition).
   */
  async assertNoRejections(fiberId: string, operation: string): Promise<void> {
    const rejections = await this.getRejections({ fiberId });
    if (rejections.length > 0) {
      const errors = rejections.map(r => r.errors.map(e => `${e.code}: ${e.message}`).join(', ')).join('; ');
      throw new Error(`Fiber ${fiberId} rejected during ${operation}: ${errors}`);
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
