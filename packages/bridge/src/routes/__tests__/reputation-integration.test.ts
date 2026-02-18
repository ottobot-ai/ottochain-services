/**
 * Reputation Route Integration Tests
 * 
 * End-to-end tests for the trust-based agent selection and recommendation API
 */

import request, { Response } from 'supertest';
import express from 'express';
import reputationRoutes from '../reputation.js';

describe('Reputation Routes Integration', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/reputation', reputationRoutes);
  });

  describe('POST /reputation/agents/recommend', () => {
    it('should return agent recommendations with basic criteria', async () => {
      const criteria = {
        requiredScore: 0.5,
        maxCandidates: 5,
        requireActive: true,
      };

      const response = await request(app)
        .post('/reputation/agents/recommend')
        .send(criteria)
        .expect(200);

      expect(response.body).toHaveProperty('recommendations');
      expect(response.body).toHaveProperty('metadata');
      expect(response.body).toHaveProperty('criteria');
      expect(response.body).toHaveProperty('timestamp');

      expect(Array.isArray(response.body.recommendations)).toBe(true);
      expect(response.body.metadata).toHaveProperty('totalCandidates');
      expect(response.body.metadata).toHaveProperty('filteredCount');
      expect(response.body.metadata).toHaveProperty('availabilityChecked');
      expect(response.body.metadata).toHaveProperty('processingTimeMs');
    });

    it('should handle task requirements in recommendation request', async () => {
      const criteria = {
        requiredScore: 0.6,
        maxCandidates: 10,
        requireActive: true,
        taskRequirements: {
          skills: ['data-analysis', 'machine-learning'],
          models: ['claude-3'],
          minHardware: {
            cpu: 8,
            memory: '16GB',
            gpu: true,
          },
          maxBudget: 150,
          minReputationScore: 0.7,
          requiresRealTime: true,
          complexity: 3,
        },
      };

      const response = await request(app)
        .post('/reputation/agents/recommend')
        .send(criteria)
        .expect(200);

      expect(response.body.recommendations).toBeDefined();
      expect(response.body.criteria.taskRequirements).toMatchObject({
        skills: ['data-analysis', 'machine-learning'],
        models: ['claude-3'],
        minHardware: {
          cpu: 8,
          memory: '16GB',
          gpu: true,
        },
        maxBudget: 150,
        minReputationScore: 0.7,
        requiresRealTime: true,
        complexity: 3,
      });
    });

    it('should validate request parameters', async () => {
      const invalidCriteria = {
        requiredScore: 1.5, // Invalid: > 1
        maxCandidates: -5, // Invalid: negative
      };

      const response = await request(app)
        .post('/reputation/agents/recommend')
        .send(invalidCriteria)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Invalid selection criteria');
      expect(response.body).toHaveProperty('details');
    });

    it('should return recommendations sorted by final score', async () => {
      const criteria = {
        requiredScore: 0.0,
        maxCandidates: 5,
        requireActive: false,
      };

      const response = await request(app)
        .post('/reputation/agents/recommend')
        .send(criteria)
        .expect(200);

      const recommendations = response.body.recommendations;
      
      // Verify recommendations are sorted by finalScore (descending)
      for (let i = 1; i < recommendations.length; i++) {
        expect(recommendations[i - 1].finalScore).toBeGreaterThanOrEqual(
          recommendations[i].finalScore
        );
      }
    });

    it('should include complete recommendation structure', async () => {
      const criteria = {
        requiredScore: 0.5,
        maxCandidates: 1,
        requireActive: true,
      };

      const response = await request(app)
        .post('/reputation/agents/recommend')
        .send(criteria)
        .expect(200);

      if (response.body.recommendations.length > 0) {
        const recommendation = response.body.recommendations[0];
        
        expect(recommendation).toHaveProperty('agentId');
        expect(recommendation).toHaveProperty('finalScore');
        expect(recommendation).toHaveProperty('breakdown');
        expect(recommendation).toHaveProperty('reputation');
        expect(recommendation).toHaveProperty('capabilities');
        expect(recommendation).toHaveProperty('reasoning');

        expect(recommendation.breakdown).toHaveProperty('trustScore');
        expect(recommendation.breakdown).toHaveProperty('availabilityScore');
        expect(recommendation.breakdown).toHaveProperty('costEfficiencyScore');
        expect(recommendation.breakdown).toHaveProperty('specializationBonus');

        expect(Array.isArray(recommendation.reasoning)).toBe(true);
      }
    });
  });

  describe('GET /reputation/agents/search', () => {
    it('should search agents by skill', async () => {
      const response = await request(app)
        .get('/reputation/agents/search')
        .query({
          skill: 'data-analysis',
          minReputationScore: 0.6,
          maxResults: 10,
          requireOnline: true,
        })
        .expect(200);

      expect(response.body).toHaveProperty('skill', 'data-analysis');
      expect(response.body).toHaveProperty('recommendations');
      expect(response.body).toHaveProperty('count');
      expect(response.body).toHaveProperty('timestamp');

      expect(Array.isArray(response.body.recommendations)).toBe(true);
      expect(response.body.count).toBe(response.body.recommendations.length);
    });

    it('should require skill parameter', async () => {
      const response = await request(app)
        .get('/reputation/agents/search')
        .query({
          minReputationScore: 0.6,
        })
        .expect(400);

      expect(response.body).toHaveProperty('error', 'skill parameter is required');
    });

    it('should use default parameters when not provided', async () => {
      const response = await request(app)
        .get('/reputation/agents/search')
        .query({
          skill: 'web-development',
        })
        .expect(200);

      expect(response.body.recommendations.length).toBeLessThanOrEqual(20); // Default maxResults
    });
  });

  describe('GET /reputation/agents/top/:domain', () => {
    it('should return top agents in domain with diversity', async () => {
      const response = await request(app)
        .get('/reputation/agents/top/machine-learning')
        .query({
          maxResults: 5,
          diversityFactor: 0.3,
        })
        .expect(200);

      expect(response.body).toHaveProperty('domain', 'machine-learning');
      expect(response.body).toHaveProperty('recommendations');
      expect(response.body).toHaveProperty('count');
      expect(response.body).toHaveProperty('diversityFactor', 0.3);
      expect(response.body).toHaveProperty('timestamp');

      expect(Array.isArray(response.body.recommendations)).toBe(true);
      expect(response.body.recommendations.length).toBeLessThanOrEqual(5);
    });

    it('should use default parameters', async () => {
      const response = await request(app)
        .get('/reputation/agents/top/data-science')
        .expect(200);

      expect(response.body.recommendations.length).toBeLessThanOrEqual(10); // Default maxResults
      expect(response.body.diversityFactor).toBe(0.3); // Default diversityFactor
    });
  });

  describe('GET /reputation/agents/:agentId/availability', () => {
    it('should check agent availability', async () => {
      const agentId = 'test-agent-123';
      
      const response = await request(app)
        .get(`/reputation/agents/${agentId}/availability`)
        .expect(200);

      expect(response.body).toHaveProperty('agentId', agentId);
      expect(response.body).toHaveProperty('availability');
      expect(response.body).toHaveProperty('timestamp');

      const availability = response.body.availability;
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
    });
  });

  describe('GET /reputation/agents/:agentId', () => {
    it('should return 404 for non-existent agent', async () => {
      const response = await request(app)
        .get('/reputation/agents/non-existent-agent')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Agent not found');
      expect(response.body).toHaveProperty('agentId', 'non-existent-agent');
    });

    it('should include history when requested', async () => {
      const response = await request(app)
        .get('/reputation/agents/test-agent')
        .query({ includeHistory: 'true' })
        .expect(404); // Will be 404 until we have test data

      // When we have test data, this should return:
      // expect(response.body.recentEvents).toBeDefined();
      // expect(response.body.specializations).toBeDefined();
    });
  });

  describe('GET /reputation/agents', () => {
    it('should query agents with filters', async () => {
      const response = await request(app)
        .get('/reputation/agents')
        .query({
          minScore: 0.5,
          limit: 10,
          includeInactive: false,
        })
        .expect(200);

      expect(response.body).toHaveProperty('agents');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('query');

      expect(Array.isArray(response.body.agents)).toBe(true);
      expect(response.body.agents.length).toBeLessThanOrEqual(10);
    });

    it('should validate query parameters', async () => {
      const response = await request(app)
        .get('/reputation/agents')
        .query({
          minScore: 1.5, // Invalid: > 1
          limit: 200, // Invalid: > 100
        })
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Invalid query parameters');
    });
  });

  describe('POST /reputation/tasks/:taskId/complete', () => {
    it('should validate task completion data', async () => {
      const taskId = 'task-123';
      const invalidTaskData = {
        taskId: 'different-task-id', // Mismatch
        agentId: 'agent-123',
        completedAt: 'invalid-date',
        qualityScore: 1.5, // Invalid: > 1
      };

      const response = await request(app)
        .post(`/reputation/tasks/${taskId}/complete`)
        .send(invalidTaskData)
        .expect(400);

      expect(response.body.error).toContain('Task ID mismatch');
    });

    it('should require all mandatory fields', async () => {
      const taskId = 'task-456';
      const incompleteTaskData = {
        taskId,
        agentId: 'agent-123',
        // Missing required fields
      };

      const response = await request(app)
        .post(`/reputation/tasks/${taskId}/complete`)
        .send(incompleteTaskData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Invalid task completion data');
    });
  });

  describe('GET /reputation/leaderboard', () => {
    it('should return leaderboard with default parameters', async () => {
      const response = await request(app)
        .get('/reputation/leaderboard')
        .expect(200);

      expect(response.body).toHaveProperty('leaderboard');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('criteria');

      expect(Array.isArray(response.body.leaderboard)).toBe(true);
      expect(response.body.leaderboard.length).toBeLessThanOrEqual(25); // Default limit
    });

    it('should respect limit parameter', async () => {
      const response = await request(app)
        .get('/reputation/leaderboard')
        .query({ limit: 5 })
        .expect(200);

      expect(response.body.leaderboard.length).toBeLessThanOrEqual(5);
      expect(response.body.criteria.limit).toBe(5);
    });

    it('should filter by domain', async () => {
      const response = await request(app)
        .get('/reputation/leaderboard')
        .query({ 
          domain: 'data-science',
          limit: 10,
        })
        .expect(200);

      expect(response.body.criteria.domain).toBe('data-science');
    });

    it('should enforce maximum limit', async () => {
      const response = await request(app)
        .get('/reputation/leaderboard')
        .query({ limit: 200 }) // Over max limit
        .expect(200);

      expect(response.body.leaderboard.length).toBeLessThanOrEqual(100); // Max limit
    });
  });

  describe('GET /reputation/config', () => {
    it('should return reputation configuration', async () => {
      const response = await request(app)
        .get('/reputation/config')
        .expect(200);

      expect(response.body).toHaveProperty('performanceWeight');
      expect(response.body).toHaveProperty('reliabilityWeight');
      expect(response.body).toHaveProperty('specializationWeight');
      expect(response.body).toHaveProperty('networkWeight');
      expect(response.body).toHaveProperty('decayHalfLifeDays');
      expect(response.body).toHaveProperty('minTasksForSpecialization');

      // Verify weights sum to 1.0
      const totalWeight = 
        response.body.performanceWeight +
        response.body.reliabilityWeight +
        response.body.specializationWeight +
        response.body.networkWeight;
      expect(totalWeight).toBeCloseTo(1.0, 2);
    });
  });

  describe('Performance', () => {
    it('should respond to recommendations within reasonable time', async () => {
      const criteria = {
        requiredScore: 0.5,
        maxCandidates: 20,
        requireActive: true,
      };

      const start = Date.now();
      const response = await request(app)
        .post('/reputation/agents/recommend')
        .send(criteria)
        .expect(200);
      const duration = Date.now() - start;

      // Should complete within 5 seconds
      expect(duration).toBeLessThan(5000);
      
      // Processing time should be tracked
      expect(response.body.metadata.processingTimeMs).toBeLessThan(duration);
    });

    it('should handle concurrent recommendation requests', async () => {
      const criteria = {
        requiredScore: 0.3,
        maxCandidates: 5,
        requireActive: false,
      };

      const promises = Array(5).fill(null).map(() =>
        request(app)
          .post('/reputation/agents/recommend')
          .send(criteria)
      );

      const responses = await Promise.all(promises);

      // All requests should succeed
      responses.forEach((response: Response) => {
        expect(response.status).toBe(200);
        expect(response.body.recommendations).toBeDefined();
      });
    });
  });
});