import { BridgeClient } from './bridge-client.js';
import { FIBER_DEFINITIONS, type FiberDefinition, type MarketStateData, type DAOStateData, type GovernanceStateData, type CorporateEntityStateData, type CorporateBoardStateData, type CorporateShareholdersStateData, type CorporateSecuritiesStateData } from './fiber-definitions.js';
import { MARKET_SM_DEFINITION } from './market-workflows.js';
import { Agent } from './types.js';

export interface TrafficConfig {
  generationIntervalMs: number;
  targetActiveFibers: number;
  fiberWeights: Record<string, number>;
}

export interface ActiveFiber {
  id: string;
  type: string;
  definition: FiberDefinition;
  participants: Map<string, { address: string; privateKey: string }>;
  currentState: string;
  /** Index of next transition to execute */
  transitionIndex: number;
  startedAt: number;
}

export interface TickResult {
  skipped: boolean;
  created: number;
  driven: number;
  completed: number;
}

/**
 * FiberOrchestrator
 * 
 * Manages the creation and progression of fibers according to a configurable traffic mix.
 * Drives all parties in a fiber to completion.
 */
export class FiberOrchestrator {
  private activeFibers: ActiveFiber[] = [];
  private completedFibers: number = 0;
  private registeredAgents: Set<string> = new Set(); // Track registered agent addresses

  constructor(
    private config: TrafficConfig,
    private bridge: BridgeClient,
    private getAvailableAgents: () => Agent[]
  ) {}

  /**
   * Bootstrap: Register agents that don't have identity fibers yet
   * Should be called before starting the main loop
   */
  async bootstrapAgents(count: number = 20): Promise<number> {
    const agents = this.getAvailableAgents();
    let registered = 0;
    
    console.log(`🆔 Bootstrapping agent identities (target: ${count})...`);
    
    for (const agent of agents.slice(0, count)) {
      if (this.registeredAgents.has(agent.address)) continue;
      
      try {
        const result = await this.bridge.registerAgent(
          agent.privateKey,
          `Agent_${agent.address.slice(4, 12)}`,
          'simulation',
          agent.address.slice(0, 16)
        );
        
        // Activate the agent
        await this.bridge.activateAgent(agent.privateKey, result.fiberId);
        
        this.registeredAgents.add(agent.address);
        registered++;
        console.log(`  ✅ Registered: ${agent.address.slice(0, 12)}... (${result.fiberId.slice(0, 8)})`);
      } catch (err) {
        // May already be registered
        const msg = (err as Error).message;
        if (msg.includes('already') || msg.includes('exists')) {
          this.registeredAgents.add(agent.address);
        } else {
          console.log(`  ⚠️  Failed to register ${agent.address.slice(0, 12)}: ${msg.slice(0, 50)}`);
        }
      }
    }
    
    console.log(`  📊 Registered ${registered} new agents (${this.registeredAgents.size} total known)`);
    return registered;
  }

  /**
   * Main orchestration loop tick
   * - Drives existing fibers forward
   * - Starts new fibers if below target
   */
  async tick(): Promise<TickResult> {
    this.tickCount++;
    
    // Check network health first
    try {
      const syncStatus = await this.bridge.checkSyncStatus();
      if (!syncStatus.ready) {
        return { skipped: true, created: 0, driven: 0, completed: 0 };
      }
    } catch (err) {
      console.log(`  ⚠️  Sync check failed: ${(err as Error).message}`);
      return { skipped: true, created: 0, driven: 0, completed: 0 };
    }
    
    let created = 0;
    let driven = 0;
    let completed = 0;

    // Drive existing fibers forward
    const fibersToRemove: string[] = [];
    for (const fiber of this.activeFibers) {
      try {
        const result = await this.driveFiber(fiber);
        if (result === 'progressed') {
          driven++;
        } else if (result === 'completed') {
          completed++;
          this.completedFibers++;
          fibersToRemove.push(fiber.id);
        }
        // 'waiting' means no action needed yet
      } catch (err) {
        console.log(`  ⚠️  Error driving fiber ${fiber.id.slice(0, 8)}: ${(err as Error).message}`);
      }
    }
    
    // Remove completed fibers
    this.activeFibers = this.activeFibers.filter(f => !fibersToRemove.includes(f.id));

    // Start new fibers if needed
    const currentActive = this.activeFibers.length;
    if (currentActive < this.config.targetActiveFibers) {
      const fibersToStart = this.config.targetActiveFibers - currentActive;
      for (let i = 0; i < fibersToStart; i++) {
        const fiberType = this.selectFiberType();
        await this.startFiber(fiberType);
        created++;
      }
    }

    return {
      skipped: false,
      created,
      driven,
      completed,
    };
  }

  /**
   * Weighted random selection of fiber type based on config.fiberWeights
   */
  private selectFiberType(): string {
    const totalWeight = Object.values(this.config.fiberWeights).reduce((sum, weight) => sum + weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const [type, weight] of Object.entries(this.config.fiberWeights)) {
      random -= weight;
      if (random <= 0) {
        return type;
      }
    }
    
    // Fallback (should not happen if weights sum to 1.0)
    return 'escrow';
  }

