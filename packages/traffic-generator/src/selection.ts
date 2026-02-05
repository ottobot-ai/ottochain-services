/**
 * Selection Algorithms
 * 
 * Genetic algorithm-inspired selection mechanisms for agent activity
 * and transition path choices.
 */

import type { Agent, TransitionChoice, SimulationContext } from './types.js';

// ============================================================================
// Fitness Computation
// ============================================================================

/**
 * Compute total fitness for an agent.
 * Higher fitness = more likely to be selected for activity.
 */
export function computeFitness(agent: Agent): number {
  const { fitness } = agent;
  
  // Weighted sum of fitness components
  const weights = {
    reputation: 0.4,      // On-chain reputation is primary
    completionRate: 0.25, // Reliability matters
    networkEffect: 0.2,   // Well-connected agents are valuable
    age: 0.15,            // Survival bonus
  };
  
  return (
    weights.reputation * normalizeReputation(fitness.reputation) +
    weights.completionRate * fitness.completionRate +
    weights.networkEffect * fitness.networkEffect +
    weights.age * normalizeAge(fitness.age)
  );
}

/**
 * Normalize reputation to 0-1 range using sigmoid.
 * Reputation of 50 -> ~0.5, 100 -> ~0.73, 200 -> ~0.88
 */
function normalizeReputation(rep: number): number {
  return 1 / (1 + Math.exp(-0.02 * (rep - 50)));
}

/**
 * Normalize age with diminishing returns.
 * Age 10 -> 0.63, 20 -> 0.86, 50 -> 0.99
 */
function normalizeAge(age: number): number {
  return 1 - Math.exp(-0.1 * age);
}

// ============================================================================
// Agent Selection
// ============================================================================

/**
 * Roulette wheel selection: select agent proportional to fitness.
 * Returns null if population is empty or all fitness is zero.
 */
export function selectAgentByFitness(
  population: Agent[],
  excludeAddresses: Set<string> = new Set()
): Agent | null {
  const eligible = population.filter(
    (a) => a.state === 'active' && !excludeAddresses.has(a.address)
  );
  
  if (eligible.length === 0) return null;
  
  const totalFitness = eligible.reduce((sum, a) => sum + a.fitness.total, 0);
  if (totalFitness <= 0) {
    // Uniform selection if all fitness is zero
    return eligible[Math.floor(Math.random() * eligible.length)];
  }
  
  let random = Math.random() * totalFitness;
  for (const agent of eligible) {
    random -= agent.fitness.total;
    if (random <= 0) return agent;
  }
  
  // Fallback (shouldn't happen)
  return eligible[eligible.length - 1];
}

/**
 * Select multiple agents for activity this generation.
 * Uses fitness-weighted selection without replacement.
 */
export function selectActiveAgents(
  population: Agent[],
  count: number
): Agent[] {
  const selected: Agent[] = [];
  const excluded = new Set<string>();
  
  for (let i = 0; i < count && selected.length < population.length; i++) {
    const agent = selectAgentByFitness(population, excluded);
    if (agent) {
      selected.push(agent);
      excluded.add(agent.address);
    }
  }
  
  return selected;
}

/**
 * Select a counterparty for a contract proposal.
 * Prefers agents with:
 *  - High reputation (trustworthy)
 *  - Existing network connection (previous vouches)
 *  - Compatible risk tolerance
 */
export function selectCounterparty(
  proposer: Agent,
  population: Agent[]
): Agent | null {
  const eligible = population.filter(
    (a) =>
      a.state === 'active' &&
      a.address !== proposer.address &&
      !proposer.meta.activeContracts.has(a.address) // Not already in contract
  );
  
  if (eligible.length === 0) return null;
  
  // Compute affinity scores
  const scored = eligible.map((candidate) => {
    let score = candidate.fitness.total;
    
    // Bonus for existing network connection
    if (proposer.meta.vouchedFor.has(candidate.address)) {
      score *= 1.3;
    }
    if (proposer.meta.receivedVouches.has(candidate.address)) {
      score *= 1.2;
    }
    
    // Penalty for very different risk tolerance
    const riskDiff = Math.abs(proposer.meta.riskTolerance - candidate.meta.riskTolerance);
    score *= 1 - (riskDiff * 0.3);
    
    return { agent: candidate, score };
  });
  
  // Roulette selection on scores
  const totalScore = scored.reduce((sum, s) => sum + Math.max(0, s.score), 0);
  if (totalScore <= 0) {
    return eligible[Math.floor(Math.random() * eligible.length)];
  }
  
  let random = Math.random() * totalScore;
  for (const { agent, score } of scored) {
    random -= Math.max(0, score);
    if (random <= 0) return agent;
  }
  
  return eligible[eligible.length - 1];
}

// ============================================================================
// Transition Selection
// ============================================================================

/**
 * Softmax selection with temperature for transition choices.
 * 
 * Temperature controls exploration vs exploitation:
 *  - High temp (>1): More exploration, flatter distribution
 *  - Low temp (<1): More exploitation, sharper distribution
 *  - Temp = 0: Deterministic (always highest weight)
 */
