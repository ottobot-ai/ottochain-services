/**
 * Advanced Error Handling and Failover Tests (Phase 4)
 * 
 * TDD tests for agent failure detection, automatic failover, session key recovery,
 * quality assurance, and human-in-the-loop escalation systems.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReliabilityManager } from '../reliability-manager.js';
import { AgentFailureDetector } from '../agent-failure-detector.js';
import { AutomaticFailoverSystem } from '../automatic-failover.js';
import { SessionKeyRecoveryService } from '../session-key-recovery.js';
import { QualityAssuranceSystem } from '../quality-assurance.js';
import { HumanEscalationService } from '../human-escalation.js';

describe('Advanced Error Handling and Failover', () => {
  let reliabilityManager: ReliabilityManager;
  let failureDetector: AgentFailureDetector;
  let failoverSystem: AutomaticFailoverSystem;
  let sessionRecovery: SessionKeyRecoveryService;
  let qualityAssurance: QualityAssuranceSystem;
  let humanEscalation: HumanEscalationService;

  beforeEach(() => {
    failureDetector = new AgentFailureDetector({
      heartbeatInterval: 5000,
      maxMissedHeartbeats: 3,
      responseTimeoutMs: 30000
    });

    failoverSystem = new AutomaticFailoverSystem({
      availabilityThreshold: 0.95,
      maxFailoverAttempts: 3,
      failoverDelay: 1000
    });

    sessionRecovery = new SessionKeyRecoveryService({
      keyRotationInterval: 3600000, // 1 hour
      backupKeyCount: 3,
      recoveryTimeoutMs: 10000
    });

    qualityAssurance = new QualityAssuranceSystem({
      minQualityScore: 0.8,
      autoReworkThreshold: 0.6,
      maxReworkAttempts: 2
    });

    humanEscalation = new HumanEscalationService({
      escalationTimeoutMs: 300000, // 5 minutes
      criticalityLevels: ['low', 'medium', 'high', 'critical']
    });

    reliabilityManager = new ReliabilityManager({
      failureDetector,
      failoverSystem,
      sessionRecovery,
      qualityAssurance,
      humanEscalation,
      uptimeTarget: 0.999 // 99.9% uptime target
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Agent Failure Detection', () => {
    it('should detect agent failures through missed heartbeats', async () => {
      const agentId = '@code';
      
      // Start monitoring agent
      await failureDetector.startMonitoring(agentId);
      
      // Simulate missed heartbeats
      vi.advanceTimersByTime(20000); // 4 intervals without heartbeat
      
      const agentStatus = await failureDetector.getAgentStatus(agentId);
      
      expect(agentStatus.status).toBe('failed');
      expect(agentStatus.missedHeartbeats).toBe(4);
      expect(agentStatus.lastSeen).toBeLessThan(Date.now() - 15000);
      expect(agentStatus.failureReason).toBe('missed-heartbeats');
    });

    it('should detect agent failures through response timeouts', async () => {
      const agentId = '@research';
      const taskId = 'timeout-test-task';
      
      vi.spyOn(failureDetector, 'sendTaskToAgent').mockImplementation(
        () => new Promise((resolve) => {
          // Never resolve - simulate timeout
          setTimeout(() => {}, 60000);
        })
      );

      const taskPromise = failureDetector.executeTaskWithTimeout(agentId, taskId, 30000);
      
      await expect(taskPromise).rejects.toThrow('Agent response timeout');
      
      const agentStatus = await failureDetector.getAgentStatus(agentId);
      expect(agentStatus.status).toBe('unresponsive');
      expect(agentStatus.failureReason).toBe('response-timeout');
    });

    it('should differentiate between temporary glitches and persistent failures', async () => {
      const agentId = '@work';
      
      // Simulate intermittent failures
      let failureCount = 0;
      vi.spyOn(failureDetector, 'pingAgent').mockImplementation(async () => {
        failureCount++;
        if (failureCount <= 2) {
          throw new Error('Temporary network issue');
        }
        return { status: 'ok', timestamp: Date.now() };
      });

      const result = await failureDetector.assessAgentHealth(agentId, {
        retryCount: 3,
        retryDelay: 1000
      });

      expect(result.classification).toBe('temporary-glitch');
      expect(result.recovered).toBe(true);
      expect(result.failureCount).toBe(2);
    });

    it('should monitor agent performance degradation over time', async () => {
      const agentId = '@main';
      const performanceHistory = [
        { timestamp: Date.now() - 300000, responseTime: 1000, success: true },
        { timestamp: Date.now() - 240000, responseTime: 1500, success: true },
        { timestamp: Date.now() - 180000, responseTime: 2200, success: true },
        { timestamp: Date.now() - 120000, responseTime: 3100, success: false },
        { timestamp: Date.now() - 60000, responseTime: 4500, success: false }
      ];

      for (const record of performanceHistory) {
        await failureDetector.recordPerformance(agentId, record);
      }

      const degradationAnalysis = await failureDetector.analyzeDegradation(agentId);

      expect(degradationAnalysis.trend).toBe('degrading');
      expect(degradationAnalysis.responseTimeIncrease).toBeGreaterThan(3.0);
      expect(degradationAnalysis.successRateDecline).toBeGreaterThan(0.6);
      expect(degradationAnalysis.predictedFailure).toBe(true);
    });
  });

  describe('Automatic Failover System', () => {
    it('should automatically switch to backup agent when primary fails', async () => {
      const primaryAgent = '@code';
      const backupAgent = '@main';
      const taskId = 'failover-test-task';

      // Configure agent hierarchy
      await failoverSystem.configureAgentHierarchy({
        [primaryAgent]: [backupAgent]
      });

      // Simulate primary agent failure
      vi.spyOn(failureDetector, 'isAgentAvailable').mockImplementation(async (agentId) => {
        return agentId !== primaryAgent;
      });

      const failoverResult = await failoverSystem.executeWithFailover(taskId, {
        primaryAgent,
        task: { type: 'code-review', data: { pullRequestId: 'pr-123' } },
        timeout: 30000
      });

      expect(failoverResult.completed).toBe(true);
      expect(failoverResult.completedBy).toBe(backupAgent);
      expect(failoverResult.failoverOccurred).toBe(true);
      expect(failoverResult.originalAgent).toBe(primaryAgent);
      expect(failoverResult.failoverReason).toBe('agent-unavailable');
    });

    it('should maintain task context during failover', async () => {
      const taskContext = {
        taskId: 'context-preservation-test',
        primaryAgent: '@research',
        backupAgent: '@think',
        context: {
          previousResults: { analysis: 'Market trends analyzed' },
          userPreferences: { format: 'detailed', includeCharts: true },
          deadline: new Date(Date.now() + 3600000),
          stakeholders: ['product-team', 'executives']
        }
      };

      // Simulate failover
      const failoverResult = await failoverSystem.executeWithContextPreservation(taskContext);

      expect(failoverResult.contextPreserved).toBe(true);
      expect(failoverResult.backupAgentContext).toEqual(taskContext.context);
      expect(failoverResult.seamlessTransition).toBe(true);
    });

    it('should implement cascading failover through multiple backup agents', async () => {
      const agentHierarchy = {
        '@work': ['@code', '@main', '@research']
      };
      
      await failoverSystem.configureAgentHierarchy(agentHierarchy);

      // Simulate multiple agent failures
      vi.spyOn(failureDetector, 'isAgentAvailable')
        .mockResolvedValueOnce(false) // @work fails
        .mockResolvedValueOnce(false) // @code fails  
        .mockResolvedValueOnce(true);  // @main succeeds

      const cascadingResult = await failoverSystem.cascadingFailover('cascade-test-task', {
        primaryAgent: '@work',
        maxDepth: 3,
        task: { type: 'deployment', data: { version: 'v2.1.0' } }
      });

      expect(cascadingResult.finalAgent).toBe('@main');
      expect(cascadingResult.failoverChain).toEqual(['@work', '@code', '@main']);
      expect(cascadingResult.depth).toBe(2);
      expect(cascadingResult.completed).toBe(true);
    });

    it('should handle graceful degradation when all agents fail', async () => {
      const allAgentsDown = ['@main', '@work', '@code', '@research', '@think'];
      
      vi.spyOn(failureDetector, 'isAgentAvailable').mockResolvedValue(false);

      const degradationResult = await failoverSystem.gracefulDegradation('all-agents-down-test', {
        availableAgents: allAgentsDown,
        task: { type: 'critical-analysis', priority: 'high' },
        degradationStrategy: 'queue-for-later'
      });

      expect(degradationResult.allAgentsFailed).toBe(true);
      expect(degradationResult.strategy).toBe('queue-for-later');
      expect(degradationResult.queuedForRetry).toBe(true);
      expect(degradationResult.retryAfter).toBeGreaterThan(Date.now());
      expect(degradationResult.humanNotificationSent).toBe(true);
    });
  });

  describe('Session Key Recovery', () => {
    it('should automatically recover expired session keys', async () => {
      const agentId = '@code';
      const expiredKey = {
        keyId: 'key-expired-123',
        agentId,
        expiresAt: new Date(Date.now() - 60000), // Expired 1 minute ago
        permissions: ['read', 'write', 'execute']
      };

      vi.spyOn(sessionRecovery, 'isKeyExpired').mockReturnValue(true);
      
      const recoveryResult = await sessionRecovery.recoverExpiredKey(expiredKey);

      expect(recoveryResult.recovered).toBe(true);
      expect(recoveryResult.newKey).toBeDefined();
      expect(recoveryResult.newKey.expiresAt).toBeGreaterThan(new Date());
      expect(recoveryResult.newKey.permissions).toEqual(expiredKey.permissions);
      expect(recoveryResult.downtime).toBeLessThan(5000); // Less than 5 seconds downtime
    });

    it('should repair broken delegation chains', async () => {
      const brokenChain = [
        { from: '@main', to: '@work', keyId: 'key-1', status: 'valid' },
        { from: '@work', to: '@code', keyId: 'key-2', status: 'expired' },
        { from: '@code', to: '@research', keyId: 'key-3', status: 'invalid' }
      ];

      const repairResult = await sessionRecovery.repairDelegationChain(brokenChain);

      expect(repairResult.repaired).toBe(true);
      expect(repairResult.repairedLinks).toBe(2);
      expect(repairResult.newChain).toHaveLength(3);
      expect(repairResult.newChain[1].status).toBe('valid');
      expect(repairResult.newChain[2].status).toBe('valid');
    });

    it('should handle concurrent key recovery requests', async () => {
      const agentId = '@research';
      const concurrentRecoveries = Array.from({ length: 5 }, (_, i) => 
        sessionRecovery.recoverAgentSession(agentId, `concurrent-${i}`)
      );

      const results = await Promise.allSettled(concurrentRecoveries);
      const successful = results.filter(r => r.status === 'fulfilled').length;

      expect(successful).toBe(1); // Only one should succeed due to locking
      expect(sessionRecovery.getActiveLocks(agentId)).toBe(0); // Lock should be released
    });

    it('should maintain audit trail of key recovery events', async () => {
      const recoveryEvent = {
        agentId: '@work',
        reason: 'key-expiration',
        originalKey: 'key-original-456',
        timestamp: new Date()
      };

      await sessionRecovery.performRecovery(recoveryEvent);

      const auditTrail = await sessionRecovery.getAuditTrail('@work');

      expect(auditTrail).toHaveLength(1);
      expect(auditTrail[0].event).toBe('key-recovery');
      expect(auditTrail[0].reason).toBe('key-expiration');
      expect(auditTrail[0].success).toBe(true);
      expect(auditTrail[0].downtime).toBeDefined();
    });
  });

  describe('Quality Assurance System', () => {
    it('should validate task output quality automatically', async () => {
      const taskOutput = {
        taskId: 'quality-test-1',
        agent: '@code',
        result: {
          code: 'function calculateSum(a, b) { return a + b; }',
          tests: ['test_addition_positive', 'test_addition_negative'],
          documentation: 'Basic sum function with error handling',
          coverage: 85,
          complexity: 3
        }
      };

      const qualityResult = await qualityAssurance.validateOutput(taskOutput);

      expect(qualityResult.passed).toBe(true);
      expect(qualityResult.score).toBeGreaterThan(0.8);
      expect(qualityResult.metrics.codeQuality).toBeGreaterThan(0.7);
      expect(qualityResult.metrics.testCoverage).toBe(0.85);
      expect(qualityResult.metrics.documentation).toBeGreaterThan(0.8);
    });

    it('should automatically request rework for poor quality output', async () => {
      const poorQualityOutput = {
        taskId: 'poor-quality-test',
        agent: '@code',
        result: {
          code: 'function broken() { // incomplete implementation',
          tests: [],
          documentation: '',
          coverage: 15,
          complexity: 25
        }
      };

      const reworkResult = await qualityAssurance.handlePoorQuality(poorQualityOutput);

      expect(reworkResult.reworkRequested).toBe(true);
      expect(reworkResult.reworkReasons).toContain('insufficient-test-coverage');
      expect(reworkResult.reworkReasons).toContain('missing-documentation');
      expect(reworkResult.reworkReasons).toContain('high-complexity');
      expect(reworkResult.feedback).toBeDefined();
    });

    it('should track quality trends over time per agent', async () => {
      const qualityHistory = [
        { agent: '@code', score: 0.9, timestamp: Date.now() - 86400000 },
        { agent: '@code', score: 0.8, timestamp: Date.now() - 43200000 },
        { agent: '@code', score: 0.6, timestamp: Date.now() - 21600000 },
        { agent: '@code', score: 0.5, timestamp: Date.now() - 10800000 }
      ];

      for (const record of qualityHistory) {
        await qualityAssurance.recordQualityScore(record.agent, record.score, record.timestamp);
      }

      const trendAnalysis = await qualityAssurance.analyzeTrends('@code');

      expect(trendAnalysis.trend).toBe('declining');
      expect(trendAnalysis.averageScore).toBeLessThan(0.8);
      expect(trendAnalysis.requiresIntervention).toBe(true);
      expect(trendAnalysis.recommendedAction).toBe('agent-retraining');
    });

    it('should escalate consistent quality issues to human oversight', async () => {
      const consistentFailures = Array.from({ length: 5 }, (_, i) => ({
        agent: '@research',
        taskId: `failing-task-${i}`,
        qualityScore: 0.4,
        issues: ['incomplete-analysis', 'missing-sources', 'poor-formatting']
      }));

      for (const failure of consistentFailures) {
        await qualityAssurance.recordQualityFailure(failure);
      }

      const escalation = await qualityAssurance.checkEscalationTriggers('@research');

      expect(escalation.required).toBe(true);
      expect(escalation.reason).toBe('consistent-quality-failures');
      expect(escalation.failureCount).toBe(5);
      expect(escalation.severity).toBe('high');
    });
  });

  describe('Human-in-the-Loop Escalation', () => {
    it('should escalate critical system failures to human operators', async () => {
      const criticalFailure = {
        type: 'system-wide-failure',
        severity: 'critical',
        affectedAgents: ['@main', '@work', '@code'],
        impact: 'all-tasks-blocked',
        timestamp: new Date(),
        autoRecoveryAttempts: 3,
        autoRecoverySuccess: false
      };

      const escalation = await humanEscalation.escalateCriticalFailure(criticalFailure);

      expect(escalation.escalated).toBe(true);
      expect(escalation.priority).toBe('urgent');
      expect(escalation.estimatedResponseTime).toBeLessThan(300000); // 5 minutes
      expect(escalation.notificationChannels).toContain('sms');
      expect(escalation.notificationChannels).toContain('email');
      expect(escalation.oncallEngineer.notified).toBe(true);
    });

    it('should provide human operators with comprehensive context', async () => {
      const complexIssue = {
        issueId: 'complex-issue-123',
        type: 'workflow-deadlock',
        severity: 'high',
        context: {
          workflowId: 'multi-agent-workflow-456',
          stuckTasks: ['task-a', 'task-b', 'task-c'],
          dependencyGraph: { 'task-a': ['task-b'], 'task-b': ['task-c'], 'task-c': ['task-a'] },
          systemState: { memory: 0.85, cpu: 0.92, diskSpace: 0.45 },
          recentErrors: ['circular-dependency', 'resource-exhaustion']
        }
      };

      const humanContext = await humanEscalation.prepareHumanContext(complexIssue);

      expect(humanContext.summary).toContain('workflow deadlock');
      expect(humanContext.possibleCauses).toContain('circular-dependency');
      expect(humanContext.suggestedActions).toHaveLength.greaterThan(2);
      expect(humanContext.systemDiagnostics).toBeDefined();
      expect(humanContext.riskAssessment.businessImpact).toBeDefined();
    });

    it('should track human intervention outcomes for system learning', async () => {
      const intervention = {
        interventionId: 'human-fix-789',
        issue: 'agent-performance-degradation',
        humanAction: 'restart-agent-with-config-update',
        outcome: 'successful',
        resolutionTime: 1200000, // 20 minutes
        feedback: 'Agent needed memory limit increase',
        preventionStrategy: 'monitor-memory-usage'
      };

      await humanEscalation.recordInterventionOutcome(intervention);

      const learnings = await humanEscalation.extractLearnings('agent-performance-degradation');

      expect(learnings.successfulActions).toContain('restart-agent-with-config-update');
      expect(learnings.preventionStrategies).toContain('monitor-memory-usage');
      expect(learnings.averageResolutionTime).toBeDefined();
      expect(learnings.recommendations.automation).toBeDefined();
    });
  });

  describe('System-Wide Reliability Metrics', () => {
    it('should maintain >99% uptime target through all failure scenarios', async () => {
      const reliabilityPeriod = {
        startTime: Date.now() - 86400000, // 24 hours ago
        endTime: Date.now(),
        totalDowntimeMs: 600000 // 10 minutes total downtime
      };

      const uptimeMetrics = await reliabilityManager.calculateUptime(reliabilityPeriod);

      expect(uptimeMetrics.uptime).toBeGreaterThan(0.999); // >99.9%
      expect(uptimeMetrics.downtimeMinutes).toBeLessThan(15);
      expect(uptimeMetrics.meetsSLA).toBe(true);
      expect(uptimeMetrics.availability).toBe('five-nines-compliant');
    });

    it('should measure Mean Time To Recovery (MTTR) for different failure types', async () => {
      const failureRecoveries = [
        { type: 'agent-failure', recoveryTimeMs: 5000 },
        { type: 'network-partition', recoveryTimeMs: 30000 },
        { type: 'session-key-expiry', recoveryTimeMs: 2000 },
        { type: 'quality-rework', recoveryTimeMs: 120000 }
      ];

      for (const recovery of failureRecoveries) {
        await reliabilityManager.recordRecovery(recovery.type, recovery.recoveryTimeMs);
      }

      const mttrMetrics = await reliabilityManager.calculateMTTR();

      expect(mttrMetrics.overall).toBeLessThan(60000); // Under 1 minute average
      expect(mttrMetrics.byType['agent-failure']).toBeLessThan(10000);
      expect(mttrMetrics.byType['session-key-expiry']).toBeLessThan(5000);
      expect(mttrMetrics.trend).toBeDefined();
    });

    it('should provide real-time system health dashboard metrics', async () => {
      const healthMetrics = await reliabilityManager.getSystemHealthDashboard();

      expect(healthMetrics.overallHealth).toBeOneOf(['healthy', 'degraded', 'critical']);
      expect(healthMetrics.agentStatuses).toHaveProperty('@main');
      expect(healthMetrics.agentStatuses).toHaveProperty('@work');
      expect(healthMetrics.agentStatuses).toHaveProperty('@code');
      expect(healthMetrics.activeFailovers).toBeGreaterThanOrEqual(0);
      expect(healthMetrics.queuedTasks).toBeGreaterThanOrEqual(0);
      expect(healthMetrics.qualityMetrics.averageScore).toBeGreaterThan(0);
      expect(healthMetrics.performanceMetrics.responseTime.p95).toBeLessThan(30000);
    });
  });
});