  /**
   * Start a new fiber of the given type
   */
  private async startFiber(type: string): Promise<void> {
    const def = FIBER_DEFINITIONS[type];
    if (!def) {
      throw new Error(`Unknown fiber type: ${type}`);
    }

    // Recruit agents for each role
    const participants = new Map<string, { address: string; privateKey: string }>();
    const participantAddresses = new Map<string, string>(); // role -> address for stateData
    const availableAgents = this.getAvailableAgents();
    const usedAddresses = new Set<string>();
    
    for (const role of def.roles) {
      const agent = availableAgents.find(a => 
        !this.isAgentInFiber(a.address) && !usedAddresses.has(a.address)
      );
      if (!agent) {
        console.log(`⚠️  Not enough agents for ${type} (need ${def.roles.length}, missing ${role})`);
        return; // Skip this fiber, don't throw
      }
      participants.set(role, {
        address: agent.address,
        privateKey: agent.privateKey
      });
      participantAddresses.set(role, agent.address);
      usedAddresses.add(agent.address);
    }

    // Generate a temporary fiber ID for stateData generation
    const tempFiberId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    // Generate proper stateData using the definition's generator
    const stateData = def.generateStateData(participantAddresses, {
      fiberId: tempFiberId,
      generation: this.tickCount,
    });

    // Create fiber using appropriate bridge method based on workflowType
    const proposer = participants.get(def.roles[0])!;
    const counterparty = participants.get(def.roles[1]);
    
    try {
      let fiberId: string;
      
      if (def.workflowType === 'Market') {
        // Use Market-specific creation
        const marketData = stateData as MarketStateData;
        const result = await this.bridge.createMarket(
          proposer.privateKey,
          MARKET_SM_DEFINITION,
          marketData as unknown as Record<string, unknown>
        );
        fiberId = result.fiberId;
        console.log(`  ✅ Created ${def.name}: ${fiberId.slice(0, 12)}... (${marketData.marketType}, creator: ${proposer.address.slice(0, 10)})`);
      } else if (def.workflowType === 'DAO') {
        // Use DAO-specific creation
        const daoData = stateData as DAOStateData;
        const result = await this.bridge.createDAO(
          proposer.privateKey,
          daoData.daoType,
          daoData as unknown as Record<string, unknown>
        );
        fiberId = result.fiberId;
        console.log(`  ✅ Created ${def.name}: ${fiberId.slice(0, 12)}... (${daoData.daoType}, ${daoData.members.length} members)`);
      } else if (def.workflowType === 'Governance') {
        // Use Governance-specific creation
        const govData = stateData as GovernanceStateData;
        const result = await this.bridge.createGovernance(
          proposer.privateKey,
          govData as unknown as Record<string, unknown>
        );
        fiberId = result.fiberId;
        console.log(`  ✅ Created ${def.name}: ${fiberId.slice(0, 12)}... (${Object.keys(govData.members).length} members)`);
      } else if (def.workflowType === 'CorporateEntity') {
        // Use Corporate Entity-specific creation
        const entityData = stateData as CorporateEntityStateData;
        const result = await this.bridge.createCorporateEntity(
          proposer.privateKey,
          entityData as unknown as Record<string, unknown>
        );
        fiberId = result.fiberId;
        console.log(`  ✅ Created ${def.name}: ${fiberId.slice(0, 12)}... (${entityData.legalName}, ${entityData.entityType})`);
      } else if (def.workflowType === 'CorporateBoard') {
        // Use Corporate Board-specific creation
        const boardData = stateData as CorporateBoardStateData;
        const result = await this.bridge.createCorporateBoard(
          proposer.privateKey,
          boardData as unknown as Record<string, unknown>
        );
        fiberId = result.fiberId;
        console.log(`  ✅ Created ${def.name}: ${fiberId.slice(0, 12)}... (${boardData.directors.length} directors, ${boardData.seats.authorized} seats)`);
      } else if (def.workflowType === 'CorporateShareholders') {
        // Use Corporate Shareholders-specific creation
        const shareholdersData = stateData as CorporateShareholdersStateData;
        const result = await this.bridge.createCorporateShareholders(
          proposer.privateKey,
          shareholdersData as unknown as Record<string, unknown>
        );
        fiberId = result.fiberId;
        console.log(`  ✅ Created ${def.name}: ${fiberId.slice(0, 12)}... (${shareholdersData.meetingType}, ${shareholdersData.eligibleVoters.length} voters)`);
      } else if (def.workflowType === 'CorporateSecurities') {
        // Use Corporate Securities-specific creation
        const securitiesData = stateData as CorporateSecuritiesStateData;
        const result = await this.bridge.createCorporateSecurities(
          proposer.privateKey,
          securitiesData as unknown as Record<string, unknown>
        );
        fiberId = result.fiberId;
        console.log(`  ✅ Created ${def.name}: ${fiberId.slice(0, 12)}... (${securitiesData.shareClassName}, ${securitiesData.shareCount} shares)`);
      } else if (def.workflowType === 'Contract' && counterparty) {
        // Use SDK-compliant contract creation
        const contractData = stateData as Record<string, unknown>;
        const terms = (contractData.terms as Record<string, unknown>) ?? {};
        const result = await this.bridge.proposeContract(
          proposer.privateKey,
          counterparty.address,
          terms,
          {
            title: (contractData.contractId as string) ?? def.name,
            description: (terms.description as string) ?? def.name,
          }
        );
        fiberId = result.contractId;
        console.log(`  ✅ Proposed ${def.name}: ${fiberId.slice(0, 12)}... (${proposer.address.slice(0, 10)} → ${counterparty.address.slice(0, 10)})`);
      } else {
        // Use generic fiber creation for custom types
        const createResult = await this.bridge.createFiber(
          proposer.privateKey,
          {
            workflowType: def.workflowType,
            type: def.type,
            name: def.name,
            initialState: def.initialState,
            states: def.states,
            transitions: def.transitions.map(t => ({
              from: t.from,
              to: t.to,
              event: t.event,
            })),
          },
          stateData as Record<string, unknown>
        );
        fiberId = createResult.fiberId;
        console.log(`  ✅ Created ${def.name}: ${fiberId.slice(0, 12)}...`);
      }

      // Add to active fibers
      this.activeFibers.push({
        id: fiberId,
        type,
        definition: def,
        participants,
        currentState: def.initialState,
        transitionIndex: 0,
        startedAt: Date.now(),
      });
    } catch (err) {
      console.log(`  ❌ Failed to create ${def.name}: ${(err as Error).message}`);
    }
  }

