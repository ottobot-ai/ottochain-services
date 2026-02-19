# DAO Governance Test Patterns

This document describes the three comprehensive DAO governance test scenarios implemented for OttoChain traffic generation.

## Overview

The governance test patterns provide end-to-end validation of DAO functionality with multi-signer coordination, timing constraints, and real-world scenarios.

## Test Scenarios

### 1. dao-governance-flow-001: Full Governance Flow

**Purpose**: Complete proposal lifecycle testing
**Duration**: ~26 hours (2h discussion + 24h voting + timelock)
**Participants**: 5 (proposer, 3 voters, 1 guardian)

**Flow Sequence**:
```
ACTIVE → DISCUSSING → VOTING → QUEUED → EXECUTED
   ↓         ↓          ↓         ↓         ↓
propose → discuss(x3) → vote(x3) → queue → execute
```

**Key Features**:
- Discussion period with member comments
- Token-weighted voting (20k total supply)
- Quorum requirement (75% = 15k tokens)
- Guardian queue approval
- Timelock mechanism (2 hours)

**Test Assertions**:
- ✅ Quorum reached during voting
- ✅ Timelock activated after queue
- ✅ Proposal executed successfully
- ✅ Treasury transfer completed

### 2. dao-delegation-flow-001: Delegation Flow

**Purpose**: Token delegation mechanics with re-delegation
**Duration**: ~13 hours (12h voting + 1h timelock)
**Participants**: 5 (2 delegators, 2 delegates, 1 proposer)

**Flow Sequence**:
```
ACTIVE → DELEGATED → RE_DELEGATED → UNDELEGATED
   ↓         ↓           ↓             ↓
delegate → re_delegate → vote(delegated) → undelegate
```

**Key Features**:
- Delegation power transfer (8k + 6k tokens)
- Re-delegation to different delegate
- Voting with delegated power
- Power return on undelegation

**Voting Power Distribution**:
```
Initial:     Delegator1(8k) + Delegator2(6k) + Delegates(1k each)
Delegated:   Delegate1(9k) + Delegate2(7k) + Others(2k)
Re-delegated: Delegate1(1k) + Delegate2(13k) + Others(2k)
```

**Test Assertions**:
- ✅ Delegation power transferred correctly
- ✅ Re-delegation chain maintained
- ✅ Voting power returned on undelegation

### 3. dao-veto-flow-001: Emergency Veto Flow

**Purpose**: Guardian veto mechanism during active voting
**Duration**: ~7.5 hours (6h voting + 1h veto window + 30min timelock)
**Participants**: 5 (1 proposer, 2 voters, 2 guardians)

**Flow Sequence**:
```
ACTIVE → VOTING → VETO_PENDING → VETOED
   ↓        ↓          ↓            ↓
propose → vote(x2) → veto → confirm_veto
```

**Alternative Override Flow**:
```
VETO_PENDING → OVERRIDE → EXECUTED
      ↓           ↓          ↓
override_veto → support(75%) → confirm_override
```

**Key Features**:
- High-risk proposal detection
- Single guardian veto initiation
- Multi-guardian veto confirmation
- Super-majority override (75% threshold)
- Emergency response capability

**Test Assertions**:
- ✅ Veto initiated during voting period
- ✅ Guardian confirmation required
- ✅ Proposal blocked successfully

## Multi-Signer Coordination

### Timing Coordination

Each test scenario includes precise timing constraints:

```typescript
interface TimingConstraints {
  discussionPeriodMs?: number;  // Optional discussion window
  votingPeriodMs: number;       // Voting window duration
  timelockMs: number;           // Execution delay
  vetoWindowMs?: number;        // Guardian veto period
}
```

### Role-Based Actions

Participants are assigned specific roles with defined responsibilities:

```typescript
interface ParticipantRoles {
  proposer: string;      // Creates proposals, executes after timelock
  voters: string[];      // Cast votes, participate in discussions
  guardians: string[];   // Emergency veto, queue approvals
  delegates: string[];   // Receive delegated voting power
  delegators: string[];  // Delegate their voting power
}
```

## Test Implementation

### Fiber Definitions

Each test scenario is defined as a complete fiber definition:

```typescript
export const DAO_GOVERNANCE_TEST_FIBERS: Record<string, FiberDefinition> = {
  'dao-governance-flow-001': {
    type: 'dao-governance-flow-001',
    workflowType: 'DAO',
    daoType: 'token',
    roles: ['proposer', 'voter1', 'voter2', 'voter3', 'guardian'],
    states: ['ACTIVE', 'DISCUSSING', 'VOTING', 'QUEUED', 'EXECUTED'],
    transitions: [/* complete state machine */],
    generateStateData: (participants, ctx) => { /* initial state */ }
  }
};
```