export function softmaxSelect(
  choices: TransitionChoice[],
  temperature: number
): TransitionChoice | null {
  if (choices.length === 0) return null;
  if (choices.length === 1) return choices[0];
  
  // Avoid division by zero
  const temp = Math.max(temperature, 0.001);
  
  // Compute softmax probabilities
  const maxWeight = Math.max(...choices.map((c) => c.weight));
  const expWeights = choices.map((c) => Math.exp((c.weight - maxWeight) / temp));
  const sumExp = expWeights.reduce((a, b) => a + b, 0);
  
  if (sumExp <= 0) {
    return choices[Math.floor(Math.random() * choices.length)];
  }
  
  const probabilities = expWeights.map((e) => e / sumExp);
  
  // Sample from distribution
  let random = Math.random();
  for (let i = 0; i < choices.length; i++) {
    random -= probabilities[i];
    if (random <= 0) return choices[i];
  }
  
  return choices[choices.length - 1];
}

/**
 * Compute transition weights for an agent in a given state.
 * Weights depend on:
 *  - Historical success rate of this transition
 *  - Agent's risk tolerance
 *  - Current market conditions
 *  - Small mutation chance for exploration
 */
export function computeTransitionWeights(
  agent: Agent,
  availableEvents: string[],
  context: SimulationContext
): TransitionChoice[] {
  const choices: TransitionChoice[] = [];
  
  for (const event of availableEvents) {
    const { weight, payload, isMutation } = getTransitionWeight(
      event,
      agent,
      context
    );
    choices.push({ event, weight, payload, isMutation });
  }
  
  return choices;
}

/**
 * Get weight and payload for a specific transition event.
 */
function getTransitionWeight(
  event: string,
  agent: Agent,
  context: SimulationContext
): { weight: number; payload: Record<string, unknown>; isMutation: boolean } {
  const { marketHealth, mutationRate } = context;
  const { riskTolerance } = agent.meta;
  
  // Check for mutation (random unexpected choice)
  const isMutation = Math.random() < mutationRate;
  
  // Base weights for different events
  const baseWeights: Record<string, number> = {
    // Agent identity events
    activate: 1.0,
    submit_attestation: 0.7,
    submit_violation: 0.1 + riskTolerance * 0.3, // Risky agents more likely to violate
    file_challenge: 0.05 + riskTolerance * 0.2,
    withdraw: 0.02 * (1 - agent.fitness.total), // Low fitness -> more likely to withdraw
    
    // Contract events
    accept: 0.8 * marketHealth,
    reject: 0.2 + (1 - marketHealth) * 0.3,
    complete: 0.9,
    dispute: 0.05 + riskTolerance * 0.15,
  };
  
  const baseWeight = baseWeights[event] ?? 0.5;
  
  // Apply mutation: flip weight for unexpected behavior
  const weight = isMutation ? 1 - baseWeight : baseWeight;
  
  // Generate appropriate payload
  const payload = generatePayload(event, agent);
  
  return { weight: Math.max(0.01, weight), payload, isMutation };
}

/**
 * Generate payload for a transition event.
 */
function generatePayload(
  event: string,
  agent: Agent
): Record<string, unknown> {
  const timestamp = Date.now();
  
  switch (event) {
    case 'activate':
      return { timestamp };
      
    case 'submit_attestation':
      const types = ['BEHAVIORAL', 'COMPLETION', 'VOUCH'];
      return {
        timestamp,
        attestationType: types[Math.floor(Math.random() * types.length)],
        platformId: agent.meta.platform,
      };
      
    case 'submit_violation':
      return {
        timestamp,
        platformId: agent.meta.platform,
        reason: 'Simulated violation event',
      };
      
    case 'file_challenge':
      return {
        timestamp,
        challengerId: agent.address,
        challengerStake: 100,
        reason: 'Simulated challenge',
        evidenceHash: `sim-evidence-${timestamp}`,
      };
      
    case 'accept':
    case 'reject':
      return {
        timestamp,
        acceptorId: agent.address,
        reason: event === 'reject' ? 'Simulated rejection' : undefined,
      };
      
    case 'complete':
      return {
        timestamp,
        proof: `sim-proof-${timestamp}`,
      };
      
    case 'dispute':
      return {
        timestamp,
        disputerId: agent.address,
        reason: 'Simulated dispute',
      };
      
    case 'withdraw':
      return { timestamp };
      
    default:
      return { timestamp };
  }
}

// ============================================================================
// Population Dynamics
// ============================================================================

/**
 * Select agents for death (withdrawal) based on inverse fitness.
 * Lower fitness = more likely to be selected for withdrawal.
 */
export function selectForDeath(
  population: Agent[],
  count: number
): Agent[] {
  const eligible = population.filter((a) => a.state === 'active');
  if (eligible.length === 0) return [];
  
  // Invert fitness for death selection
  const inverted = eligible.map((a) => ({
    agent: a,
    inverseFitness: 1 / (a.fitness.total + 0.1), // +0.1 to avoid division by zero
  }));
  
  const totalInverse = inverted.reduce((sum, i) => sum + i.inverseFitness, 0);
  
  const selected: Agent[] = [];
  const excluded = new Set<string>();
  
  for (let i = 0; i < count && selected.length < eligible.length; i++) {
    let random = Math.random() * totalInverse;
    for (const { agent, inverseFitness } of inverted) {
      if (excluded.has(agent.address)) continue;
      random -= inverseFitness;
      if (random <= 0) {
        selected.push(agent);
        excluded.add(agent.address);
        break;
      }
    }
  }
  
  return selected;
}
