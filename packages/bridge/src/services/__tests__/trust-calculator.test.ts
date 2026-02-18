/**
 * Trust Calculator Tests
 * 
 * Comprehensive tests for the multi-factor agent selection algorithm
 */

import { TrustCalculator, AgentCapabilities, TaskRequirements, AgentSelectionCriteria } from '../trust-calculator.js';
import { AgentReputation } from '../../routes/reputation.js';

describe('TrustCalculator', () => {
  let trustCalculator: TrustCalculator;
  let mockAgent: { reputation: AgentReputation; capabilities: AgentCapabilities };

  beforeEach(() => {
    trustCalculator = new TrustCalculator();
    
    // Create mock agent data
    mockAgent = {
      reputation: {
        agentId: 'agent-123',
        overallScore: 0.85,
        performanceScore: 0.88,
        reliabilityScore: 0.82,
        specializationScore: 0.90,
        networkScore: 0.75,
        lastUpdated: new Date(),
        taskCount: 150,
        activeStreak: 30,
        decayFactor: 1.0,
      },
      capabilities: {
        agentId: 'agent-123',
        skills: ['data-analysis', 'machine-learning', 'python'],
        models: ['claude-3', 'gpt-4'],
        hardware: {
          cpu: 16,
          memory: '32GB',
          gpu: 'RTX 4090',
        },
        availability: {
          isOnline: true,
          lastSeen: new Date(),
          responseTimeMs: 1200,
          uptime24h: 0.95,
        },
        pricing: {
          baseRate: 80,
          skillModifiers: {
            'machine-learning': 1.2,
            'data-analysis': 1.1,
          },
          currency: 'OTTO',
        },
        performance: {
          avgTaskDuration: 3600,
          successRate: 0.92,
          avgQuality: 4.3,
        },
      },
    };
  });

  describe('calculateTrustScore', () => {
    it('should calculate base trust score from reputation', () => {
      const trustScore = trustCalculator.calculateTrustScore(
        mockAgent.reputation,
        mockAgent.capabilities
      );
      
      // Base score 0.85 + performance bonus (0.92-0.8)*0.1 = 0.012
      expect(trustScore).toBeCloseTo(0.862, 2);
    });

    it('should apply specialization bonus for skill matching', () => {
      const taskRequirements: TaskRequirements = {
        skills: ['data-analysis', 'python'],
      };
      
      const trustScore = trustCalculator.calculateTrustScore(
        mockAgent.reputation,
        mockAgent.capabilities,
        taskRequirements
      );
      
      // Should get bonus for matching 2/2 skills (capped at 1.0)
      expect(trustScore).toBeGreaterThan(0.85);
      expect(trustScore).toBeLessThanOrEqual(1.0);
    });

    it('should apply performance bonus for high success rate', () => {
      // Agent with 95% success rate should get bonus
      mockAgent.capabilities.performance.successRate = 0.95;
      
      const trustScore = trustCalculator.calculateTrustScore(
        mockAgent.reputation,
        mockAgent.capabilities
      );
      
      // Performance bonus = (0.95 - 0.8) * 0.1 = 0.015
      expect(trustScore).toBeCloseTo(0.865, 2);
    });

    it('should apply recent failure penalty for low reliability', () => {
      // Agent with low reliability should get penalty
      mockAgent.reputation.reliabilityScore = 0.6; // Below 0.8 threshold
      
      const trustScore = trustCalculator.calculateTrustScore(
        mockAgent.reputation,
        mockAgent.capabilities
      );
      
      // Penalty for low reliability, plus base performance bonus
      expect(trustScore).toBeCloseTo(0.842, 2);
    });

    it('should clamp trust score between 0 and 1', () => {
      // Test upper bound
      mockAgent.reputation.overallScore = 0.95;
      mockAgent.capabilities.performance.successRate = 0.98;
      const taskRequirements: TaskRequirements = {
        skills: ['data-analysis'], // Full match
      };
      
      const highTrustScore = trustCalculator.calculateTrustScore(
        mockAgent.reputation,
        mockAgent.capabilities,
        taskRequirements
      );
      expect(highTrustScore).toBeLessThanOrEqual(1.0);

      // Test lower bound
      mockAgent.reputation.overallScore = 0.1;
      mockAgent.reputation.reliabilityScore = 0.2; // Heavy penalty
      
      const lowTrustScore = trustCalculator.calculateTrustScore(
        mockAgent.reputation,
        mockAgent.capabilities
      );
      expect(lowTrustScore).toBeGreaterThanOrEqual(0.0);
    });
  });

  describe('calculateAvailabilityScore', () => {
    it('should return 0 for offline agents', () => {
      mockAgent.capabilities.availability.isOnline = false;
      
      const availabilityScore = trustCalculator.calculateAvailabilityScore(
        mockAgent.capabilities
      );
      
      expect(availabilityScore).toBe(0);
    });

    it('should calculate availability based on freshness, response time, and uptime', () => {
      const availabilityScore = trustCalculator.calculateAvailabilityScore(
        mockAgent.capabilities
      );
      
      // Should be positive for online agent with good metrics
      expect(availabilityScore).toBeGreaterThan(0.5);
      expect(availabilityScore).toBeLessThanOrEqual(1.0);
    });

    it('should penalize slow response times', () => {
      // Fast response time
      mockAgent.capabilities.availability.responseTimeMs = 500;
      const fastScore = trustCalculator.calculateAvailabilityScore(mockAgent.capabilities);
      
      // Slow response time
      mockAgent.capabilities.availability.responseTimeMs = 4000;
      const slowScore = trustCalculator.calculateAvailabilityScore(mockAgent.capabilities);
      
      expect(fastScore).toBeGreaterThan(slowScore);
    });

    it('should penalize agents not seen recently', () => {
      // Recently seen
      mockAgent.capabilities.availability.lastSeen = new Date();
      const recentScore = trustCalculator.calculateAvailabilityScore(mockAgent.capabilities);
      
      // Seen 12 hours ago
      mockAgent.capabilities.availability.lastSeen = new Date(Date.now() - 12 * 60 * 60 * 1000);
      const oldScore = trustCalculator.calculateAvailabilityScore(mockAgent.capabilities);
      
      expect(recentScore).toBeGreaterThan(oldScore);
    });
  });

  describe('calculateCostEfficiencyScore', () => {
    it('should give high scores to agents priced below market median', () => {
      mockAgent.capabilities.pricing.baseRate = 50; // Below median of 100
      
      const costScore = trustCalculator.calculateCostEfficiencyScore(
        mockAgent.capabilities,
        100
      );
      
      expect(costScore).toBeGreaterThan(0.8);
    });

    it('should give lower scores to expensive agents', () => {
      mockAgent.capabilities.pricing.baseRate = 200; // Above median of 100
      
      const costScore = trustCalculator.calculateCostEfficiencyScore(
        mockAgent.capabilities,
        100
      );
      
      expect(costScore).toBeLessThanOrEqual(0.5);
    });

    it('should handle edge cases gracefully', () => {
      // Very cheap agent
      mockAgent.capabilities.pricing.baseRate = 10;
      const cheapScore = trustCalculator.calculateCostEfficiencyScore(
        mockAgent.capabilities,
        100
      );
      expect(cheapScore).toBe(1.0);

      // Very expensive agent
      mockAgent.capabilities.pricing.baseRate = 1000;
      const expensiveScore = trustCalculator.calculateCostEfficiencyScore(
        mockAgent.capabilities,
        100
      );
      expect(expensiveScore).toBeLessThanOrEqual(0.2);
    });
  });

  describe('filterByCapabilities', () => {
    let agents: Array<{reputation: AgentReputation; capabilities: AgentCapabilities}>;

    beforeEach(() => {
      agents = [
        mockAgent,
        {
          ...mockAgent,
          reputation: { ...mockAgent.reputation, agentId: 'agent-456', overallScore: 0.6 },
          capabilities: {
            ...mockAgent.capabilities,
            agentId: 'agent-456',
            skills: ['web-development', 'javascript'],
            models: ['gpt-3.5'],
            availability: { ...mockAgent.capabilities.availability, isOnline: false },
          },
        },
      ];
    });

    it('should filter by minimum reputation score', () => {
      const requirements: TaskRequirements = {
        skills: [],
        minReputationScore: 0.7,
      };
      
      const filtered = trustCalculator.filterByCapabilities(agents, requirements);
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].reputation.agentId).toBe('agent-123');
    });

    it('should filter by required skills', () => {
      const requirements: TaskRequirements = {
        skills: ['data-analysis'],
      };
      
      const filtered = trustCalculator.filterByCapabilities(agents, requirements);
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].reputation.agentId).toBe('agent-123');
    });

    it('should filter by real-time requirement', () => {
      const requirements: TaskRequirements = {
        skills: [],
        requiresRealTime: true,
      };
      
      const filtered = trustCalculator.filterByCapabilities(agents, requirements);
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].reputation.agentId).toBe('agent-123'); // Only online agent
    });

    it('should filter by model requirements', () => {
      const requirements: TaskRequirements = {
        skills: [],
        models: ['claude-3'],
      };
      
      const filtered = trustCalculator.filterByCapabilities(agents, requirements);
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].reputation.agentId).toBe('agent-123');
    });
  });

  describe('generateRecommendations', () => {
    let agents: Array<{reputation: AgentReputation; capabilities: AgentCapabilities}>;
    let criteria: AgentSelectionCriteria;

    beforeEach(() => {
      agents = [
        mockAgent,
        {
          reputation: { ...mockAgent.reputation, agentId: 'agent-456', overallScore: 0.7 },
          capabilities: {
            ...mockAgent.capabilities,
            agentId: 'agent-456',
            pricing: { ...mockAgent.capabilities.pricing, baseRate: 60 },
            availability: { ...mockAgent.capabilities.availability, responseTimeMs: 800 },
          },
        },
        {
          reputation: { ...mockAgent.reputation, agentId: 'agent-789', overallScore: 0.9 },
          capabilities: {
            ...mockAgent.capabilities,
            agentId: 'agent-789',
            pricing: { ...mockAgent.capabilities.pricing, baseRate: 120 },
            availability: { ...mockAgent.capabilities.availability, responseTimeMs: 2000 },
          },
        },
      ];

      criteria = {
        requiredScore: 0.6,
        maxCandidates: 10,
        requireActive: true,
      };
    });

    it('should generate recommendations with proper scoring', () => {
      const recommendations = trustCalculator.generateRecommendations(agents, criteria);
      
      expect(recommendations).toHaveLength(3);
      expect(recommendations[0].finalScore).toBeGreaterThan(recommendations[1].finalScore);
      expect(recommendations[1].finalScore).toBeGreaterThan(recommendations[2].finalScore);
    });

    it('should include breakdown of scores', () => {
      const recommendations = trustCalculator.generateRecommendations(agents, criteria);
      
      const rec = recommendations[0];
      expect(rec.breakdown).toHaveProperty('trustScore');
      expect(rec.breakdown).toHaveProperty('availabilityScore');
      expect(rec.breakdown).toHaveProperty('costEfficiencyScore');
      expect(rec.breakdown).toHaveProperty('specializationBonus');
    });

    it('should include reasoning for recommendations', () => {
      const recommendations = trustCalculator.generateRecommendations(agents, criteria);
      
      const rec = recommendations[0];
      expect(rec.reasoning).toBeInstanceOf(Array);
      expect(rec.reasoning.length).toBeGreaterThan(0);
      expect(rec.reasoning[0]).toContain('trust score');
    });

    it('should limit results to maxCandidates', () => {
      criteria.maxCandidates = 2;
      
      const recommendations = trustCalculator.generateRecommendations(agents, criteria);
      
      expect(recommendations).toHaveLength(2);
    });

    it('should exclude specified agents', () => {
      criteria.excludeAgents = ['agent-123'];
      
      const recommendations = trustCalculator.generateRecommendations(agents, criteria);
      
      expect(recommendations).toHaveLength(2);
      expect(recommendations.find(r => r.agentId === 'agent-123')).toBeUndefined();
    });

    it('should apply specialization bonus correctly', () => {
      criteria.taskRequirements = {
        skills: ['data-analysis'],
      };
      
      const recommendations = trustCalculator.generateRecommendations(agents, criteria);
      
      // Agent-123 has data-analysis skill, should get specialization bonus
      const rec = recommendations.find(r => r.agentId === 'agent-123');
      expect(rec?.breakdown.specializationBonus).toBeGreaterThan(0);
    });
  });

  describe('caching', () => {
    it('should cache trust score calculations', () => {
      const spy = jest.spyOn(trustCalculator as any, 'calculateRecentFailurePenalty');
      
      // First calculation
      trustCalculator.calculateTrustScore(mockAgent.reputation, mockAgent.capabilities);
      expect(spy).toHaveBeenCalledTimes(1);
      
      // Second calculation with same inputs should use cache
      trustCalculator.calculateTrustScore(mockAgent.reputation, mockAgent.capabilities);
      expect(spy).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should clear expired cache entries', () => {
      // Calculate score to populate cache
      trustCalculator.calculateTrustScore(mockAgent.reputation, mockAgent.capabilities);
      
      // Manually clear cache
      trustCalculator.clearExpiredCache();
      
      // Should not throw errors
      expect(() => trustCalculator.clearExpiredCache()).not.toThrow();
    });
  });
});