  /**
   * Drive a single fiber forward through its state machine
   * Returns: 'progressed' | 'completed' | 'waiting'
   */
  private async driveFiber(fiber: ActiveFiber): Promise<'progressed' | 'completed' | 'waiting'> {
    const def = fiber.definition;
    
    // Check if already in final state
    if (def.finalStates.includes(fiber.currentState)) {
      return 'completed';
    }
    
    // Find next available transition from current state
    const availableTransitions = def.transitions.filter(t => t.from === fiber.currentState);
    if (availableTransitions.length === 0) {
      return 'waiting'; // No transitions available
    }
    
    // Pick a transition (prefer non-rejection paths for now)
    const transition = availableTransitions.find(t => 
      !t.event.includes('reject') && !t.event.includes('cancel') && !t.event.includes('dispute')
    ) ?? availableTransitions[0];
    
    // Get the actor for this transition
    const actorAgent = fiber.participants.get(transition.actor);
    if (!actorAgent) {
      console.log(`  ⚠️  No agent for role ${transition.actor} in fiber ${fiber.id.slice(0, 8)}`);
      return 'waiting';
    }
    
    // Execute the transition using appropriate bridge method
    try {
      if (def.workflowType === 'Market') {
        await this.executeMarketTransition(fiber, transition, actorAgent);
      } else if (def.workflowType === 'DAO') {
        await this.executeDAOTransition(fiber, transition, actorAgent);
      } else if (def.workflowType === 'Governance') {
        await this.executeGovernanceTransition(fiber, transition, actorAgent);
      } else if (def.workflowType === 'Contract') {
        await this.executeContractTransition(fiber, transition, actorAgent);
      } else if (def.workflowType === 'CorporateEntity') {
        await this.executeCorporateEntityTransition(fiber, transition, actorAgent);
      } else if (def.workflowType === 'CorporateBoard') {
        await this.executeCorporateBoardTransition(fiber, transition, actorAgent);
      } else if (def.workflowType === 'CorporateShareholders') {
        await this.executeCorporateShareholdersTransition(fiber, transition, actorAgent);
      } else if (def.workflowType === 'CorporateSecurities') {
        await this.executeCorporateSecuritiesTransition(fiber, transition, actorAgent);
      } else {
        // Generic fiber transition
        await this.bridge.transitionFiber(
          actorAgent.privateKey,
          fiber.id,
          transition.event,
          { agent: actorAgent.address }
        );
      }
      
      // Update state
      fiber.currentState = transition.to;
      fiber.transitionIndex++;
      
      console.log(`  → ${fiber.type}[${fiber.id.slice(0, 8)}]: ${transition.from} --${transition.event}--> ${transition.to}`);
      
      return def.finalStates.includes(transition.to) ? 'completed' : 'progressed';
    } catch (err) {
      console.log(`  ⚠️  Transition failed: ${(err as Error).message}`);
      return 'waiting';
    }
  }

