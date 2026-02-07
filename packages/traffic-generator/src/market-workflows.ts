/**
 * Market Workflows
 * 
 * Defines transition flows for different market types:
 * - Prediction markets: create → open → commits → close → oracle resolution → finalize
 * - Auctions: create → open → bids → close → winner determination → finalize
 * - Crowdfunding: create → open → pledges → close → threshold check → settle/refund
 * - Group buys: create → open → orders → close → threshold check → settle/refund
 */

import type { Market, MarketType, MarketState, SimulationContext, Agent } from './types.js';
import { MarketState as MS } from './types.js';

// ============================================================================
// Market State Machine Definition (mirrors JSON)
// ============================================================================

export const MARKET_SM_DEFINITION = {
  metadata: {
    name: 'Market',
    description: 'Universal market state machine: predictions, auctions, crowdfunding, group buys',
    version: '1.0.0',
  },
  states: {
    PROPOSED: { id: { value: 'PROPOSED' }, isFinal: false },
    OPEN: { id: { value: 'OPEN' }, isFinal: false },
    CLOSED: { id: { value: 'CLOSED' }, isFinal: false },
    RESOLVING: { id: { value: 'RESOLVING' }, isFinal: false },
    SETTLED: { id: { value: 'SETTLED' }, isFinal: true },
    REFUNDED: { id: { value: 'REFUNDED' }, isFinal: true },
    CANCELLED: { id: { value: 'CANCELLED' }, isFinal: true },
  },
  initialState: { value: 'PROPOSED' },
};

// ============================================================================
// Transition Weights by Market Type and State
// ============================================================================

/**
 * Base transition weights for each market type at each state.
 * Keys are event names, values are base weights (before agent/context modifiers).
 */
export const MARKET_TRANSITION_WEIGHTS: Record<
  MarketType,
  Record<string, Record<string, number>>
> = {
  prediction: {
    PROPOSED: {
      open: 0.9,      // Usually open quickly
      cancel: 0.1,    // Sometimes creator cancels
    },
    OPEN: {
      commit: 0.8,    // Participants make predictions
      close: 0.15,    // Creator may close early
      // Self-transition for commit handled specially
    },
    CLOSED: {
      submit_resolution: 0.95,  // Oracle resolves
      refund: 0.05,   // Rare: invalid market
    },
    RESOLVING: {
      submit_resolution: 0.3,   // Additional oracles
      finalize: 0.6,  // Quorum reached
      refund: 0.1,    // Disputed/invalid
    },
    SETTLED: {
      claim: 1.0,     // Winners claim
    },
  },
  auction: {
    PROPOSED: {
      open: 0.95,
      cancel: 0.05,
    },
    OPEN: {
      commit: 0.85,   // Bids come in
      close: 0.1,     // End auction
    },
    CLOSED: {
      submit_resolution: 0.9,  // Determine winner
      refund: 0.1,    // No bids / reserve not met
    },
    RESOLVING: {
      finalize: 0.95, // Award to winner
      refund: 0.05,   // Edge cases
    },
    SETTLED: {
      claim: 1.0,
    },
  },
  crowdfund: {
    PROPOSED: {
      open: 0.9,
      cancel: 0.1,
    },
    OPEN: {
      commit: 0.75,   // Pledges
      close: 0.2,     // Deadline
    },
    CLOSED: {
      submit_resolution: 0.4,  // Check threshold
      refund: 0.6,    // Often fails threshold
    },
    RESOLVING: {
      finalize: 0.8,
      refund: 0.2,
    },
    SETTLED: {
      claim: 1.0,
    },
  },
  group_buy: {
    PROPOSED: {
      open: 0.95,
      cancel: 0.05,
    },
    OPEN: {
      commit: 0.8,    // Orders
      close: 0.15,
    },
    CLOSED: {
      submit_resolution: 0.5,  // Check min units
      refund: 0.5,    // May not reach min
    },
    RESOLVING: {
      finalize: 0.85,
      refund: 0.15,
    },
    SETTLED: {
      claim: 1.0,
    },
  },
};

// ============================================================================
// Available Events by State
// ============================================================================

/**
 * Get available events for a market in a given state.
 * Some events require specific roles (creator, oracle, participant).
 */
