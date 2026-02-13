/**
 * OttoChain Bridge - Reputation Routes
 * 
 * API endpoints for tracking, scoring, and querying agent reputation
 */

import express from 'express';
import { z } from 'zod';
import { keyPairFromPrivateKey } from '@ottochain/sdk';

// Reputation data types (matching Scala definitions)
enum ReputationEventType {
  TASK_COMPLETION = 'TaskCompletion',
  TASK_FAILURE = 'TaskFailure',
  SPECIALIZATION_BONUS = 'SpecializationBonus',
  NETWORK_COLLABORATION = 'NetworkCollaboration',
  DECAY_APPLICATION = 'DecayApplication',
  MANUAL_ADJUSTMENT = 'ManualAdjustment',
  SLASHING_PENALTY = 'SlashingPenalty'
}

interface AgentReputation {
  agentId: string;
  overallScore: number;
  performanceScore: number;
  reliabilityScore: number;
  specializationScore: number;
  networkScore: number;
  lastUpdated: Date;
  taskCount: number;
  activeStreak: number;
  decayFactor: number;
}

interface TaskCompletion {
  taskId: string;
  agentId: string;
  completedAt: Date;
  qualityScore: number;
  efficiencyScore: number;
  domain: string;
  complexity: number;
  delegatedBy?: string;
  stakingAmount?: number;
}

interface ReputationEvent {
  eventId: string;
  agentId: string;
  eventType: ReputationEventType;
  timestamp: Date;
  scoreDelta: number;
  reason: string;
  sourceTaskId?: string;
  metadata: Record<string, string>;
}

interface SpecializationArea {
  domain: string;
  expertiseLevel: number;
  taskCount: number;
  averageQuality: number;
  lastActivity: Date;
}

interface ReputationConfig {
  performanceWeight: number;
  reliabilityWeight: number;
  specializationWeight: number;
  networkWeight: number;
  decayHalfLifeDays: number;
  minTasksForSpecialization: number;
  specializationBonusMultiplier: number;
  slashingPenaltyMultiplier: number;
}

// Validation schemas
const TaskCompletionSchema = z.object({
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  completedAt: z.string().datetime(),
  qualityScore: z.number().min(0).max(1),
  efficiencyScore: z.number().min(0).max(1),
  domain: z.string().min(1),
  complexity: z.number().int().min(1).max(5),
  delegatedBy: z.string().optional(),
  stakingAmount: z.number().min(0).optional(),
});

const ReputationQuerySchema = z.object({
  agentIds: z.array(z.string()).optional(),
  minScore: z.number().min(0).max(1).optional(),
  domain: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(10),
  includeInactive: z.boolean().default(false),
});

const AgentSelectionSchema = z.object({
  requiredScore: z.number().min(0).max(1).default(0.5),
  domains: z.array(z.string()).optional(),
  maxCandidates: z.number().int().min(1).max(50).default(10),
  excludeAgents: z.array(z.string()).optional(),
  requireActive: z.boolean().default(true),
});

// Default configuration
const DEFAULT_REPUTATION_CONFIG: ReputationConfig = {
  performanceWeight: 0.4,
  reliabilityWeight: 0.3,
  specializationWeight: 0.2,
  networkWeight: 0.1,
  decayHalfLifeDays: 90,
  minTasksForSpecialization: 5,
  specializationBonusMultiplier: 1.2,
  slashingPenaltyMultiplier: 0.9,
};

const router = express.Router();

/**
 * GET /reputation/agents/:agentId
 * Get reputation details for a specific agent
 */