  /**
   * Execute a contract-specific transition using SDK-compliant methods
   */
  private async executeContractTransition(
    fiber: ActiveFiber,
    transition: { event: string; actor: string },
    actor: { address: string; privateKey: string }
  ): Promise<void> {
    switch (transition.event) {
      case 'accept':
        await this.bridge.acceptContract(actor.privateKey, fiber.id);
        break;
      case 'reject':
        await this.bridge.rejectContract(actor.privateKey, fiber.id, 'Declined by counterparty');
        break;
      case 'deliver':
      case 'confirm':
      case 'submit_completion':
        await this.bridge.submitCompletion(actor.privateKey, fiber.id, `Completed by ${actor.address.slice(0, 10)}`);
        break;
      case 'finalize':
        await this.bridge.finalizeContract(actor.privateKey, fiber.id);
        break;
      case 'dispute':
        await this.bridge.disputeContract(actor.privateKey, fiber.id, 'Disputed by party');
        break;
      default:
        // Fallback to generic transition
        await this.bridge.transitionContract(actor.privateKey, fiber.id, transition.event, { agent: actor.address });
    }
  }

  /**
   * Execute a market-specific transition using bridge market methods
   */
  private async executeMarketTransition(
    fiber: ActiveFiber,
    transition: { event: string; actor: string },
    actor: { address: string; privateKey: string }
  ): Promise<void> {
    switch (transition.event) {
      case 'open':
        await this.bridge.openMarket(actor.privateKey, fiber.id);
        break;
      case 'cancel':
        await this.bridge.cancelMarket(actor.privateKey, fiber.id, 'Cancelled by creator');
        break;
      case 'commit': {
        // Generate a random commitment amount based on market type
        const amount = Math.floor(Math.random() * 50) + 10;
        const data = this.generateCommitData(fiber);
        await this.bridge.commitToMarket(actor.privateKey, fiber.id, amount, data);
        break;
      }
      case 'close':
        await this.bridge.closeMarket(actor.privateKey, fiber.id);
        break;
      case 'submit_resolution': {
        // Generate outcome based on market type
        const outcome = this.generateResolutionOutcome(fiber);
        await this.bridge.submitResolution(actor.privateKey, fiber.id, outcome, `proof-${Date.now().toString(36)}`);
        break;
      }
      case 'finalize': {
        // Use resolved outcome or generate one
        const finalOutcome = this.generateResolutionOutcome(fiber);
        await this.bridge.finalizeMarket(actor.privateKey, fiber.id, finalOutcome, { finalizedAt: Date.now() });
        break;
      }
      case 'refund':
        await this.bridge.refundMarket(actor.privateKey, fiber.id, 'Threshold not met');
        break;
      case 'claim': {
        const claimAmount = Math.floor(Math.random() * 100) + 10;
        await this.bridge.claimFromMarket(actor.privateKey, fiber.id, claimAmount);
        break;
      }
      default:
        // Fallback to generic fiber transition
        await this.bridge.transitionFiber(actor.privateKey, fiber.id, transition.event, { agent: actor.address });
    }
  }

  /**
   * Generate commit data based on market type
   */
  private generateCommitData(fiber: ActiveFiber): Record<string, unknown> {
    const marketType = fiber.definition.marketType;
    switch (marketType) {
      case 'prediction':
        return { prediction: Math.random() > 0.5 ? 'YES' : 'NO' };
      case 'auction':
        return { bidType: 'standard' };
      case 'crowdfund':
        return { tier: Math.random() > 0.5 ? 'backer' : 'supporter' };
      case 'group_buy':
        return { units: Math.floor(Math.random() * 3) + 1 };
      default:
        return {};
    }
  }

  /**
   * Generate resolution outcome based on market type
   */
  private generateResolutionOutcome(fiber: ActiveFiber): string {
    const marketType = fiber.definition.marketType;
    switch (marketType) {
      case 'prediction':
        return Math.random() > 0.5 ? 'YES' : 'NO';
      case 'auction':
        // Would normally pick highest bidder, use placeholder
        return 'WINNER_DETERMINED';
      case 'crowdfund':
      case 'group_buy':
        return Math.random() > 0.4 ? 'SUCCESS' : 'FAILED';
      default:
        return 'RESOLVED';
    }
  }