export function getAvailableMarketEvents(
  market: Market,
  agentAddress: string
): string[] {
  const isCreator = market.creator === agentAddress;
  const isOracle = market.oracles.includes(agentAddress);
  const hasCommitment = agentAddress in market.commitments;
  const hasClaimed = agentAddress in market.claims;

  switch (market.state) {
    case MS.PROPOSED:
      // Only creator can open or cancel
      return isCreator ? ['open', 'cancel'] : [];

    case MS.OPEN:
      const events: string[] = [];
      // Anyone can commit (if not creator for some market types)
      if (market.marketType !== 'auction' || !isCreator) {
        events.push('commit');
      }
      // Creator can close
      if (isCreator) {
        events.push('close');
      }
      return events;

    case MS.CLOSED:
      // Oracle or creator can submit resolution
      if (isOracle || isCreator) {
        // Check if already submitted
        const hasResolved = market.resolutions.some(r => r.oracle === agentAddress);
        if (!hasResolved) {
          return ['submit_resolution'];
        }
      }
      // Creator can trigger refund if threshold not met
      if (isCreator && market.threshold && market.totalCommitted < market.threshold) {
        return ['refund'];
      }
      return [];

    case MS.RESOLVING:
      const resolvingEvents: string[] = [];
      // Additional oracles can still submit
      if (isOracle) {
        const hasResolved = market.resolutions.some(r => r.oracle === agentAddress);
        if (!hasResolved) {
          resolvingEvents.push('submit_resolution');
        }
      }
      // Anyone can trigger finalize if quorum met
      if (market.resolutions.length >= market.quorum) {
        resolvingEvents.push('finalize');
      }
      // Creator can trigger refund in dispute
      if (isCreator) {
        resolvingEvents.push('refund');
      }
      return resolvingEvents;

    case MS.SETTLED:
      // Participants with commitments can claim (if not already claimed)
      if (hasCommitment && !hasClaimed) {
        return ['claim'];
      }
      return [];

    case MS.REFUNDED:
    case MS.CANCELLED:
      // Final states - no actions
      return [];

    default:
      return [];
  }
}

// ============================================================================
// Workflow Helpers
// ============================================================================

/**
 * Select a market type based on configured weights.
 */
export function selectMarketType(weights: [number, number, number, number]): MarketType {
  const types: MarketType[] = ['prediction', 'auction', 'crowdfund', 'group_buy'];
  const total = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * total;
  
  for (let i = 0; i < weights.length; i++) {
    random -= weights[i];
    if (random <= 0) return types[i];
  }
  return types[0];
}

/**
 * Generate initial market data based on type.
 */
export function generateMarketData(
  marketType: MarketType,
  creator: string,
  oracles: string[],
  deadlineTimestamp: number | null
): Record<string, unknown> {
  const baseData = {
    schema: 'Market',
    marketType,
    creator,
    oracles,
    quorum: Math.min(oracles.length, 3),
    deadline: deadlineTimestamp,
    commitments: {},
    totalCommitted: 0,
    resolutions: [],
    claims: {},
    status: 'PROPOSED',
  };

  switch (marketType) {
    case 'prediction':
      return {
        ...baseData,
        title: `Prediction Market #${Date.now().toString(36)}`,
        description: 'Will the condition be met?',
        threshold: null,
        terms: {
          question: 'Simulated prediction question',
          outcomes: ['YES', 'NO'],
          feePercent: 2,
        },
      };

    case 'auction':
      const reservePrice = Math.floor(Math.random() * 100) + 10;
      return {
        ...baseData,
        title: `Auction #${Date.now().toString(36)}`,
        description: 'Bid on this item',
        threshold: reservePrice, // Reserve price as threshold
        terms: {
          item: 'Simulated auction item',
          reservePrice,
          buyNowPrice: reservePrice * 3,
        },
      };

    case 'crowdfund':
      const goal = Math.floor(Math.random() * 1000) + 100;
      return {
        ...baseData,
        title: `Crowdfund #${Date.now().toString(36)}`,
        description: 'Help fund this project',
        threshold: goal,
        terms: {
          goal,
          rewards: [
            { tier: 'supporter', minAmount: 10 },
            { tier: 'backer', minAmount: 50 },
            { tier: 'sponsor', minAmount: 100 },
          ],
          allOrNothing: true,
        },
      };

    case 'group_buy':
      const minUnits = Math.floor(Math.random() * 10) + 5;
      return {
        ...baseData,
        title: `Group Buy #${Date.now().toString(36)}`,
        description: 'Join to get bulk pricing',
        threshold: minUnits * 10, // minUnits * unitPrice
        terms: {
          product: 'Simulated product',
          unitPrice: 10,
          bulkPrice: 7,
          minUnits,
        },
      };
  }
}

