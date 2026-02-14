/**
 * Trust Calculator Service
 * 
 * Implements the multi-factor agent selection algorithm:
 * Trust Score (50%) + Availability (30%) + Cost Efficiency (20%)
 * 
 * Provides trust-based agent ranking with capability filtering.
 */

import { AgentReputation } from '../routes/reputation.js';

// Core interfaces for agent selection
export interface AgentCapabilities {
  agentId: string;
  skills: string[];
  models: string[];
  hardware: {
    cpu: number;
    memory: string;
    gpu?: string;
  };
  availability: {
    isOnline: boolean;
    lastSeen: Date;
    responseTimeMs: number;
    uptime24h: number;
  };
  pricing: {
    baseRate: number;
    skillModifiers: Record<string, number>;
    currency: string;
  };
  performance: {
    avgTaskDuration: number;
    successRate: number;
    avgQuality: number;
  };
}

export interface TaskRequirements {
  skills: string[];
  models?: string[];
  minHardware?: {
    cpu?: number;
    memory?: string;
    gpu?: boolean;
  };
  maxBudget?: number;
  minReputationScore?: number;
  requiresRealTime?: boolean;
  complexity?: number; // 1-5 scale
}

export interface AgentSelectionCriteria {
  requiredScore: number;
  domains?: string[];
  maxCandidates: number;
  excludeAgents?: string[];
  requireActive: boolean;
  taskRequirements?: TaskRequirements;
}

export interface AgentRecommendation {
  agentId: string;
  finalScore: number;
  breakdown: {
    trustScore: number;
    availabilityScore: number;
    costEfficiencyScore: number;
    specializationBonus: number;
  };
  reputation: AgentReputation;
  capabilities: AgentCapabilities;
  reasoning: string[];
}

export interface TrustCalculationWeights {
  trust: number;
  availability: number;
  costEfficiency: number;
}

const DEFAULT_WEIGHTS: TrustCalculationWeights = {
  trust: 0.5,
  availability: 0.3,
  costEfficiency: 0.2,
};

export class TrustCalculator {
  private weights: TrustCalculationWeights;
  private cache: Map<string, { score: number; timestamp: Date }>;
  private cacheTtlMs: number;