  /**
   * Execute a DAO-specific transition
   * Handles: propose, vote, execute, delegate, veto, cancel
   */
  private async executeDAOTransition(
    fiber: ActiveFiber,
    transition: { event: string; actor: string },
    actor: { address: string; privateKey: string }
  ): Promise<void> {
    const daoType = fiber.definition.daoType;
    
    switch (transition.event) {
      case 'propose': {
        const proposalId = `PROP-${fiber.id.slice(0, 6)}-${Date.now().toString(36)}`;
        const proposalData = this.generateDAOProposal(fiber);
        await this.bridge.daoPropose(actor.privateKey, fiber.id, proposalId, proposalData);
        break;
      }
      case 'vote': {
        const vote = this.generateDAOVote(daoType);
        const weight = daoType === 'token' ? Math.floor(Math.random() * 1000) + 100 : 1;
        await this.bridge.daoVote(actor.privateKey, fiber.id, vote, weight);
        break;
      }
      case 'sign': {
        // Multisig specific - sign pending proposal
        await this.bridge.daoSign(actor.privateKey, fiber.id);
        break;
      }
      case 'execute': {
        await this.bridge.daoExecute(actor.privateKey, fiber.id);
        break;
      }
      case 'delegate': {
        // Pick another member to delegate to
        const members = Array.from(fiber.participants.values())
          .filter(p => p.address !== actor.address);
        if (members.length > 0) {
          const delegateTo = members[Math.floor(Math.random() * members.length)];
          await this.bridge.daoDelegate(actor.privateKey, fiber.id, delegateTo.address);
        }
        break;
      }
      case 'queue': {
        await this.bridge.daoQueue(actor.privateKey, fiber.id);
        break;
      }
      case 'cancel': {
        await this.bridge.daoCancel(actor.privateKey, fiber.id, 'Cancelled by proposer');
        break;
      }
      case 'reject': {
        await this.bridge.daoReject(actor.privateKey, fiber.id, 'Did not reach quorum');
        break;
      }
      case 'join': {
        const reputation = Math.floor(Math.random() * 80) + 20;
        await this.bridge.daoJoin(actor.privateKey, fiber.id, reputation);
        break;
      }
      case 'leave': {
        await this.bridge.daoLeave(actor.privateKey, fiber.id);
        break;
      }
      case 'add_signer': {
        // Generate new signer address (in reality would be an existing agent)
        const newSigner = `0x${Math.random().toString(16).slice(2, 42)}`;
        await this.bridge.daoAddSigner(actor.privateKey, fiber.id, newSigner);
        break;
      }
      case 'remove_signer': {
        // Would remove a signer, using placeholder
        await this.bridge.daoRemoveSigner(actor.privateKey, fiber.id, actor.address);
        break;
      }
      case 'dissolve': {
        await this.bridge.daoDissolve(actor.privateKey, fiber.id);
        break;
      }
      default:
        // Fallback to generic fiber transition
        await this.bridge.transitionFiber(actor.privateKey, fiber.id, transition.event, { agent: actor.address });
    }
  }

  /**
   * Execute a Governance-specific transition
   * Handles: add_member, remove_member, update_rules, raise_dispute, resolve
   */
  private async executeGovernanceTransition(
    fiber: ActiveFiber,
    transition: { event: string; actor: string },
    actor: { address: string; privateKey: string }
  ): Promise<void> {
    switch (transition.event) {
      case 'add_member': {
        const newMember = `0x${Math.random().toString(16).slice(2, 42)}`;
        const role = Math.random() > 0.8 ? 'admin' : 'member';
        await this.bridge.govAddMember(actor.privateKey, fiber.id, newMember, role);
        break;
      }
      case 'remove_member': {
        // Would remove a member, using placeholder
        const members = Array.from(fiber.participants.values())
          .filter(p => p.address !== actor.address);
        if (members.length > 0) {
          const toRemove = members[Math.floor(Math.random() * members.length)];
          await this.bridge.govRemoveMember(actor.privateKey, fiber.id, toRemove.address);
        }
        break;
      }
      case 'propose': {
        const proposalId = `GOV-${fiber.id.slice(0, 6)}-${Date.now().toString(36)}`;
        const changes = this.generateGovernanceRuleChange();
        await this.bridge.govPropose(actor.privateKey, fiber.id, proposalId, 'rule_change', changes);
        break;
      }
      case 'vote': {
        const vote = Math.random() > 0.3 ? 'for' : (Math.random() > 0.5 ? 'against' : 'abstain');
        await this.bridge.govVote(actor.privateKey, fiber.id, vote);
        break;
      }
      case 'finalize': {
        const forCount = Math.floor(Math.random() * 10) + 3;
        await this.bridge.govFinalize(actor.privateKey, fiber.id, forCount);
        break;
      }
      case 'raise_dispute': {
        const disputeId = `DISP-${fiber.id.slice(0, 6)}-${Date.now().toString(36)}`;
        const defendants = Array.from(fiber.participants.values())
          .filter(p => p.address !== actor.address);
        if (defendants.length > 0) {
          const defendant = defendants[Math.floor(Math.random() * defendants.length)];
          await this.bridge.govRaiseDispute(
            actor.privateKey,
            fiber.id,
            disputeId,
            defendant.address,
            'Alleged violation of governance rules'
          );
        }
        break;
      }
      case 'submit_evidence': {
        const content = `Evidence submitted at ${new Date().toISOString()}`;
        await this.bridge.govSubmitEvidence(actor.privateKey, fiber.id, content);
        break;
      }
      case 'resolve': {
        const ruling = Math.random() > 0.5 ? 'plaintiff' : 'defendant';
        const remedy = ruling === 'plaintiff' ? 'Remediation required' : 'Dispute dismissed';
        await this.bridge.govResolve(actor.privateKey, fiber.id, ruling, remedy);
        break;
      }
      case 'dissolve': {
        const approvalCount = Math.floor(Math.random() * 5) + 5;
        await this.bridge.govDissolve(actor.privateKey, fiber.id, approvalCount);
        break;
      }
      default:
        // Fallback to generic fiber transition
        await this.bridge.transitionFiber(actor.privateKey, fiber.id, transition.event, { agent: actor.address });
    }
  }