/**
 * Compute transition weight for a market event.
 */
export function computeMarketTransitionWeight(
  market: Market,
  event: string,
  agent: Agent,
  context: SimulationContext
): { weight: number; payload: Record<string, unknown>; isMutation: boolean } {
  const baseWeights = MARKET_TRANSITION_WEIGHTS[market.marketType][market.state] ?? {};
  const baseWeight = baseWeights[event] ?? 0.5;
  
  // Check for mutation
  const isMutation = Math.random() < context.mutationRate;
  
  // Modify weight based on agent characteristics
  let weight = baseWeight;
  
  // Risk tolerance affects willingness to commit
  if (event === 'commit') {
    weight *= 0.5 + agent.meta.riskTolerance * 0.5;
  }
  
  // Market health affects participation
  weight *= context.marketHealth;
  
  // Age/experience affects confidence
  if (agent.fitness.age > 10) {
    weight *= 1.1;
  }
  
  // Apply mutation
  if (isMutation) {
    weight = 1 - weight;
  }
  
  const payload = generateMarketEventPayload(market, event, agent);
  
  return { weight: Math.max(0.01, weight), payload, isMutation };
}

/**
 * Generate payload for a market event.
 */
function generateMarketEventPayload(
  market: Market,
  event: string,
  agent: Agent
): Record<string, unknown> {
  const timestamp = Date.now();

  switch (event) {
    case 'open':
      return { agent: agent.address };

    case 'cancel':
      return { agent: agent.address, reason: 'Simulated cancellation' };

    case 'commit':
      return generateCommitPayload(market, agent);

    case 'close':
      return { agent: agent.address };

    case 'submit_resolution':
      return generateResolutionPayload(market, agent);

    case 'finalize':
      return generateFinalizePayload(market);

    case 'refund':
      return { agent: agent.address, reason: 'Simulated refund trigger' };

    case 'claim':
      return { agent: agent.address, amount: calculateClaimAmount(market, agent.address) };

    default:
      return { agent: agent.address, timestamp };
  }
}

/**
 * Generate commit payload based on market type.
 */
function generateCommitPayload(market: Market, agent: Agent): Record<string, unknown> {
  const baseAmount = Math.floor(Math.random() * 50) + 5;
  const amount = Math.floor(baseAmount * (0.5 + agent.meta.riskTolerance));

  switch (market.marketType) {
    case 'prediction':
      return {
        agent: agent.address,
        amount,
        data: {
          prediction: Math.random() > 0.5 ? 'YES' : 'NO',
        },
      };

    case 'auction':
      // Bid at least current max + increment
      const currentMax = Math.max(
        ...Object.values(market.commitments).map(c => c.amount),
        (market.terms as { reservePrice?: number }).reservePrice ?? 0
      );
      const bid = currentMax + Math.floor(Math.random() * 20) + 5;
      return {
        agent: agent.address,
        amount: bid,
        data: { bidType: 'standard' },
      };

    case 'crowdfund':
      return {
        agent: agent.address,
        amount,
        data: { tier: amount >= 100 ? 'sponsor' : amount >= 50 ? 'backer' : 'supporter' },
      };

    case 'group_buy':
      const units = Math.floor(Math.random() * 3) + 1;
      return {
        agent: agent.address,
        amount: units * ((market.terms as { unitPrice?: number }).unitPrice ?? 10),
        data: { units },
      };

    default:
      return { agent: agent.address, amount };
  }
}

/**
 * Generate resolution payload based on market type.
 */
function generateResolutionPayload(market: Market, agent: Agent): Record<string, unknown> {
  switch (market.marketType) {
    case 'prediction':
      // Oracle determines outcome
      return {
        agent: agent.address,
        outcome: Math.random() > 0.5 ? 'YES' : 'NO',
        proof: `oracle-proof-${Date.now().toString(36)}`,
      };

    case 'auction':
      // Find highest bidder
      let highestBidder = '';
      let highestBid = 0;
      for (const [addr, commitment] of Object.entries(market.commitments)) {
        if (commitment.amount > highestBid) {
          highestBid = commitment.amount;
          highestBidder = addr;
        }
      }
      return {
        agent: agent.address,
        outcome: highestBidder,
        proof: `auction-result-${Date.now().toString(36)}`,
      };

    case 'crowdfund':
    case 'group_buy':
      // Check if threshold met
      const thresholdMet = market.totalCommitted >= (market.threshold ?? 0);
      return {
        agent: agent.address,
        outcome: thresholdMet ? 'SUCCESS' : 'FAILED',
        proof: `threshold-check-${Date.now().toString(36)}`,
      };

    default:
      return { agent: agent.address, outcome: 'RESOLVED' };
  }
}