  constructor(
    weights: TrustCalculationWeights = DEFAULT_WEIGHTS,
    cacheTtlMs: number = 300000 // 5 minutes
  ) {
    this.weights = weights;
    this.cache = new Map();
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Calculate trust score based on reputation and historical performance
   */
  calculateTrustScore(
    reputation: AgentReputation,
    capabilities: AgentCapabilities,
    taskRequirements?: TaskRequirements
  ): number {
    const cacheKey = `trust_${reputation.agentId}_${JSON.stringify(taskRequirements)}`;
    const cached = this.getCachedScore(cacheKey);
    if (cached !== null) {
      return cached;
    }

    let trustScore = reputation.overallScore;

    // Specialization bonus for matching skills
    if (taskRequirements?.skills) {
      const skillMatch = this.calculateSkillMatch(capabilities.skills, taskRequirements.skills);
      const specializationBonus = Math.min(skillMatch * 0.2, 0.2); // Max 20% bonus
      trustScore += specializationBonus;
    }

    // Performance bonus based on historical success
    const performanceBonus = (capabilities.performance.successRate - 0.8) * 0.1; // Above 80% gets bonus
    trustScore += Math.max(performanceBonus, 0);

    // Recent failure penalty
    const recentFailurePenalty = this.calculateRecentFailurePenalty(reputation);
    trustScore -= recentFailurePenalty;

    // Clamp to [0, 1]
    const finalTrustScore = Math.max(0, Math.min(1, trustScore));

    this.setCachedScore(cacheKey, finalTrustScore);
    return finalTrustScore;
  }

  /**
   * Calculate availability score based on uptime and response time
   */
  calculateAvailabilityScore(capabilities: AgentCapabilities): number {
    if (!capabilities.availability.isOnline) {
      return 0;
    }

    // Time since last seen (fresher = better)
    const hoursSinceLastSeen = (Date.now() - capabilities.availability.lastSeen.getTime()) / (1000 * 60 * 60);
    const freshnessScore = Math.max(0, 1 - (hoursSinceLastSeen / 24)); // Decay over 24 hours

    // Response time score (faster = better)
    const responseTimeScore = Math.max(0, 1 - (capabilities.availability.responseTimeMs / 5000)); // 5s = 0 score

    // 24h uptime score
    const uptimeScore = capabilities.availability.uptime24h;

    return (freshnessScore * 0.3 + responseTimeScore * 0.3 + uptimeScore * 0.4);
  }

  /**
   * Calculate cost efficiency score
   */
  calculateCostEfficiencyScore(
    capabilities: AgentCapabilities,
    marketMedianPrice: number = 100
  ): number {
    const agentPrice = this.calculateAgentPrice(capabilities);
    
    // Invert cost (cheaper = better), normalized against market median
    const priceRatio = agentPrice / marketMedianPrice;
    
    // Score: 1.0 at 50% of median, 0.5 at median, approaches 0 as price increases
    if (priceRatio <= 0.5) return 1.0;
    if (priceRatio <= 1.0) return 1.0 - (priceRatio - 0.5);
    
    return Math.max(0, 1.0 / (1.0 + priceRatio - 1.0));
  }

  /**
   * Filter agents by capability requirements
   */
  filterByCapabilities(
    agents: Array<{reputation: AgentReputation; capabilities: AgentCapabilities}>,
    requirements: TaskRequirements
  ): Array<{reputation: AgentReputation; capabilities: AgentCapabilities}> {
    return agents.filter(agent => {
      // Check minimum reputation
      if (requirements.minReputationScore && agent.reputation.overallScore < requirements.minReputationScore) {
        return false;
      }

      // Check skill requirements
      if (requirements.skills && !this.hasRequiredSkills(agent.capabilities.skills, requirements.skills)) {
        return false;
      }

      // Check model requirements
      if (requirements.models && !this.hasRequiredModels(agent.capabilities.models, requirements.models)) {
        return false;
      }

      // Check hardware requirements
      if (requirements.minHardware && !this.meetsHardwareRequirements(agent.capabilities.hardware, requirements.minHardware)) {
        return false;
      }

      // Check real-time requirement (online status)
      if (requirements.requiresRealTime && !agent.capabilities.availability.isOnline) {
        return false;
      }

      return true;
    });
  }

  /**
   * Generate agent recommendations with full scoring
   */
  generateRecommendations(
    agents: Array<{reputation: AgentReputation; capabilities: AgentCapabilities}>,
    criteria: AgentSelectionCriteria,
    marketData?: { medianPrice: number }
  ): AgentRecommendation[] {
    let candidates = agents;

    // Filter by requirements if provided
    if (criteria.taskRequirements) {
      candidates = this.filterByCapabilities(candidates, criteria.taskRequirements);
    }

    // Filter by reputation threshold
    candidates = candidates.filter(agent => agent.reputation.overallScore >= criteria.requiredScore);

    // Filter by active status if required
    if (criteria.requireActive) {
      candidates = candidates.filter(agent => agent.capabilities.availability.isOnline);
    }

    // Exclude specified agents
    if (criteria.excludeAgents) {
      candidates = candidates.filter(agent => !criteria.excludeAgents!.includes(agent.reputation.agentId));
    }

    // Calculate scores for each candidate
    const recommendations: AgentRecommendation[] = candidates.map(agent => {
      const trustScore = this.calculateTrustScore(agent.reputation, agent.capabilities, criteria.taskRequirements);
      const availabilityScore = this.calculateAvailabilityScore(agent.capabilities);
      const costEfficiencyScore = this.calculateCostEfficiencyScore(agent.capabilities, marketData?.medianPrice);

      const specializationBonus = criteria.taskRequirements?.skills 
        ? this.calculateSkillMatch(agent.capabilities.skills, criteria.taskRequirements.skills) * 0.1
        : 0;

      const finalScore = (
        trustScore * this.weights.trust +
        availabilityScore * this.weights.availability +
        costEfficiencyScore * this.weights.costEfficiency +
        specializationBonus
      );

      return {
        agentId: agent.reputation.agentId,
        finalScore,
        breakdown: {
          trustScore,
          availabilityScore,
          costEfficiencyScore,
          specializationBonus,
        },
        reputation: agent.reputation,
        capabilities: agent.capabilities,
        reasoning: this.generateReasoning(trustScore, availabilityScore, costEfficiencyScore, specializationBonus),
      };
    });

    // Sort by final score (descending) and limit
    return recommendations
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, criteria.maxCandidates);
  }