  /**
   * Generate a random DAO proposal based on type
   */
  private generateDAOProposal(fiber: ActiveFiber): Record<string, unknown> {
    const daoType = fiber.definition.daoType;
    const proposalTypes = daoType === 'multisig' 
      ? ['transfer', 'upgrade', 'parameter_change']
      : ['funding', 'governance', 'treasury', 'membership'];
    
    const actionType = proposalTypes[Math.floor(Math.random() * proposalTypes.length)];
    
    return {
      title: `${actionType.charAt(0).toUpperCase() + actionType.slice(1)} Proposal`,
      description: `Proposal for ${actionType} action generated at ${new Date().toISOString()}`,
      actionType,
      payload: {
        amount: Math.floor(Math.random() * 1000) + 100,
        target: `0x${Math.random().toString(16).slice(2, 42)}`,
      },
    };
  }

  /**
   * Generate a random DAO vote
   */
  private generateDAOVote(daoType?: 'token' | 'multisig' | 'threshold'): string {
    // Bias towards 'for' votes for simulation flow
    const rand = Math.random();
    if (rand < 0.6) return 'for';
    if (rand < 0.85) return 'against';
    return 'abstain';
  }

  /**
   * Generate random governance rule changes
   */
  private generateGovernanceRuleChange(): Record<string, unknown> {
    const changeTypes = ['maxMembers', 'votingPeriod', 'passingThreshold', 'disputeQuorum'];
    const changeType = changeTypes[Math.floor(Math.random() * changeTypes.length)];
    
    switch (changeType) {
      case 'maxMembers':
        return { maxMembers: Math.floor(Math.random() * 100) + 50 };
      case 'votingPeriod':
        return { votingPeriodMs: (Math.floor(Math.random() * 7) + 3) * 24 * 60 * 60 * 1000 };
      case 'passingThreshold':
        return { passingThreshold: Math.random() * 0.3 + 0.5 }; // 0.5 to 0.8
      case 'disputeQuorum':
        return { disputeQuorum: Math.floor(Math.random() * 5) + 3 };
      default:
        return {};
    }
  }

  // =========================================================================
  // Corporate Governance Transition Executors
  // =========================================================================

  /**
   * Execute a Corporate Entity transition
   * Handles: incorporate, create_class, issue_shares, transfer_shares
   */
  private async executeCorporateEntityTransition(
    fiber: ActiveFiber,
    transition: { event: string; actor: string },
    actor: { address: string; privateKey: string }
  ): Promise<void> {
    switch (transition.event) {
      case 'incorporate': {
        const stateFileNumber = `FILE-${Date.now().toString(36).toUpperCase()}`;
        await this.bridge.corpEntityIncorporate(
          actor.privateKey,
          fiber.id,
          new Date().toISOString().split('T')[0],
          stateFileNumber
        );
        break;
      }
      case 'create_class': {
        const classData = this.generateShareClass();
        await this.bridge.corpEntityCreateClass(actor.privateKey, fiber.id, classData);
        break;
      }
      case 'issue_shares': {
        const shares = Math.floor(Math.random() * 10000) + 1000;
        const holderId = `HOLDER-${Math.random().toString(36).slice(2, 10)}`;
        await this.bridge.corpEntityIssueShares(
          actor.privateKey,
          fiber.id,
          'COMMON',
          shares,
          holderId,
          Math.random() * 10 + 0.01
        );
        break;
      }
      case 'transfer_shares': {
        const shares = Math.floor(Math.random() * 1000) + 100;
        const fromHolder = `HOLDER-${Math.random().toString(36).slice(2, 10)}`;
        const toHolder = `HOLDER-${Math.random().toString(36).slice(2, 10)}`;
        await this.bridge.corpEntityTransferShares(
          actor.privateKey,
          fiber.id,
          'COMMON',
          shares,
          fromHolder,
          toHolder
        );
        break;
      }
      case 'amend_charter': {
        const amendmentId = `AMEND-${Date.now().toString(36)}`;
        await this.bridge.corpEntityAmendCharter(
          actor.privateKey,
          fiber.id,
          amendmentId,
          'Charter amendment for share authorization increase'
        );
        break;
      }
      case 'suspend': {
        await this.bridge.corpEntitySuspend(
          actor.privateKey,
          fiber.id,
          'FRANCHISE_TAX_DELINQUENT'
        );
        break;
      }
      case 'reinstate': {
        await this.bridge.corpEntityReinstate(actor.privateKey, fiber.id);
        break;
      }
      case 'dissolve_voluntary':
      case 'dissolve_administrative': {
        await this.bridge.corpEntityDissolve(actor.privateKey, fiber.id, transition.event === 'dissolve_voluntary' ? 'VOLUNTARY' : 'ADMINISTRATIVE');
        break;
      }
      default:
        await this.bridge.transitionFiber(actor.privateKey, fiber.id, transition.event, { agent: actor.address });
    }
  }

