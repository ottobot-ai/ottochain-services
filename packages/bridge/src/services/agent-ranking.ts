/**
 * Agent Ranking Service
 * 
 * High-level service for agent selection and ranking with real-time availability checking.
 * Coordinates between reputation data, capability matching, and trust calculation.
 */

import { TrustCalculator, AgentCapabilities, TaskRequirements, AgentSelectionCriteria, AgentRecommendation } from './trust-calculator.js';
import { AgentReputation } from '../routes/reputation.js';

export interface AvailabilityStatus {
  agentId: string;
  isOnline: boolean;
  lastSeen: Date;
  responseTimeMs: number;
  uptime24h: number;
  healthScore: number; // 0-1 based on various health metrics
}

export interface AgentRankingOptions {
  enableRealTimeChecks: boolean;
  maxParallelChecks: number;
  availabilityTimeoutMs: number;
  useCache: boolean;
  cacheRefreshIntervalMs: number;
}

const DEFAULT_RANKING_OPTIONS: AgentRankingOptions = {
  enableRealTimeChecks: true,
  maxParallelChecks: 10,
  availabilityTimeoutMs: 3000,
  useCache: true,
  cacheRefreshIntervalMs: 60000, // 1 minute
};

export class AgentRankingService {
  private trustCalculator: TrustCalculator;
  private options: AgentRankingOptions;
  private availabilityCache: Map<string, { status: AvailabilityStatus; timestamp: Date }>;

  constructor(options: Partial<AgentRankingOptions> = {}) {
    this.options = { ...DEFAULT_RANKING_OPTIONS, ...options };
    this.trustCalculator = new TrustCalculator();
    this.availabilityCache = new Map();
  }

