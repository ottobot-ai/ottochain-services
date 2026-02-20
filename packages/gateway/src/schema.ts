// GraphQL Schema Definition

export const typeDefs = /* GraphQL */ `
  scalar DateTime
  scalar JSON
  scalar BigInt

  # === Types ===

  type Agent {
    address: String!
    publicKey: String!
    displayName: String
    reputation: Int!
    state: AgentState!
    fiberId: String
    snapshotOrdinal: BigInt!
    createdAt: DateTime!
    
    platformLinks: [PlatformLink!]!
    attestationsReceived(limit: Int, offset: Int): [Attestation!]!
    contractsAsProposer(state: ContractState): [Contract!]!
    contractsAsCounterparty(state: ContractState): [Contract!]!
    reputationHistory(limit: Int): [ReputationPoint!]!
  }

  type PlatformLink {
    platform: Platform!
    platformUserId: String!
    platformUsername: String
    linkedAt: DateTime!
    verified: Boolean!
  }

  type Attestation {
    id: ID!
    type: AttestationType!
    issuer: Agent
    issuerPlatform: Platform
    delta: Int!
    reason: String
    metadata: JSON
    txHash: String!
    snapshotOrdinal: BigInt!
    createdAt: DateTime!
  }

  type Contract {
    id: ID!
    contractId: String!
    proposer: Agent!
    counterparty: Agent!
    state: ContractState!
    terms: JSON!
    fiberId: String!
    snapshotOrdinal: BigInt!
    proposedAt: DateTime!
    acceptedAt: DateTime
    completedAt: DateTime
  }

  type ActivityEvent {
    eventType: EventType!
    timestamp: DateTime!
    snapshotOrdinal: BigInt
    agent: Agent
    action: String!
    reputationDelta: Int
    relatedAgent: Agent
    fiberId: String
  }

  type ReputationPoint {
    id: Int!
    reputation: Int!
    delta: Int!
    reason: String
    snapshotOrdinal: BigInt!
    recordedAt: DateTime!
  }

  type NetworkStats {
    totalAgents: Int!
    activeAgents: Int!
    totalContracts: Int!
    completedContracts: Int!
    totalAttestations: Int!
    totalFibers: Int!
    lastSnapshotOrdinal: Int!
  }

  type ClusterStats {
    gl0Nodes: Int!
    ml0Nodes: Int!
    dl1Nodes: Int!
    tps: Float!
    epoch: Int!
  }

  type StatsDelta {
    period: String!
    agentsDelta: Int!
    contractsDelta: Int!
    attestationsDelta: Int!
    fibersDelta: Int!
    agentsPct: Float!
    contractsPct: Float!
    successRatePct: Float!
    avgSnapshotsPerHour: Float!
    computedAt: DateTime!
  }

  type StatsTrends {
    oneHour: StatsDelta
    twentyFourHour: StatsDelta
    sevenDay: StatsDelta
  }

  # === Generic Fiber Types (chain-agnostic) ===

  type Fiber {
    fiberId: String!
    workflowType: String!
    workflowDesc: String
    currentState: String!
    status: FiberStatus!
    owners: [String!]!
    stateData: JSON!
    definition: JSON!
    sequenceNumber: Int!
    createdOrdinal: BigInt!
    updatedOrdinal: BigInt!
    createdGl0Ordinal: BigInt
    updatedGl0Ordinal: BigInt
    createdAt: DateTime!
    updatedAt: DateTime!
    transitions(limit: Int): [FiberTransition!]!
  }

  type FiberTransition {
    id: Int!
    eventName: String!
    fromState: String!
    toState: String!
    success: Boolean!
    gasUsed: Int!
    payload: JSON
    snapshotOrdinal: BigInt!
    gl0Ordinal: BigInt
    createdAt: DateTime!
  }

  type WorkflowType {
    name: String!
    description: String
    count: Int!
    states: [String!]!
  }

  type IndexedSnapshot {
    ordinal: BigInt!
    hash: String!
    status: SnapshotStatus!
    gl0Ordinal: BigInt
    confirmedAt: DateTime
    indexedAt: DateTime!
    agentsUpdated: Int!
    contractsUpdated: Int!
    fibersUpdated: Int!
  }

  enum SnapshotStatus {
    PENDING
    CONFIRMED
    ORPHANED
  }

  # === Enums ===

  enum AgentState {
    UNSPECIFIED
    REGISTERED
    ACTIVE
    CHALLENGED
    SUSPENDED
    PROBATION
    WITHDRAWN
  }

  enum Platform {
    DISCORD
    TELEGRAM
    TWITTER
    GITHUB
    CUSTOM
  }

  enum AttestationType {
    COMPLETION
    VOUCH
    VIOLATION
    BEHAVIORAL
  }

  enum ContractState {
    UNSPECIFIED
    PROPOSED
    ACTIVE
    COMPLETED
    REJECTED
    DISPUTED
    CANCELLED
  }

  enum EventType {
    ATTESTATION
    CONTRACT
    REGISTRATION
    TRANSITION
  }

  enum AgentOrderBy {
    REPUTATION_DESC
    REPUTATION_ASC
    CREATED_DESC
    CREATED_ASC
    NAME_ASC
  }

  enum FiberStatus {
    ACTIVE
    ARCHIVED
    FAILED
  }

  enum FiberOrderBy {
    CREATED_DESC
    CREATED_ASC
    UPDATED_DESC
    SEQUENCE_DESC
  }

  # === Market Types ===

  """
  The type of prediction/commitment market.
  Maps to the MarketType proto enum in the SDK.
  """
  enum MarketType {
    PREDICTION
    AUCTION
    CROWDFUND
    GROUP_BUY
  }

  """
  Lifecycle states for a market fiber.
  """
  enum MarketStatus {
    PROPOSED
    OPEN
    CLOSED
    RESOLVING
    SETTLED
    REFUNDED
    CANCELLED
  }

  enum MarketOrderBy {
    CREATED_DESC
    CREATED_ASC
    UPDATED_DESC
  }

  """
  A single participant commitment in a market.
  """
  type MarketCommitment {
    address: String!
    amount: Float!
    outcome: String
  }

  """
  A resolution submitted by an oracle.
  """
  type MarketResolution {
    outcome: String!
    resolvedBy: String!
    resolvedAt: String
  }

  """
  A market fiber — a specialized view over the generic Fiber record.
  All market-specific fields are extracted from stateData JSON.
  """
  type Market {
    # === Fiber base fields ===
    fiberId: String!
    currentState: String!
    status: FiberStatus!
    owners: [String!]!
    sequenceNumber: Int!
    createdOrdinal: BigInt!
    updatedOrdinal: BigInt!
    createdAt: DateTime!
    updatedAt: DateTime!
    transitions(limit: Int): [FiberTransition!]!

    # === Market-specific fields (from stateData) ===
    marketType: MarketType!
    marketStatus: MarketStatus!
    creator: String!
    title: String!
    description: String
    terms: JSON
    deadline: Float
    threshold: Float
    oracles: [String!]!
    quorum: Int!
    commitments: [MarketCommitment!]!
    totalCommitted: Float!
    resolutions: [MarketResolution!]!
    claims: JSON
  }

  """
  Aggregated statistics across all market fibers.
  """
  type MarketStats {
    totalMarkets: Int!
    byType: MarketTypeBreakdown!
    byStatus: MarketStatusBreakdown!
    totalCommitted: Float!
    activeOracles: Int!
  }

  type MarketTypeBreakdown {
    prediction: Int!
    auction: Int!
    crowdfund: Int!
    groupBuy: Int!
  }

  type MarketStatusBreakdown {
    proposed: Int!
    open: Int!
    closed: Int!
    resolving: Int!
    settled: Int!
    refunded: Int!
    cancelled: Int!
  }

  # === Queries ===

  type Query {
    agent(address: String!): Agent
    agentByPlatform(platform: Platform!, userId: String!): Agent
    
    agents(
      state: AgentState
      minReputation: Int
      maxReputation: Int
      limit: Int = 20
      offset: Int = 0
      orderBy: AgentOrderBy = REPUTATION_DESC
    ): [Agent!]!
    
    leaderboard(limit: Int = 10): [Agent!]!
    
    contract(contractId: String!): Contract
    contracts(
      agentAddress: String
      state: ContractState
      limit: Int = 20
      offset: Int = 0
    ): [Contract!]!
    
    recentActivity(limit: Int = 50): [ActivityEvent!]!
    networkStats: NetworkStats!
    clusterStats: ClusterStats!
    statsTrends: StatsTrends!
    searchAgents(query: String!, limit: Int = 10): [Agent!]!
    
    # Unified Search
    search(query: String!, limit: Int = 10): SearchResult!
    
    # Generic Fiber Queries (chain-agnostic)
    fiber(fiberId: String!): Fiber
    fibers(
      workflowType: String
      status: FiberStatus
      owner: String
      limit: Int = 20
      offset: Int = 0
      orderBy: FiberOrderBy = UPDATED_DESC
    ): [Fiber!]!
    
    workflowTypes: [WorkflowType!]!
    fibersByOwner(address: String!, limit: Int = 20): [Fiber!]!
    
    # Indexer status
    recentSnapshots(limit: Int = 20): [IndexedSnapshot!]!
    snapshot(ordinal: BigInt!): IndexedSnapshot

    # === Market Queries ===

    """
    Fetch a single market by its fiber ID.
    """
    market(marketId: String!): Market

    """
    List markets with optional filters.
    marketType filters by the type of market (PREDICTION, AUCTION, etc.).
    marketStatus filters by lifecycle stage.
    creator filters by creator DAG address.
    oracle filters to markets that include a specific oracle address.
    """
    marketsByType(
      marketType: MarketType
      marketStatus: MarketStatus
      creator: String
      oracle: String
      limit: Int = 20
      offset: Int = 0
      orderBy: MarketOrderBy = CREATED_DESC
    ): [Market!]!

    """
    Aggregated statistics for all market fibers.
    """
    marketStats: MarketStats!
  }

  # === Mutations ===

  type Mutation {
    """
    Register a new agent identity on-chain.
    Requires privateKey for signing (dev/testing) or signature for verification (production).
    """
    registerAgent(
      platform: Platform!
      platformUserId: String!
      platformUsername: String
      displayName: String
      privateKey: String
    ): RegisterResult!
    
    linkPlatform(
      agentAddress: String!
      platform: Platform!
      platformUserId: String!
      platformUsername: String
      signature: String!
    ): LinkResult!
    
    vouch(
      fromAddress: String!
      toAddress: String!
      reason: String
      signature: String
      privateKey: String
    ): AttestationResult!
    
    proposeContract(
      proposerAddress: String!
      counterpartyAddress: String!
      terms: JSON!
      signature: String
      privateKey: String
    ): ContractResult!
    
    acceptContract(
      contractId: String!
      agentAddress: String!
      signature: String!
    ): ContractResult!
    
    rejectContract(
      contractId: String!
      agentAddress: String!
      signature: String!
    ): ContractResult!
    
    completeContract(
      contractId: String!
      agentAddress: String!
      proof: String
      signature: String!
    ): ContractResult!
  }

  # === Search ===

  type SearchResult {
    fibers: [Fiber!]!
    agents: [Agent!]!
    transitions: [FiberTransition!]!
  }

  # === Mutation Results ===

  type RegisterResult {
    success: Boolean!
    agent: Agent
    txHash: String
    error: String
  }

  type LinkResult {
    success: Boolean!
    link: PlatformLink
    error: String
  }

  type AttestationResult {
    success: Boolean!
    attestation: Attestation
    txHash: String
    error: String
  }

  type ContractResult {
    success: Boolean!
    contract: Contract
    txHash: String
    error: String
  }

  # === Subscriptions ===

  type Subscription {
    agentUpdated(address: String!): Agent!
    newAttestation: Attestation!
    contractUpdated(contractId: String): Contract!
    activityFeed: ActivityEvent!
    statsUpdated: NetworkStats!

    """
    Subscribe to updates for a specific market or all markets.
    Pass marketId to receive updates for one market; omit for all markets.
    """
    marketUpdated(marketId: String): Market!
  }
`;