  /**
   * Execute a Corporate Board transition
   * Handles: elect_director, call_meeting, pass_resolution, written_consent
   */
  private async executeCorporateBoardTransition(
    fiber: ActiveFiber,
    transition: { event: string; actor: string },
    actor: { address: string; privateKey: string }
  ): Promise<void> {
    switch (transition.event) {
      case 'elect_director': {
        const directorId = `DIR-${Math.random().toString(36).slice(2, 10)}`;
        const directorName = `Director ${directorId.slice(4)}`;
        const termYears = Math.floor(Math.random() * 3) + 1;
        await this.bridge.corpBoardElectDirector(
          actor.privateKey,
          fiber.id,
          directorId,
          directorName,
          termYears,
          Math.random() > 0.5
        );
        break;
      }
      case 'resign_director': {
        // Get a random director to resign
        const directorId = `DIR-${actor.address.slice(2, 10)}`;
        await this.bridge.corpBoardResignDirector(actor.privateKey, fiber.id, directorId);
        break;
      }
      case 'call_meeting': {
        const meetingId = `MTG-${Date.now().toString(36)}`;
        const meetingType = Math.random() > 0.7 ? 'SPECIAL' : 'REGULAR';
        const scheduledDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await this.bridge.corpBoardCallMeeting(
          actor.privateKey,
          fiber.id,
          meetingId,
          meetingType as 'REGULAR' | 'SPECIAL' | 'ANNUAL',
          scheduledDate
        );
        break;
      }
      case 'open_meeting': {
        await this.bridge.corpBoardOpenMeeting(actor.privateKey, fiber.id);
        break;
      }
      case 'pass_resolution': {
        const resolutionId = `RES-${Date.now().toString(36)}`;
        const resolutionTypes = ['STOCK_ISSUANCE', 'OFFICER_APPOINTMENT', 'CONTRACT_APPROVAL', 'DIVIDEND_DECLARATION'];
        const resolutionType = resolutionTypes[Math.floor(Math.random() * resolutionTypes.length)];
        await this.bridge.corpBoardPassResolution(
          actor.privateKey,
          fiber.id,
          resolutionId,
          resolutionType,
          `Resolution for ${resolutionType.toLowerCase().replace('_', ' ')}`
        );
        break;
      }
      case 'written_consent': {
        const consentId = `CONSENT-${Date.now().toString(36)}`;
        await this.bridge.corpBoardWrittenConsent(
          actor.privateKey,
          fiber.id,
          consentId,
          'Unanimous written consent action'
        );
        break;
      }
      case 'adjourn': {
        await this.bridge.corpBoardAdjourn(actor.privateKey, fiber.id);
        break;
      }
      default:
        await this.bridge.transitionFiber(actor.privateKey, fiber.id, transition.event, { agent: actor.address });
    }
  }

  /**
   * Execute a Corporate Shareholders transition
   * Handles: schedule_meeting, cast_vote, grant_proxy, close_voting
   */
  private async executeCorporateShareholdersTransition(
    fiber: ActiveFiber,
    transition: { event: string; actor: string },
    actor: { address: string; privateKey: string }
  ): Promise<void> {
    switch (transition.event) {
      case 'set_record_date': {
        const recordDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        await this.bridge.corpShareholdersSetRecordDate(actor.privateKey, fiber.id, recordDate);
        break;
      }
      case 'register_shareholders': {
        const shareholders = this.generateShareholders(Math.floor(Math.random() * 10) + 3);
        await this.bridge.corpShareholdersRegister(actor.privateKey, fiber.id, shareholders);
        break;
      }
      case 'open_proxy_period': {
        await this.bridge.corpShareholdersOpenProxy(actor.privateKey, fiber.id);
        break;
      }
      case 'grant_proxy': {
        const proxyHolderId = `PROXY-${Math.random().toString(36).slice(2, 10)}`;
        await this.bridge.corpShareholdersGrantProxy(
          actor.privateKey,
          fiber.id,
          actor.address,
          proxyHolderId
        );
        break;
      }
      case 'schedule_meeting':
      case 'open_polls': {
        await this.bridge.corpShareholdersOpenPolls(actor.privateKey, fiber.id);
        break;
      }
      case 'cast_vote': {
        const voteId = `VOTE-${Date.now().toString(36)}`;
        const agendaItemId = 'ITEM-001'; // Vote on first agenda item
        const votes = Math.floor(Math.random() * 10000) + 1000;
        const voteType = Math.random() > 0.3 ? 'for' : (Math.random() > 0.5 ? 'against' : 'abstain');
        await this.bridge.corpShareholdersCastVote(
          actor.privateKey,
          fiber.id,
          voteId,
          agendaItemId,
          voteType,
          votes
        );
        break;
      }
      case 'close_voting': {
        await this.bridge.corpShareholdersClosePolls(actor.privateKey, fiber.id);
        break;
      }
      case 'certify_results': {
        await this.bridge.corpShareholdersCertify(actor.privateKey, fiber.id);
        break;
      }
      case 'adjourn_without_action': {
        await this.bridge.corpShareholdersAdjourn(actor.privateKey, fiber.id, 'Quorum not achieved');
        break;
      }
      default:
        await this.bridge.transitionFiber(actor.privateKey, fiber.id, transition.event, { agent: actor.address });
    }
  }