  /**
   * Get agent recommendations with real-time availability checking
   */
  async getRecommendations(
    criteria: AgentSelectionCriteria
  ): Promise<{
    recommendations: AgentRecommendation[];
    metadata: {
      totalCandidates: number;
      filteredCount: number;
      availabilityChecked: boolean;
      processingTimeMs: number;
    };
  }> {
    const startTime = Date.now();

    try {
      // Step 1: Get all agent data (reputation + capabilities)
      const allAgents = await this.getAllAgentData();
      const totalCandidates = allAgents.length;

      // Step 2: Apply capability-based filtering
      let filteredAgents = allAgents;
      if (criteria.taskRequirements) {
        filteredAgents = this.trustCalculator.filterByCapabilities(allAgents, criteria.taskRequirements);
      }

      // Step 3: Update availability data if real-time checks enabled
      let availabilityChecked = false;
      if (this.options.enableRealTimeChecks) {
        await this.updateAvailabilityData(filteredAgents.map(a => a.reputation.agentId));
        availabilityChecked = true;
      }

      // Step 4: Generate recommendations
      const marketData = await this.getMarketData();
      const recommendations = this.trustCalculator.generateRecommendations(
        filteredAgents,
        criteria,
        marketData
      );

      const processingTime = Date.now() - startTime;

      return {
        recommendations,
        metadata: {
          totalCandidates,
          filteredCount: filteredAgents.length,
          availabilityChecked,
          processingTimeMs: processingTime,
        },
      };
    } catch (error) {
      console.error('[AgentRankingService] Error generating recommendations:', error);
      throw new Error(`Failed to generate recommendations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check real-time availability for a single agent
   */
  async checkAgentAvailability(agentId: string): Promise<AvailabilityStatus> {
    // Check cache first
    if (this.options.useCache) {
      const cached = this.getAvailabilityFromCache(agentId);
      if (cached) return cached;
    }

    try {
      // Perform real availability check
      const status = await this.performAvailabilityCheck(agentId);
      
      // Cache result
      if (this.options.useCache) {
        this.cacheAvailabilityStatus(agentId, status);
      }

      return status;
    } catch (error) {
      console.warn(`[AgentRankingService] Availability check failed for ${agentId}:`, error);
      
      // Return pessimistic default
      return {
        agentId,
        isOnline: false,
        lastSeen: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        responseTimeMs: 10000,
        uptime24h: 0,
        healthScore: 0,
      };
    }
  }

  /**
   * Bulk availability check for multiple agents
   */
  async updateAvailabilityData(agentIds: string[]): Promise<Map<string, AvailabilityStatus>> {
    const results = new Map<string, AvailabilityStatus>();
    
    // Process in batches to avoid overwhelming the system
    const batches = this.chunkArray(agentIds, this.options.maxParallelChecks);
    
    for (const batch of batches) {
      const batchPromises = batch.map(agentId => 
        this.checkAgentAvailability(agentId).then(status => ({ agentId, status }))
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.set(result.value.agentId, result.value.status);
        }
      }
    }

    return results;
  }

  /**
   * Get agent capabilities by skill/domain
   */
  async searchAgentsBySkill(skill: string, options: {
    minReputationScore?: number;
    maxResults?: number;
    requireOnline?: boolean;
  } = {}): Promise<AgentRecommendation[]> {
    const criteria: AgentSelectionCriteria = {
      requiredScore: options.minReputationScore || 0.5,
      maxCandidates: options.maxResults || 20,
      requireActive: options.requireOnline || false,
      taskRequirements: {
        skills: [skill],
      },
    };

    const result = await this.getRecommendations(criteria);
    return result.recommendations;
  }

  /**
   * Get top agents in a domain with diversity scoring
   */
  async getTopAgentsWithDiversity(
    domain: string,
    maxResults: number = 10,
    diversityFactor: number = 0.3
  ): Promise<AgentRecommendation[]> {
    const criteria: AgentSelectionCriteria = {
      requiredScore: 0.6,
      maxCandidates: maxResults * 2, // Get more candidates for diversity filtering
      domains: [domain],
      requireActive: true,
    };

    const result = await this.getRecommendations(criteria);
    
    // Apply diversity filtering (avoid agents with too-similar capabilities)
    return this.applyDiversityFiltering(result.recommendations, maxResults, diversityFactor);
  }

  // Private implementation methods

  private async getAllAgentData(): Promise<Array<{
    reputation: AgentReputation;
    capabilities: AgentCapabilities;
  }>> {
    // In practice, this would query the database/indexer
    // For now, return mock data structure
    return [
      // This would be replaced with actual database queries
    ];
  }

  private async getMarketData(): Promise<{ medianPrice: number }> {
    // In practice, calculate median pricing from active agents
    return { medianPrice: 100 };
  }

  private async performAvailabilityCheck(agentId: string): Promise<AvailabilityStatus> {
    const startTime = Date.now();
    
    try {
      // In practice, this would:
      // 1. Send HTTP ping to agent health endpoint
      // 2. Check WebSocket connection status
      // 3. Query last-seen timestamp from agent registry
      // 4. Check system metrics if available
      
      // Mock implementation for now
      const mockResponseTime = Math.random() * 2000 + 500; // 500-2500ms
      const mockUptime = Math.random() * 0.4 + 0.6; // 60-100%
      const isHealthy = mockResponseTime < 3000 && mockUptime > 0.8;
      
      return {
        agentId,
        isOnline: isHealthy,
        lastSeen: new Date(),
        responseTimeMs: mockResponseTime,
        uptime24h: mockUptime,
        healthScore: isHealthy ? 0.9 : 0.3,
      };
    } catch (error) {
      throw new Error(`Availability check failed for ${agentId}: ${error}`);
    }
  }

  private getAvailabilityFromCache(agentId: string): AvailabilityStatus | null {
    const cached = this.availabilityCache.get(agentId);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp.getTime();
    if (age > this.options.cacheRefreshIntervalMs) {
      this.availabilityCache.delete(agentId);
      return null;
    }

    return cached.status;
  }

  private cacheAvailabilityStatus(agentId: string, status: AvailabilityStatus): void {
    this.availabilityCache.set(agentId, {
      status,
      timestamp: new Date(),
    });
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private applyDiversityFiltering(
    recommendations: AgentRecommendation[],
    maxResults: number,
    diversityFactor: number
  ): AgentRecommendation[] {
    // Simple diversity algorithm: avoid agents with very similar skill sets
    const selected: AgentRecommendation[] = [];
    
    for (const candidate of recommendations) {
      if (selected.length >= maxResults) break;
      
      // Check diversity against already selected agents
      const isDiverse = selected.every(existing => {
        const skillOverlap = this.calculateSkillOverlap(
          candidate.capabilities.skills,
          existing.capabilities.skills
        );
        return skillOverlap < (1 - diversityFactor);
      });
      
      if (isDiverse || selected.length === 0) {
        selected.push(candidate);
      }
    }
    
    return selected;
  }

  private calculateSkillOverlap(skills1: string[], skills2: string[]): number {
    const set1 = new Set(skills1);
    const set2 = new Set(skills2);
    const intersection = new Set(Array.from(set1).filter(x => set2.has(x)));
    const union = new Set([...skills1, ...skills2]);
    
    return intersection.size / union.size; // Jaccard similarity
  }

  /**
   * Cleanup expired cache entries
   */
  cleanup(): void {
    const now = Date.now();
    const entries = Array.from(this.availabilityCache.entries());
    for (let i = 0; i < entries.length; i++) {
      const [agentId, entry] = entries[i];
      if (now - entry.timestamp.getTime() > this.options.cacheRefreshIntervalMs) {
        this.availabilityCache.delete(agentId);
      }
    }
    
    this.trustCalculator.clearExpiredCache();
  }
}

export default AgentRankingService;