/**
 * Generate finalize payload.
 */
function generateFinalizePayload(market: Market): Record<string, unknown> {
  // Determine final outcome from resolutions
  const outcomes = market.resolutions.map(r => r.outcome);
  const outcomeCounts = outcomes.reduce((acc, o) => {
    acc[String(o)] = (acc[String(o)] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  // Majority outcome wins
  let finalOutcome = outcomes[0];
  let maxCount = 0;
  for (const [outcome, count] of Object.entries(outcomeCounts)) {
    if (count > maxCount) {
      maxCount = count;
      finalOutcome = outcome;
    }
  }

  return {
    outcome: finalOutcome,
    settlement: {
      finalizedAt: Date.now(),
      outcomeVotes: outcomeCounts,
    },
  };
}

/**
 * Calculate claim amount for a participant.
 */
function calculateClaimAmount(market: Market, agentAddress: string): number {
  const commitment = market.commitments[agentAddress];
  if (!commitment) return 0;

  switch (market.marketType) {
    case 'prediction':
      // Winners get proportional share
      if (commitment.data?.prediction === market.finalOutcome) {
        // Calculate share of losing pool
        const winningPool = Object.entries(market.commitments)
          .filter(([_, c]) => c.data?.prediction === market.finalOutcome)
          .reduce((sum, [_, c]) => sum + c.amount, 0);
        const losingPool = market.totalCommitted - winningPool;
        const share = commitment.amount / winningPool;
        return commitment.amount + Math.floor(losingPool * share * 0.98); // 2% fee
      }
      return 0; // Losers get nothing

    case 'auction':
      // Only winner claims (gets item), losers get refund
      if (agentAddress === market.finalOutcome) {
        return 0; // Winner "paid" for item, no refund
      }
      return commitment.amount; // Losing bidders get refund

    case 'crowdfund':
    case 'group_buy':
      // If successful, no refund (value delivered)
      // If failed, full refund (handled by REFUNDED state)
      return market.finalOutcome === 'SUCCESS' ? 0 : commitment.amount;

    default:
      return commitment.amount;
  }
}

/**
 * Check if a market should be auto-closed (deadline passed).
 */
export function shouldAutoClose(market: Market, currentTimestamp: number): boolean {
  if (market.state !== MS.OPEN) return false;
  if (!market.deadline) return false;
  return currentTimestamp >= market.deadline;
}

/**
 * Determine if an agent should participate in a market.
 */
export function shouldParticipateInMarket(
  agent: Agent,
  market: Market,
  context: SimulationContext
): boolean {
  // Can't participate in own market for some types
  if (market.creator === agent.address && market.marketType === 'auction') {
    return false;
  }
  
  // Already committed?
  if (agent.address in market.commitments) {
    // Can re-commit in some cases (auctions - bid higher)
    if (market.marketType === 'auction') {
      return Math.random() < 0.3; // 30% chance to bid again
    }
    return false;
  }
  
  // Active in too many markets?
  if (agent.meta.activeMarkets.size >= 5) {
    return false;
  }
  
  // Risk-based decision
  const participationChance = 0.3 + agent.meta.riskTolerance * 0.4;
  return Math.random() < participationChance * context.marketHealth;
}

/**
 * Select oracles from the population for a new market.
 */
export function selectOracles(
  population: Agent[],
  count: number,
  excludeAddress: string
): string[] {
  const eligible = population.filter(
    a => a.state === 'ACTIVE' && 
         a.address !== excludeAddress && 
         a.meta.isOracle
  );
  
  if (eligible.length === 0) return [];
  
  // Prefer high-reputation oracles
  const sorted = [...eligible].sort((a, b) => b.fitness.reputation - a.fitness.reputation);
  return sorted.slice(0, count).map(a => a.address);
}
