/**
 * Multi-Agent Workflow Orchestration Tests (Phase 4)
 * 
 * TDD tests for complex multi-agent coordination with dependency management,
 * result passing, and automatic failover capabilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkflowOrchestrator } from '../workflow-orchestrator.js';
import { AgentCoordinator } from '../agent-coordinator.js';
import { DependencyManager } from '../dependency-manager.js';
import { ResultAggregator } from '../result-aggregator.js';
import { ErrorRecoverySystem } from '../error-recovery-system.js';

describe('Multi-Agent Workflow Orchestration', () => {
  let orchestrator: WorkflowOrchestrator;
  let coordinator: AgentCoordinator;
  let dependencyManager: DependencyManager;
  let resultAggregator: ResultAggregator;
  let errorRecovery: ErrorRecoverySystem;

  beforeEach(() => {
    coordinator = new AgentCoordinator();
    dependencyManager = new DependencyManager();
    resultAggregator = new ResultAggregator();
    errorRecovery = new ErrorRecoverySystem();
    
    orchestrator = new WorkflowOrchestrator({
      coordinator,
      dependencyManager,
      resultAggregator,
      errorRecovery
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Dependency Management', () => {
    it('should execute tasks in correct dependency order', async () => {
      const workflow = {
        id: 'complex-workflow-1',
        tasks: [
          { id: 'task-a', dependencies: [], agent: '@research' },
          { id: 'task-b', dependencies: ['task-a'], agent: '@code' },
          { id: 'task-c', dependencies: ['task-a'], agent: '@work' },
          { id: 'task-d', dependencies: ['task-b', 'task-c'], agent: '@main' }
        ]
      };

      const execution = await orchestrator.executeWorkflow(workflow);

      expect(execution.completedTasks).toHaveLength(4);
      expect(execution.executionOrder).toEqual(['task-a', 'task-b', 'task-c', 'task-d']);
      expect(execution.maxParallelism).toBe(2); // task-b and task-c run in parallel
    });

    it('should handle parallel task execution efficiently', async () => {
      const workflow = {
        id: 'parallel-workflow',
        tasks: [
          { id: 'init', dependencies: [], agent: '@main' },
          { id: 'parallel-1', dependencies: ['init'], agent: '@research' },
          { id: 'parallel-2', dependencies: ['init'], agent: '@code' },
          { id: 'parallel-3', dependencies: ['init'], agent: '@work' }
        ]
      };

      const startTime = Date.now();
      const execution = await orchestrator.executeWorkflow(workflow);
      const totalTime = Date.now() - startTime;

      expect(execution.parallelTaskCount).toBe(3);
      expect(totalTime).toBeLessThan(1500); // Should complete in under 1.5s due to parallelism
      expect(execution.status).toBe('completed');
    });

    it('should detect and reject circular dependencies', async () => {
      const circularWorkflow = {
        id: 'circular-workflow',
        tasks: [
          { id: 'task-a', dependencies: ['task-b'], agent: '@research' },
          { id: 'task-b', dependencies: ['task-a'], agent: '@code' }
        ]
      };

      await expect(orchestrator.executeWorkflow(circularWorkflow))
        .rejects
        .toThrow('Circular dependency detected: task-a -> task-b -> task-a');
    });

    it('should validate all task dependencies exist', async () => {
      const invalidWorkflow = {
        id: 'invalid-workflow',
        tasks: [
          { id: 'task-a', dependencies: ['nonexistent-task'], agent: '@research' }
        ]
      };

      await expect(orchestrator.executeWorkflow(invalidWorkflow))
        .rejects
        .toThrow('Task dependency not found: nonexistent-task');
    });
  });

  describe('Agent-to-Agent Communication', () => {
    it('should pass results between dependent tasks correctly', async () => {
      const workflow = {
        id: 'communication-test',
        tasks: [
          { 
            id: 'data-collection',
            dependencies: [], 
            agent: '@research',
            expectedOutput: { type: 'research-data', format: 'json' }
          },
          { 
            id: 'data-analysis',
            dependencies: ['data-collection'], 
            agent: '@code',
            inputMapping: { researchData: 'data-collection.result' }
          }
        ]
      };

      const execution = await orchestrator.executeWorkflow(workflow);
      const analysisTask = execution.completedTasks.find(t => t.id === 'data-analysis');

      expect(analysisTask.receivedInputs.researchData).toBeDefined();
      expect(analysisTask.receivedInputs.researchData).toEqual(
        execution.completedTasks.find(t => t.id === 'data-collection').result
      );
    });

    it('should handle complex result aggregation from multiple sources', async () => {
      const workflow = {
        id: 'aggregation-test',
        tasks: [
          { id: 'source-1', dependencies: [], agent: '@research' },
          { id: 'source-2', dependencies: [], agent: '@code' },
          { id: 'source-3', dependencies: [], agent: '@work' },
          { 
            id: 'aggregator',
            dependencies: ['source-1', 'source-2', 'source-3'],
            agent: '@main',
            aggregationStrategy: 'merge-objects'
          }
        ]
      };

      const execution = await orchestrator.executeWorkflow(workflow);
      const aggregatedTask = execution.completedTasks.find(t => t.id === 'aggregator');

      expect(aggregatedTask.aggregatedInputs).toHaveProperty('source-1');
      expect(aggregatedTask.aggregatedInputs).toHaveProperty('source-2');
      expect(aggregatedTask.aggregatedInputs).toHaveProperty('source-3');
      expect(aggregatedTask.result.mergedData).toBeDefined();
    });

    it('should validate result format matches expected schema', async () => {
      const workflow = {
        id: 'schema-validation-test',
        tasks: [
          { 
            id: 'data-producer',
            dependencies: [], 
            agent: '@research',
            outputSchema: {
              type: 'object',
              required: ['data', 'metadata'],
              properties: {
                data: { type: 'array' },
                metadata: { type: 'object' }
              }
            }
          }
        ]
      };

      // Mock agent returning invalid data
      vi.spyOn(coordinator, 'executeTask').mockResolvedValue({
        result: { invalidField: 'wrong format' }, // Missing required fields
        status: 'completed'
      });

      await expect(orchestrator.executeWorkflow(workflow))
        .rejects
        .toThrow('Task output validation failed: Missing required fields: data, metadata');
    });
  });

  describe('Error Recovery and Failover', () => {
    it('should automatically retry failed tasks with exponential backoff', async () => {
      const workflow = {
        id: 'retry-test',
        tasks: [
          { 
            id: 'flaky-task',
            dependencies: [], 
            agent: '@code',
            retryPolicy: { maxRetries: 3, backoffMs: 100 }
          }
        ]
      };

      let attemptCount = 0;
      vi.spyOn(coordinator, 'executeTask').mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary failure');
        }
        return { result: { success: true }, status: 'completed' };
      });

      const execution = await orchestrator.executeWorkflow(workflow);

      expect(attemptCount).toBe(3);
      expect(execution.retryAttempts.get('flaky-task')).toBe(2);
      expect(execution.status).toBe('completed');
    });

    it('should perform agent substitution when agent is unavailable', async () => {
      const workflow = {
        id: 'failover-test',
        tasks: [
          { 
            id: 'critical-task',
            dependencies: [], 
            agent: '@work',
            fallbackAgents: ['@code', '@main']
          }
        ]
      };

      vi.spyOn(coordinator, 'isAgentAvailable')
        .mockResolvedValueOnce(false) // @work unavailable
        .mockResolvedValueOnce(true); // @code available

      vi.spyOn(coordinator, 'executeTask').mockResolvedValue({
        result: { completedBy: '@code' },
        status: 'completed'
      });

      const execution = await orchestrator.executeWorkflow(workflow);

      expect(execution.agentSubstitutions.get('critical-task')).toEqual({
        original: '@work',
        substitute: '@code'
      });
      expect(execution.completedTasks[0].result.completedBy).toBe('@code');
    });

    it('should handle partial workflow recovery after system restart', async () => {
      const workflow = {
        id: 'recovery-test',
        tasks: [
          { id: 'task-1', dependencies: [], agent: '@research' },
          { id: 'task-2', dependencies: ['task-1'], agent: '@code' },
          { id: 'task-3', dependencies: ['task-2'], agent: '@work' }
        ]
      };

      // Simulate system crash after task-1 completes
      const checkpoint = {
        workflowId: 'recovery-test',
        completedTasks: [
          { id: 'task-1', result: { data: 'research-complete' }, status: 'completed' }
        ],
        pendingTasks: ['task-2', 'task-3'],
        timestamp: Date.now()
      };

      const execution = await orchestrator.resumeWorkflow(workflow, checkpoint);

      expect(execution.resumedFromCheckpoint).toBe(true);
      expect(execution.completedTasks).toHaveLength(3); // 1 from checkpoint + 2 newly executed
      expect(execution.completedTasks[0].id).toBe('task-1'); // From checkpoint
    });

    it('should escalate to human intervention after max failures', async () => {
      const workflow = {
        id: 'escalation-test',
        tasks: [
          { 
            id: 'critical-business-task',
            dependencies: [], 
            agent: '@work',
            maxFailures: 2,
            escalationRequired: true
          }
        ]
      };

      vi.spyOn(coordinator, 'executeTask').mockRejectedValue(new Error('Critical system failure'));
      vi.spyOn(errorRecovery, 'requestHumanIntervention').mockResolvedValue({
        approved: true,
        manualResult: { humanOverride: true }
      });

      const execution = await orchestrator.executeWorkflow(workflow);

      expect(execution.humanInterventions).toHaveLength(1);
      expect(execution.humanInterventions[0].taskId).toBe('critical-business-task');
      expect(execution.completedTasks[0].result.humanOverride).toBe(true);
    });
  });

  describe('Quality Assurance and Validation', () => {
    it('should validate task output quality meets minimum standards', async () => {
      const workflow = {
        id: 'quality-test',
        tasks: [
          { 
            id: 'code-generation',
            dependencies: [], 
            agent: '@code',
            qualityGates: {
              minCodeCoverage: 80,
              maxCyclomaticComplexity: 10,
              requiresTests: true
            }
          }
        ]
      };

      vi.spyOn(coordinator, 'executeTask').mockResolvedValue({
        result: {
          code: 'function hello() { return "world"; }',
          coverage: 75, // Below minimum
          complexity: 8,
          hasTests: false // Missing tests
        },
        status: 'completed'
      });

      await expect(orchestrator.executeWorkflow(workflow))
        .rejects
        .toThrow('Quality gate failed: Coverage 75% below minimum 80%, Missing required tests');
    });

    it('should automatically request task rework when quality is insufficient', async () => {
      const workflow = {
        id: 'rework-test',
        tasks: [
          { 
            id: 'document-task',
            dependencies: [], 
            agent: '@research',
            autoReworkEnabled: true,
            maxReworkAttempts: 2
          }
        ]
      };

      let reworkCount = 0;
      vi.spyOn(coordinator, 'executeTask').mockImplementation(async (task, context) => {
        reworkCount++;
        return {
          result: {
            quality: reworkCount < 2 ? 'poor' : 'excellent',
            content: `Draft ${reworkCount}`
          },
          status: 'completed'
        };
      });

      const execution = await orchestrator.executeWorkflow(workflow);

      expect(reworkCount).toBe(2);
      expect(execution.reworkAttempts.get('document-task')).toBe(1);
      expect(execution.completedTasks[0].result.quality).toBe('excellent');
    });
  });

  describe('Performance Monitoring', () => {
    it('should track task execution time and resource usage', async () => {
      const workflow = {
        id: 'performance-test',
        tasks: [
          { id: 'cpu-intensive', dependencies: [], agent: '@code' },
          { id: 'memory-intensive', dependencies: [], agent: '@research' }
        ]
      };

      const execution = await orchestrator.executeWorkflow(workflow);

      expect(execution.performanceMetrics.totalExecutionTime).toBeGreaterThan(0);
      expect(execution.performanceMetrics.taskMetrics).toHaveProperty('cpu-intensive');
      expect(execution.performanceMetrics.taskMetrics).toHaveProperty('memory-intensive');
      
      const cpuTask = execution.performanceMetrics.taskMetrics['cpu-intensive'];
      expect(cpuTask.executionTime).toBeGreaterThan(0);
      expect(cpuTask.memoryUsage).toBeGreaterThan(0);
      expect(cpuTask.cpuUsage).toBeGreaterThan(0);
    });

    it('should identify performance bottlenecks in task dependencies', async () => {
      const workflow = {
        id: 'bottleneck-test',
        tasks: [
          { id: 'fast-task', dependencies: [], agent: '@main' },
          { id: 'slow-bottleneck', dependencies: ['fast-task'], agent: '@code' },
          { id: 'waiting-task', dependencies: ['slow-bottleneck'], agent: '@work' }
        ]
      };

      const execution = await orchestrator.executeWorkflow(workflow);

      expect(execution.bottleneckAnalysis.criticalPath).toEqual([
        'fast-task', 'slow-bottleneck', 'waiting-task'
      ]);
      expect(execution.bottleneckAnalysis.slowestTask.id).toBe('slow-bottleneck');
      expect(execution.bottleneckAnalysis.potentialParallelization).toHaveProperty('suggestions');
    });
  });
});