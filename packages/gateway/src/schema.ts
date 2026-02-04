// GraphQL Schema Definition

export const typeDefs = /* GraphQL */ `
  scalar DateTime
  scalar JSON

  # === Types ===

  type Agent {
    address: String!
    publicKey: String!
    displayName: String
    reputation: Int!
    state: AgentState!
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
    createdAt: DateTime!
    txHash: String!
  }

  type Contract {
    id: ID!
    contractId: String!
    proposer: Agent!
    counterparty: Agent!
    state: ContractState!
    terms: JSON!
    proposedAt: DateTime!
    acceptedAt: DateTime
    completedAt: DateTime
  }

  type ActivityEvent {
    eventType: EventType!
    timestamp: DateTime!
    agent: Agent!
    action: String!
    reputationDelta: Int
    relatedAgent: Agent
  }

  type ReputationPoint {
    reputation: Int!
    delta: Int!
    reason: String
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
    createdAt: DateTime!
    updatedAt: DateTime!
    transitions(limit: Int): [FiberTransition!]!
  }

  type FiberTransition {
    eventName: String!
    fromState: String!
    toState: String!
    success: Boolean!
    gasUsed: Int!
    createdAt: DateTime!
  }

  type WorkflowType {
    name: String!
    description: String
    count: Int!
    states: [String!]!
  }

  # === Enums ===

  enum AgentState {
    REGISTERED
    ACTIVE
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
    PROPOSED
    ACTIVE
    COMPLETED
    REJECTED
    DISPUTED
  }

  enum EventType {
    ATTESTATION
    CONTRACT
    REGISTRATION
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
    searchAgents(query: String!, limit: Int = 10): [Agent!]!
    
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
  }

  # === Mutations ===

  type Mutation {
    registerAgent(
      platform: Platform!
      platformUserId: String!
      platformUsername: String
      displayName: String
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
      signature: String!
    ): AttestationResult!
    
    proposeContract(
      proposerAddress: String!
      counterpartyAddress: String!
      terms: JSON!
      signature: String!
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
  }
`;