  /**
   * Execute a Corporate Securities transition
   * Handles: authorize_shares, issue_shares, transfer, declare_dividend
   */
  private async executeCorporateSecuritiesTransition(
    fiber: ActiveFiber,
    transition: { event: string; actor: string },
    actor: { address: string; privateKey: string }
  ): Promise<void> {
    switch (transition.event) {
      case 'authorize_shares': {
        const shares = Math.floor(Math.random() * 1000000) + 100000;
        await this.bridge.corpSecuritiesAuthorize(
          actor.privateKey,
          fiber.id,
          shares
        );
        break;
      }
      case 'issue_shares': {
        const holderId = `HOLDER-${Math.random().toString(36).slice(2, 10)}`;
        const holderName = `Holder ${holderId.slice(7)}`;
        const shares = Math.floor(Math.random() * 10000) + 1000;
        const price = Math.random() * 10 + 0.01;
        await this.bridge.corpSecuritiesIssue(
          actor.privateKey,
          fiber.id,
          holderId,
          holderName,
          shares,
          price
        );
        break;
      }
      case 'transfer': {
        const toHolderId = `HOLDER-${Math.random().toString(36).slice(2, 10)}`;
        const toHolderName = `Holder ${toHolderId.slice(7)}`;
        await this.bridge.corpSecuritiesTransfer(
          actor.privateKey,
          fiber.id,
          toHolderId,
          toHolderName,
          Math.random() * 5 + 0.5
        );
        break;
      }
      case 'complete_transfer': {
        await this.bridge.corpSecuritiesCompleteTransfer(actor.privateKey, fiber.id);
        break;
      }
      case 'repurchase': {
        const price = Math.random() * 10 + 1;
        await this.bridge.corpSecuritiesRepurchase(actor.privateKey, fiber.id, price);
        break;
      }
      case 'stock_split': {
        const ratio = `${Math.floor(Math.random() * 3) + 2}:1`;
        await this.bridge.corpSecuritiesSplit(actor.privateKey, fiber.id, ratio);
        break;
      }
      case 'declare_dividend': {
        const dividendType = Math.random() > 0.7 ? 'STOCK' : 'CASH';
        const amount = dividendType === 'CASH' ? Math.random() * 0.5 + 0.01 : Math.floor(Math.random() * 100) + 10;
        await this.bridge.corpSecuritiesDividend(
          actor.privateKey,
          fiber.id,
          dividendType,
          amount
        );
        break;
      }
      case 'retire': {
        await this.bridge.corpSecuritiesRetire(actor.privateKey, fiber.id);
        break;
      }
      case 'remove_restriction': {
        await this.bridge.corpSecuritiesRemoveRestriction(actor.privateKey, fiber.id, 'RULE_144');
        break;
      }
      default:
        await this.bridge.transitionFiber(actor.privateKey, fiber.id, transition.event, { agent: actor.address });
    }
  }

  /**
   * Generate a random share class for corporate entity
   */
  private generateShareClass(): {
    classId: string;
    className: string;
    authorized: number;
    parValue: number;
    votingRights: boolean;
    votesPerShare: number;
  } {
    const classes = ['Series A Preferred', 'Series B Preferred', 'Class B Common', 'Founders Stock'];
    const className = classes[Math.floor(Math.random() * classes.length)];
    return {
      classId: className.replace(/\s+/g, '_').toUpperCase(),
      className,
      authorized: Math.floor(Math.random() * 1000000) + 100000,
      parValue: Math.random() > 0.5 ? 0.0001 : 1.0,
      votingRights: Math.random() > 0.3,
      votesPerShare: Math.random() > 0.8 ? 10 : 1,
    };
  }

  /**
   * Generate random shareholders for shareholder meeting
   */
  private generateShareholders(count: number): Array<{
    shareholderId: string;
    name: string;
    shares: number;
    shareClass: string;
  }> {
    const shareholders = [];
    for (let i = 0; i < count; i++) {
      shareholders.push({
        shareholderId: `SH-${Math.random().toString(36).slice(2, 10)}`,
        name: `Shareholder ${i + 1}`,
        shares: Math.floor(Math.random() * 50000) + 1000,
        shareClass: 'COMMON',
      });
    }
    return shareholders;
  }

  private tickCount = 0;

  /**
   * Check if an agent is currently participating in any fiber
   */
  private isAgentInFiber(address: string): boolean {
    return this.activeFibers.some(fiber => 
      Array.from(fiber.participants.values()).some(agent => agent.address === address)
    );
  }

  /**
   * Get current statistics
   */
  getStats(): {
    activeFibers: number;
    completedFibers: number;
    fiberTypeDistribution: Record<string, number>;
  } {
    const distribution: Record<string, number> = {};
    for (const [type, _] of Object.entries(this.config.fiberWeights)) {
      distribution[type] = 0;
    }
    
    for (const fiber of this.activeFibers) {
      distribution[fiber.type] = (distribution[fiber.type] || 0) + 1;
    }

    return {
      activeFibers: this.activeFibers.length,
      completedFibers: this.completedFibers,
      fiberTypeDistribution: distribution
    };
  }
}