  // Private helper methods

  private calculateSkillMatch(agentSkills: string[], requiredSkills: string[]): number {
    const matches = requiredSkills.filter(skill => agentSkills.includes(skill));
    return matches.length / requiredSkills.length;
  }

  private calculateRecentFailurePenalty(reputation: AgentReputation): number {
    // Simple penalty based on recent activity - in practice would query recent failure events
    const daysSinceUpdate = (Date.now() - reputation.lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
    
    // Estimate recent failures based on reliability score (lower reliability = more recent issues)
    if (reputation.reliabilityScore < 0.8) {
      return (0.8 - reputation.reliabilityScore) * 0.1; // Max 8% penalty
    }
    return 0;
  }

  private calculateAgentPrice(capabilities: AgentCapabilities): number {
    // Simple pricing calculation - would be more sophisticated in production
    return capabilities.pricing.baseRate;
  }

  private hasRequiredSkills(agentSkills: string[], requiredSkills: string[]): boolean {
    return requiredSkills.every(skill => agentSkills.includes(skill));
  }

  private hasRequiredModels(agentModels: string[], requiredModels: string[]): boolean {
    return requiredModels.some(model => agentModels.includes(model));
  }

  private meetsHardwareRequirements(
    agentHardware: AgentCapabilities['hardware'],
    requirements: NonNullable<TaskRequirements['minHardware']>
  ): boolean {
    if (requirements.cpu && agentHardware.cpu < requirements.cpu) return false;
    if (requirements.gpu && !agentHardware.gpu) return false;
    // Memory comparison would need more sophisticated parsing (GB, MB, etc.)
    return true;
  }

  private generateReasoning(
    trustScore: number,
    availabilityScore: number,
    costEfficiencyScore: number,
    specializationBonus: number
  ): string[] {
    const reasons: string[] = [];

    if (trustScore >= 0.8) reasons.push('High trust score based on excellent reputation');
    else if (trustScore >= 0.6) reasons.push('Good trust score with solid track record');
    else reasons.push('Moderate trust score - newer or less experienced agent');

    if (availabilityScore >= 0.8) reasons.push('Excellent availability with fast response times');
    else if (availabilityScore >= 0.6) reasons.push('Good availability and responsiveness');
    else reasons.push('Limited availability or slower response times');

    if (costEfficiencyScore >= 0.8) reasons.push('Very cost-effective pricing');
    else if (costEfficiencyScore >= 0.6) reasons.push('Reasonable pricing for the quality');
    else reasons.push('Higher pricing but potentially premium service');

    if (specializationBonus > 0.05) reasons.push('Strong skill match for requested capabilities');

    return reasons;
  }

  private getCachedScore(key: string): number | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp.getTime();
    if (age > this.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }

    return cached.score;
  }

  private setCachedScore(key: string, score: number): void {
    this.cache.set(key, { score, timestamp: new Date() });
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredCache(): void {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());
    for (let i = 0; i < entries.length; i++) {
      const [key, entry] = entries[i];
      if (now - entry.timestamp.getTime() > this.cacheTtlMs) {
        this.cache.delete(key);
      }
    }
  }
}

export default TrustCalculator;