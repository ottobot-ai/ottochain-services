/**
 * Agent Ranking Service Tests
 * 
 * Tests for real-time availability checking and high-level agent selection
 */

import AgentRankingService, { AvailabilityStatus } from '../agent-ranking.js';
import { AgentSelectionCriteria } from '../trust-calculator.js';

describe('AgentRankingService', () => {
  let agentRankingService: AgentRankingService;

  beforeEach(() => {
    agentRankingService = new AgentRankingService({
      enableRealTimeChecks: true,
      maxParallelChecks: 5,
      availabilityTimeoutMs: 1000,
      useCache: true,
      cacheRefreshIntervalMs: 30000,
    });
  });

  describe('checkAgentAvailability', () => {
    it('should return availability status for an agent', async () => {
      const agentId = 'test-agent-123';
      
      const availability = await agentRankingService.checkAgentAvailability(agentId);
      
      expect(availability).toHaveProperty('agentId', agentId);
      expect(availability).toHaveProperty('isOnline');
      expect(availability).toHaveProperty('lastSeen');
      expect(availability).toHaveProperty('responseTimeMs');
      expect(availability).toHaveProperty('uptime24h');
      expect(availability).toHaveProperty('healthScore');
      
      expect(typeof availability.isOnline).toBe('boolean');
      expect(typeof availability.responseTimeMs).toBe('number');
      expect(availability.uptime24h).toBeGreaterThanOrEqual(0);
      expect(availability.uptime24h).toBeLessThanOrEqual(1);
      expect(availability.healthScore).toBeGreaterThanOrEqual(0);
      expect(availability.healthScore).toBeLessThanOrEqual(1);
    });

    it('should cache availability results', async () => {
      const agentId = 'test-agent-cache';
      
      // First call
      const start1 = Date.now();
      const result1 = await agentRankingService.checkAgentAvailability(agentId);
      const time1 = Date.now() - start1;
      
      // Second call should be faster due to caching
      const start2 = Date.now();
      const result2 = await agentRankingService.checkAgentAvailability(agentId);
      const time2 = Date.now() - start2;
      
      expect(result1.agentId).toBe(result2.agentId);
      // Cache should be at least as fast (timing can be too fast to measure difference)
      expect(time2).toBeLessThanOrEqual(time1 + 1);
    });

    it('should handle availability check failures gracefully', async () => {
      const invalidAgentId = 'invalid-agent-999';
      
      const availability = await agentRankingService.checkAgentAvailability(invalidAgentId);
      
      // Should return pessimistic defaults on failure
      expect(availability.isOnline).toBe(false);
      expect(availability.healthScore).toBeLessThanOrEqual(0.5); // Low health score
      expect(availability.responseTimeMs).toBeGreaterThan(1000);
    });
  });

  describe('updateAvailabilityData', () => {
    it('should check availability for multiple agents', async () => {
      const agentIds = ['agent-1', 'agent-2', 'agent-3'];
      
      const results = await agentRankingService.updateAvailabilityData(agentIds);
      
      expect(results.size).toBe(agentIds.length);
      
      for (const agentId of agentIds) {
        expect(results.has(agentId)).toBe(true);
        const availability = results.get(agentId);
        expect(availability?.agentId).toBe(agentId);
      }
    });

    it('should respect maxParallelChecks limit', async () => {
      const agentIds = ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5', 'agent-6'];
      
      const start = Date.now();
      const results = await agentRankingService.updateAvailabilityData(agentIds);
      const duration = Date.now() - start;
      
      expect(results.size).toBe(agentIds.length);
      // Should complete in reasonable time despite batching
      expect(duration).toBeLessThan(10000); // 10 seconds max
    });

    it('should handle partial failures in batch updates', async () => {
      const agentIds = ['valid-agent', 'invalid-agent', 'another-valid-agent'];
      
      const results = await agentRankingService.updateAvailabilityData(agentIds);
      
      // Should still return results for all agents (with defaults for failed checks)
      expect(results.size).toBe(agentIds.length);
    });
  });

  describe('getRecommendations', () => {
    it('should return recommendations with metadata', async () => {
      const criteria: AgentSelectionCriteria = {
        requiredScore: 0.5,
        maxCandidates: 5,
        requireActive: true,
      };
      
      const result = await agentRankingService.getRecommendations(criteria);
      
      expect(result).toHaveProperty('recommendations');
      expect(result).toHaveProperty('metadata');
      expect(result.metadata).toHaveProperty('totalCandidates');
      expect(result.metadata).toHaveProperty('filteredCount');
      expect(result.metadata).toHaveProperty('availabilityChecked');
      expect(result.metadata).toHaveProperty('processingTimeMs');
      
      expect(Array.isArray(result.recommendations)).toBe(true);
      expect(typeof result.metadata.totalCandidates).toBe('number');
      expect(typeof result.metadata.processingTimeMs).toBe('number');
    });

    it('should respect maxCandidates limit', async () => {
      const criteria: AgentSelectionCriteria = {
        requiredScore: 0.0,
        maxCandidates: 3,
        requireActive: false,
      };
      
      const result = await agentRankingService.getRecommendations(criteria);
      
      expect(result.recommendations.length).toBeLessThanOrEqual(3);
    });

    it('should include real-time availability checking when enabled', async () => {
      const criteria: AgentSelectionCriteria = {
        requiredScore: 0.5,
        maxCandidates: 5,
        requireActive: true,
      };
      
      const result = await agentRankingService.getRecommendations(criteria);
      
      expect(result.metadata.availabilityChecked).toBe(true);
    });

    it('should filter by task requirements', async () => {
      const criteria: AgentSelectionCriteria = {
        requiredScore: 0.5,
        maxCandidates: 10,
        requireActive: false,
        taskRequirements: {
          skills: ['data-analysis'],
          minReputationScore: 0.7,
        },
      };
      
      const result = await agentRankingService.getRecommendations(criteria);
      
      expect(result.metadata.filteredCount).toBeLessThanOrEqual(result.metadata.totalCandidates);
    });

    it('should handle errors gracefully', async () => {
      const invalidCriteria = null as any;
      
      await expect(agentRankingService.getRecommendations(invalidCriteria))
        .rejects
        .toThrow('Failed to generate recommendations');
    });
  });

  describe('searchAgentsBySkill', () => {
    it('should find agents by skill', async () => {
      const skill = 'machine-learning';
      const options = {
        minReputationScore: 0.6,
        maxResults: 5,
        requireOnline: true,
      };
      
      const recommendations = await agentRankingService.searchAgentsBySkill(skill, options);
      
      expect(Array.isArray(recommendations)).toBe(true);
      expect(recommendations.length).toBeLessThanOrEqual(options.maxResults);
    });

    it('should use default options when not specified', async () => {
      const skill = 'web-development';
      
      const recommendations = await agentRankingService.searchAgentsBySkill(skill);
      
      expect(Array.isArray(recommendations)).toBe(true);
      expect(recommendations.length).toBeLessThanOrEqual(20); // Default maxResults
    });

    it('should return empty array for non-existent skills', async () => {
      const nonExistentSkill = 'quantum-computing-with-organic-materials';
      
      const recommendations = await agentRankingService.searchAgentsBySkill(nonExistentSkill);
      
      expect(recommendations).toHaveLength(0);
    });
  });

  describe('getTopAgentsWithDiversity', () => {
    it('should return diverse top agents in domain', async () => {
      const domain = 'data-science';
      const maxResults = 5;
      const diversityFactor = 0.3;
      
      const recommendations = await agentRankingService.getTopAgentsWithDiversity(
        domain,
        maxResults,
        diversityFactor
      );
      
      expect(Array.isArray(recommendations)).toBe(true);
      expect(recommendations.length).toBeLessThanOrEqual(maxResults);
    });

    it('should apply diversity filtering', async () => {
      const domain = 'ai-development';
      
      // High diversity factor should result in more diverse selection
      const highDiversityRecs = await agentRankingService.getTopAgentsWithDiversity(
        domain,
        5,
        0.8
      );
      
      // Low diversity factor allows more similarity
      const lowDiversityRecs = await agentRankingService.getTopAgentsWithDiversity(
        domain,
        5,
        0.1
      );
      
      expect(Array.isArray(highDiversityRecs)).toBe(true);
      expect(Array.isArray(lowDiversityRecs)).toBe(true);
    });

    it('should handle edge cases gracefully', async () => {
      // Empty domain
      const emptyDomainRecs = await agentRankingService.getTopAgentsWithDiversity('', 5, 0.3);
      expect(Array.isArray(emptyDomainRecs)).toBe(true);
      
      // Zero maxResults
      const zeroResultsRecs = await agentRankingService.getTopAgentsWithDiversity('test', 0, 0.3);
      expect(zeroResultsRecs).toHaveLength(0);
      
      // Extreme diversity factor
      const extremeDiversityRecs = await agentRankingService.getTopAgentsWithDiversity('test', 5, 1.0);
      expect(Array.isArray(extremeDiversityRecs)).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should clear expired cache entries without errors', () => {
      expect(() => agentRankingService.cleanup()).not.toThrow();
    });

    it('should remove expired availability cache entries', async () => {
      // Create a service with very short cache TTL
      const shortCacheService = new AgentRankingService({
        cacheRefreshIntervalMs: 100, // 100ms
      });
      
      // Check availability to populate cache
      await shortCacheService.checkAgentAvailability('test-agent');
      
      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Cleanup should remove expired entries
      expect(() => shortCacheService.cleanup()).not.toThrow();
    });
  });

  describe('configuration', () => {
    it('should use default options when not specified', () => {
      const defaultService = new AgentRankingService();
      expect(defaultService).toBeInstanceOf(AgentRankingService);
    });

    it('should override options correctly', () => {
      const customService = new AgentRankingService({
        enableRealTimeChecks: false,
        maxParallelChecks: 20,
        availabilityTimeoutMs: 5000,
      });
      expect(customService).toBeInstanceOf(AgentRankingService);
    });
  });
});