router.get('/agents/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const includeHistory = req.query.includeHistory === 'true';
    
    // TODO: Fetch from database/cache
    const reputation = await getAgentReputation(agentId);
    
    if (!reputation) {
      return res.status(404).json({
        error: 'Agent not found',
        agentId,
      });
    }
    
    const response: any = {
      reputation,
      qualificationLevel: getQualificationLevel(reputation.overallScore),
      isActive: isActiveAgent(reputation),
    };
    
    if (includeHistory) {
      response.recentEvents = await getReputationEvents(agentId, 10);
      response.specializations = await getAgentSpecializations(agentId);
    }
    
    res.json(response);
  } catch (error) {
    console.error('Error fetching agent reputation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /reputation/agents
 * Query multiple agents with filtering and ranking
 */
router.get('/agents', async (req, res) => {
  try {
    const query = ReputationQuerySchema.parse(req.query);
    
    const agents = await queryAgentReputations(query);
    
    res.json({
      agents,
      total: agents.length,
      query,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: error.errors,
      });
    }
    
    console.error('Error querying agent reputations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /reputation/agents/recommend
 * Get agent recommendations for task delegation
 */
router.post('/agents/recommend', async (req, res) => {
  try {
    const criteria = AgentSelectionSchema.parse(req.body);
    
    const recommendations = await getAgentRecommendations(criteria);
    
    res.json({
      recommendations,
      criteria,
      timestamp: new Date(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid selection criteria',
        details: error.errors,
      });
    }
    
    console.error('Error generating agent recommendations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /reputation/tasks/:taskId/complete
 * Record task completion and update agent reputation
 */
router.post('/tasks/:taskId/complete', async (req, res) => {
  try {
    const { taskId } = req.params;
    const taskData = TaskCompletionSchema.parse(req.body);
    
    // Validate taskId matches
    if (taskData.taskId !== taskId) {
      return res.status(400).json({
        error: 'Task ID mismatch',
        expected: taskId,
        provided: taskData.taskId,
      });
    }
    
    // Record task completion and update reputation
    const result = await recordTaskCompletion(taskData);
    
    res.json({
      success: true,
      taskId,
      agentId: taskData.agentId,
      scoreDelta: result.scoreDelta,
      newScore: result.newReputation.overallScore,
      event: result.event,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid task completion data',
        details: error.errors,
      });
    }
    
    console.error('Error recording task completion:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /reputation/events
 * Get reputation event history with filtering
 */
router.get('/events', async (req, res) => {
  try {
    const agentId = req.query.agentId as string;
    const eventType = req.query.eventType as ReputationEventType;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const events = await getReputationEvents(agentId, limit, offset, eventType);
    
    res.json({
      events,
      pagination: {
        limit,
        offset,
        hasMore: events.length === limit,
      },
    });
  } catch (error) {
    console.error('Error fetching reputation events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /reputation/leaderboard
 * Get agent leaderboard by reputation score
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
    const domain = req.query.domain as string;
    
    const leaderboard = await getReputationLeaderboard(limit, domain);
    
    res.json({
      leaderboard,
      timestamp: new Date(),
      criteria: { limit, domain },
    });
  } catch (error) {
    console.error('Error fetching reputation leaderboard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /reputation/config
 * Get current reputation configuration
 */
router.get('/config', (req, res) => {
  res.json(DEFAULT_REPUTATION_CONFIG);
});

// Helper functions (these would be implemented with actual database calls)

async function getAgentReputation(agentId: string): Promise<AgentReputation | null> {
  // TODO: Implement database query
  return null;
}

async function getReputationEvents(
  agentId?: string, 
  limit: number = 50, 
  offset: number = 0,
  eventType?: ReputationEventType
): Promise<ReputationEvent[]> {
  // TODO: Implement database query
  return [];
}

async function getAgentSpecializations(agentId: string): Promise<SpecializationArea[]> {
  // TODO: Implement database query
  return [];
}

async function queryAgentReputations(query: any): Promise<AgentReputation[]> {
  // TODO: Implement database query with filtering
  return [];
}

async function getAgentRecommendations(criteria: any): Promise<AgentReputation[]> {
  // TODO: Implement recommendation algorithm
  return [];
}

async function recordTaskCompletion(taskData: TaskCompletion): Promise<{
  newReputation: AgentReputation;
  scoreDelta: number;
  event: ReputationEvent;
}> {
  // TODO: Implement reputation update logic
  throw new Error('Not implemented');
}

async function getReputationLeaderboard(
  limit: number, 
  domain?: string
): Promise<AgentReputation[]> {
  // TODO: Implement leaderboard query
  return [];
}

function getQualificationLevel(score: number): string {
  if (score >= 0.8) return 'elite';
  if (score >= 0.7) return 'expert';
  if (score >= 0.5) return 'qualified';
  if (score >= 0.3) return 'novice';
  return 'unqualified';
}

function isActiveAgent(reputation: AgentReputation): boolean {
  const daysSinceActivity = Math.floor(
    (Date.now() - reputation.lastUpdated.getTime()) / (1000 * 60 * 60 * 24)
  );
  return daysSinceActivity <= DEFAULT_REPUTATION_CONFIG.decayHalfLifeDays;
}

export default router;
export {
  AgentReputation,
  TaskCompletion,
  ReputationEvent,
  ReputationEventType,
  SpecializationArea,
  ReputationConfig,
};