### Integration Tests

Comprehensive test suite validates each scenario:

```bash
npm test -- governance-workflows.test.ts
```

**Test Coverage**:
- ✅ Fiber definition validation
- ✅ State machine transitions
- ✅ Multi-signer coordination
- ✅ Timing constraint enforcement
- ✅ Voting power calculations
- ✅ Error handling and edge cases

## Usage Examples

### Running Individual Test Scenarios

```typescript
import { DAO_GOVERNANCE_TEST_FIBERS, generateGovernanceTestConfigs } from './governance-workflows.js';

// Get test configuration
const configs = generateGovernanceTestConfigs();
const fullFlowConfig = configs.find(c => c.fiberType === 'dao-governance-flow-001');

// Create participants
const participants = Array.from(fullFlowConfig.participants.entries());

// Execute test scenario
for (const transition of fullFlowConfig.expectedTransitions) {
  await bridge.transitionFiber(/* params based on transition */);
}
```

### Custom Test Scenarios

Extend the patterns for specific use cases:

```typescript
// Custom governance flow with specific timing
const customFlow: FiberDefinition = {
  ...DAO_GOVERNANCE_TEST_FIBERS['dao-governance-flow-001'],
  generateStateData: (participants, ctx) => ({
    ...originalState,
    votingPeriodMs: 1 * 60 * 60 * 1000,  // 1 hour for fast testing
    proposalThreshold: 500,               // Lower threshold
    quorum: 8000                          // Adjusted quorum
  })
};
```

## Performance Benchmarks

### Expected Performance Metrics

| Scenario | Participants | Transitions | Duration | Assertions |
|----------|-------------|-------------|----------|------------|
| Full Governance | 5 | 10 | ~26 hours | 3 |
| Delegation Flow | 5 | 9 | ~13 hours | 3 |
| Emergency Veto | 5 | 6 | ~7.5 hours | 3 |

### Load Testing Scenarios

- **Concurrent Proposals**: Multiple governance flows in parallel
- **High-Frequency Voting**: Rapid vote casting during voting period
- **Delegation Chains**: Complex multi-level delegation patterns
- **Veto Stress**: Multiple simultaneous veto attempts

## Troubleshooting

### Common Issues

1. **Transition Validation Failures**
   - Check role permissions for each transition
   - Verify timing constraints are met
   - Ensure proper state sequence

2. **Voting Power Mismatches**
   - Validate delegation mappings
   - Check balance updates after delegation
   - Verify quorum calculations

3. **Timing Constraint Violations**
   - Allow sufficient time for each phase
   - Account for network latency in tests
   - Use realistic timelock periods

### Debug Utilities

```typescript
import { validateGovernanceTransitions, calculateVotingPower } from './governance-workflows.js';

// Validate transition sequence
const validation = validateGovernanceTransitions(fiberType, actual, expected);
if (!validation.valid) {
  console.log('Validation errors:', validation.errors);
}

// Check voting power distribution
const power = calculateVotingPower(address, balances, delegations);
console.log(`Voting power for ${address}: ${power}`);
```

## Integration with OttoChain Bridge

The governance test scenarios integrate with the existing OttoChain Bridge API:

### Bridge Methods Used

- `bridge.createDAO()` - Initialize DAO fiber
- `bridge.transitionFiber()` - Execute state transitions
- `bridge.govPropose()` - Create proposals
- `bridge.govVote()` - Cast votes
- `bridge.govFinalize()` - Complete voting
- `bridge.govRaiseDispute()` - Emergency actions

### State Synchronization

Test scenarios validate proper state synchronization between:
- Bridge API responses
- Indexer state updates  
- Explorer UI updates
- WebSocket event streams

## Future Enhancements

### Additional Test Scenarios

- **Complex Delegation Chains**: Multi-level delegation hierarchies
- **Proposal Amendments**: Mid-voting proposal modifications
- **Batch Voting**: Multiple proposals voted simultaneously
- **Cross-DAO Coordination**: Multi-DAO governance interactions

### Advanced Features

- **Automated Regression Testing**: CI/CD integration
- **Performance Monitoring**: Real-time metrics collection  
- **Chaos Engineering**: Failure injection testing
- **Load Balancing**: Multi-node test distribution

---

For implementation details, see:
- `governance-workflows.ts` - Test fiber definitions
- `governance-workflows.test.ts` - Integration tests
- `fiber-definitions.ts` - Main fiber registry