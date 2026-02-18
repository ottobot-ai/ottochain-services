/**
 * Analytics & Optimization Tests (Phase 4)
 * 
 * TDD tests for user behavior analytics, agent performance insights,
 * platform health monitoring, and business intelligence capabilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnalyticsEngine } from '../analytics-engine.js';
import { UserBehaviorAnalyzer } from '../user-behavior-analyzer.js';
import { AgentPerformanceTracker } from '../agent-performance-tracker.js';
import { PlatformHealthMonitor } from '../platform-health-monitor.js';
import { BusinessIntelligenceService } from '../business-intelligence.js';
import { CostOptimizationEngine } from '../cost-optimization.js';

describe('Analytics & Optimization', () => {
  let analyticsEngine: AnalyticsEngine;
  let userBehavior: UserBehaviorAnalyzer;
  let agentPerformance: AgentPerformanceTracker;
  let platformHealth: PlatformHealthMonitor;
  let businessIntelligence: BusinessIntelligenceService;
  let costOptimization: CostOptimizationEngine;

  beforeEach(() => {
    userBehavior = new UserBehaviorAnalyzer({
      trackingEnabled: true,
      anonymization: true,
      retentionDays: 90
    });

    agentPerformance = new AgentPerformanceTracker({
      metricsInterval: 60000, // 1 minute
      performanceThresholds: {
        responseTime: 30000,
        successRate: 0.95,
        qualityScore: 0.8
      }
    });

    platformHealth = new PlatformHealthMonitor({
      monitoringInterval: 30000, // 30 seconds
      alertThresholds: {
        cpu: 0.8,
        memory: 0.85,
        diskSpace: 0.9,
        errorRate: 0.05
      }
    });

    businessIntelligence = new BusinessIntelligenceService({
      reportingFrequency: 'daily',
      forecastingEnabled: true,
      cohortAnalysis: true
    });

    costOptimization = new CostOptimizationEngine({
      monitorCosts: true,
      optimizationTargets: ['token-usage', 'compute-time', 'storage'],
      savingsThreshold: 0.1 // 10% savings threshold
    });

    analyticsEngine = new AnalyticsEngine({
      userBehavior,
      agentPerformance,
      platformHealth,
      businessIntelligence,
      costOptimization
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('User Behavior Analytics', () => {
    it('should track task patterns and identify user preferences', async () => {
      const userSession = {
        userId: 'user-123',
        sessionId: 'session-456',
        activities: [
          { type: 'task-creation', agent: '@research', category: 'market-analysis', timestamp: Date.now() - 3600000 },
          { type: 'task-creation', agent: '@code', category: 'automation', timestamp: Date.now() - 3000000 },
          { type: 'task-creation', agent: '@research', category: 'competitive-analysis', timestamp: Date.now() - 1800000 },
          { type: 'task-modification', taskId: 'task-1', changes: ['priority'], timestamp: Date.now() - 1200000 },
          { type: 'result-review', taskId: 'task-1', satisfaction: 4, timestamp: Date.now() - 600000 }
        ]
      };

      await userBehavior.trackSession(userSession);

      const patterns = await userBehavior.analyzeUserPatterns('user-123');

      expect(patterns.preferredAgents).toContain('@research');
      expect(patterns.commonCategories).toContain('market-analysis');
      expect(patterns.taskFrequency.daily).toBeGreaterThan(0);
      expect(patterns.satisfactionTrend).toBeDefined();
      expect(patterns.peakUsageHours).toHaveLength.greaterThan(0);
    });

    it('should measure task success rates and user satisfaction', async () => {
      const taskOutcomes = [
        { userId: 'user-789', taskId: 'task-1', outcome: 'success', satisfaction: 5, agent: '@code' },
        { userId: 'user-789', taskId: 'task-2', outcome: 'success', satisfaction: 4, agent: '@research' },
        { userId: 'user-789', taskId: 'task-3', outcome: 'partial', satisfaction: 3, agent: '@work' },
        { userId: 'user-789', taskId: 'task-4', outcome: 'failed', satisfaction: 2, agent: '@code' },
        { userId: 'user-789', taskId: 'task-5', outcome: 'success', satisfaction: 5, agent: '@research' }
      ];

      for (const outcome of taskOutcomes) {
        await userBehavior.recordTaskOutcome(outcome);
      }

      const satisfactionMetrics = await userBehavior.calculateSatisfactionMetrics('user-789');

      expect(satisfactionMetrics.overallSatisfaction).toBeCloseTo(3.8, 1);
      expect(satisfactionMetrics.successRate).toBe(0.6); // 3/5 full successes
      expect(satisfactionMetrics.agentSatisfaction['@research']).toBe(4.5);
      expect(satisfactionMetrics.agentSatisfaction['@code']).toBe(3.5);
    });

    it('should identify usage patterns for proactive optimization', async () => {
      const usageData = {
        userId: 'user-optimization-test',
        timeRange: { start: Date.now() - 2592000000, end: Date.now() }, // 30 days
        activities: Array.from({ length: 100 }, (_, i) => ({
          type: 'task-creation',
          timestamp: Date.now() - (i * 259200000), // Spread over 30 days
          category: i % 3 === 0 ? 'urgent' : i % 3 === 1 ? 'research' : 'routine',
          agent: i % 4 === 0 ? '@main' : i % 4 === 1 ? '@research' : i % 4 === 2 ? '@code' : '@work',
          complexity: Math.random() > 0.7 ? 'high' : 'medium'
        }))
      };

      const optimizations = await userBehavior.suggestOptimizations(usageData);

      expect(optimizations.batchingOpportunities).toBeDefined();
      expect(optimizations.agentPreloading).toHaveLength.greaterThan(0);
      expect(optimizations.priorityAdjustments).toBeDefined();
      expect(optimizations.estimatedTimeSavings).toBeGreaterThan(0);
    });

    it('should perform cohort analysis for user retention insights', async () => {
      const cohorts = [
        { cohortMonth: '2026-01', users: 50, retainedMonth2: 35, retainedMonth3: 28 },
        { cohortMonth: '2026-02', users: 75, retainedMonth2: 55, retainedMonth3: 0 }, // Current month
        { cohortMonth: '2025-12', users: 40, retainedMonth2: 32, retainedMonth3: 26 }
      ];

      const cohortAnalysis = await userBehavior.analyzeCohorts(cohorts);

      expect(cohortAnalysis.retentionRates.month2).toBeCloseTo(0.73, 2); // 73% month 2 retention
      expect(cohortAnalysis.retentionRates.month3).toBeCloseTo(0.69, 2); // 69% month 3 retention
      expect(cohortAnalysis.trends.month2).toBeDefined();
      expect(cohortAnalysis.insights.keyFactors).toHaveLength.greaterThan(0);
    });
  });

  describe('Agent Performance Insights', () => {
    it('should track efficiency metrics across all agents', async () => {
      const performanceData = [
        { agent: '@research', taskId: 'perf-1', duration: 300000, quality: 0.9, complexity: 'medium' },
        { agent: '@code', taskId: 'perf-2', duration: 600000, quality: 0.85, complexity: 'high' },
        { agent: '@work', taskId: 'perf-3', duration: 450000, quality: 0.95, complexity: 'high' },
        { agent: '@main', taskId: 'perf-4', duration: 150000, quality: 0.8, complexity: 'low' },
        { agent: '@research', taskId: 'perf-5', duration: 320000, quality: 0.92, complexity: 'medium' }
      ];

      for (const data of performanceData) {
        await agentPerformance.recordTaskPerformance(data);
      }

      const efficiencyReport = await agentPerformance.generateEfficiencyReport();

      expect(efficiencyReport.agents['@research'].averageDuration).toBeCloseTo(310000, -3);
      expect(efficiencyReport.agents['@research'].averageQuality).toBeCloseTo(0.91, 2);
      expect(efficiencyReport.agents['@work'].efficiencyScore).toBeGreaterThan(0.8);
      expect(efficiencyReport.overallEfficiency).toBeDefined();
    });

    it('should provide cost optimization recommendations per agent', async () => {
      const costData = [
        { agent: '@code', tokenUsage: 50000, computeTime: 1800, cost: 15.50 },
        { agent: '@research', tokenUsage: 35000, computeTime: 1200, cost: 11.20 },
        { agent: '@work', tokenUsage: 28000, computeTime: 900, cost: 8.75 },
        { agent: '@main', tokenUsage: 20000, computeTime: 600, cost: 6.80 }
      ];

      const optimizations = await agentPerformance.suggestCostOptimizations(costData);

      expect(optimizations.tokenEfficiency.recommendations).toHaveLength.greaterThan(0);
      expect(optimizations.computeOptimization.potentialSavings).toBeGreaterThan(0);
      expect(optimizations.overallSavings.percentage).toBeGreaterThan(0);
      expect(optimizations.priorityOptimizations).toHaveLength.greaterThan(0);
    });

    it('should detect agent performance anomalies', async () => {
      const baselinePerformance = Array.from({ length: 30 }, (_, i) => ({
        agent: '@code',
        day: i + 1,
        avgResponseTime: 25000 + (Math.random() * 5000), // Normal: 25-30 seconds
        successRate: 0.95 + (Math.random() * 0.04), // Normal: 95-99%
        qualityScore: 0.85 + (Math.random() * 0.1) // Normal: 85-95%
      }));

      // Add anomalous data points
      baselinePerformance.push({
        agent: '@code',
        day: 31,
        avgResponseTime: 85000, // Anomaly: 85 seconds
        successRate: 0.75, // Anomaly: 75%
        qualityScore: 0.6 // Anomaly: 60%
      });

      const anomalies = await agentPerformance.detectAnomalies(baselinePerformance, '@code');

      expect(anomalies.detected).toBe(true);
      expect(anomalies.anomalyCount).toBe(3); // All three metrics anomalous
      expect(anomalies.severity).toBe('high');
      expect(anomalies.suggestedActions).toContain('investigate-performance-degradation');
    });

    it('should benchmark agents against historical performance', async () => {
      const historicalData = {
        agent: '@research',
        timeframe: '90days',
        metrics: {
          averageResponseTime: { current: 22000, historical: 25000 },
          successRate: { current: 0.97, historical: 0.94 },
          qualityScore: { current: 0.89, historical: 0.86 },
          userSatisfaction: { current: 4.2, historical: 3.9 }
        }
      };

      const benchmark = await agentPerformance.benchmarkAgent(historicalData);

      expect(benchmark.overallImprovement).toBe(true);
      expect(benchmark.improvements.responseTime).toBeCloseTo(-0.12, 2); // 12% improvement
      expect(benchmark.improvements.successRate).toBeCloseTo(0.032, 3); // 3.2% improvement
      expect(benchmark.trend).toBe('improving');
      expect(benchmark.percentile).toBeGreaterThan(75); // Above 75th percentile
    });
  });

  describe('Platform Health Monitoring', () => {
    it('should provide comprehensive system performance metrics', async () => {
      const systemMetrics = await platformHealth.collectSystemMetrics();

      expect(systemMetrics.timestamp).toBeInstanceOf(Date);
      expect(systemMetrics.cpu.usage).toBeGreaterThanOrEqual(0);
      expect(systemMetrics.cpu.usage).toBeLessThanOrEqual(1);
      expect(systemMetrics.memory.used).toBeGreaterThan(0);
      expect(systemMetrics.memory.available).toBeGreaterThan(0);
      expect(systemMetrics.network.latency).toBeGreaterThan(0);
      expect(systemMetrics.activeConnections).toBeGreaterThanOrEqual(0);
    });

    it('should detect capacity planning needs before issues occur', async () => {
      const capacityData = {
        historicalUsage: Array.from({ length: 30 }, (_, i) => ({
          day: i + 1,
          cpu: 0.3 + (i * 0.015), // Gradual increase from 30% to 73%
          memory: 0.4 + (i * 0.012), // Gradual increase from 40% to 76%
          diskSpace: 0.2 + (i * 0.008), // Gradual increase from 20% to 44%
          taskVolume: 100 + (i * 5) // Increasing task volume
        })),
        projectionDays: 30
      };

      const capacityPlan = await platformHealth.planCapacity(capacityData);

      expect(capacityPlan.cpuProjection.willExceedThreshold).toBe(true);
      expect(capacityPlan.cpuProjection.daysUntilThreshold).toBeLessThan(30);
      expect(capacityPlan.memoryProjection.recommendedAction).toBe('scale-up');
      expect(capacityPlan.overallRecommendation.urgency).toBeOneOf(['low', 'medium', 'high']);
    });

    it('should optimize resource allocation based on usage patterns', async () => {
      const usagePatterns = {
        hourlyDistribution: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          taskVolume: hour >= 9 && hour <= 17 ? 50 + (Math.random() * 30) : 10 + (Math.random() * 15),
          resourceUsage: hour >= 9 && hour <= 17 ? 0.7 + (Math.random() * 0.2) : 0.3 + (Math.random() * 0.1)
        })),
        weeklyDistribution: Array.from({ length: 7 }, (_, day) => ({
          day,
          avgTaskVolume: day < 5 ? 200 + (Math.random() * 100) : 50 + (Math.random() * 30),
          peakUsage: day < 5 ? 0.85 + (Math.random() * 0.1) : 0.4 + (Math.random() * 0.2)
        }))
      };

      const allocation = await platformHealth.optimizeResourceAllocation(usagePatterns);

      expect(allocation.scaleSchedule).toHaveLength(24); // Hourly scaling recommendations
      expect(allocation.weekendScaleDown).toBe(true);
      expect(allocation.estimatedSavings.percentage).toBeGreaterThan(0);
      expect(allocation.performanceImpact).toBe('minimal');
    });

    it('should provide predictive maintenance alerts', async () => {
      const systemHealth = {
        components: [
          { name: 'database', health: 0.85, trend: 'declining', lastMaintenance: Date.now() - 2592000000 },
          { name: 'message-queue', health: 0.95, trend: 'stable', lastMaintenance: Date.now() - 1296000000 },
          { name: 'cache-layer', health: 0.75, trend: 'declining', lastMaintenance: Date.now() - 3888000000 }
        ],
        errorRates: { database: 0.02, messageQueue: 0.001, cache: 0.05 },
        responseTimeTrends: { database: 'increasing', messageQueue: 'stable', cache: 'increasing' }
      };

      const maintenanceAlerts = await platformHealth.generateMaintenanceAlerts(systemHealth);

      expect(maintenanceAlerts.urgentMaintenance).toHaveLength.greaterThan(0);
      expect(maintenanceAlerts.urgentMaintenance[0].component).toBe('cache-layer');
      expect(maintenanceAlerts.scheduledMaintenance).toHaveLength.greaterThan(0);
      expect(maintenanceAlerts.overallSystemRisk).toBeOneOf(['low', 'medium', 'high']);
    });
  });

  describe('Business Intelligence', () => {
    it('should track revenue metrics and growth trends', async () => {
      const revenueData = {
        monthlyRevenue: [
          { month: '2025-10', revenue: 12500, users: 85, avgRevenuePerUser: 147 },
          { month: '2025-11', revenue: 15200, users: 102, avgRevenuePerUser: 149 },
          { month: '2025-12', revenue: 18800, users: 125, avgRevenuePerUser: 150 },
          { month: '2026-01', revenue: 23400, users: 148, avgRevenuePerUser: 158 },
          { month: '2026-02', revenue: 28100, users: 167, avgRevenuePerUser: 168 }
        ]
      };

      const businessMetrics = await businessIntelligence.calculateBusinessMetrics(revenueData);

      expect(businessMetrics.growthRate.monthlyAverage).toBeGreaterThan(0.15); // >15% growth
      expect(businessMetrics.userGrowth.trend).toBe('accelerating');
      expect(businessMetrics.revenuePerUser.trend).toBe('increasing');
      expect(businessMetrics.projections.nextMonth.revenue).toBeGreaterThan(28100);
    });

    it('should analyze user acquisition channels and effectiveness', async () => {
      const acquisitionData = [
        { channel: 'organic-search', users: 45, cost: 0, ltv: 285, retention: 0.82 },
        { channel: 'social-media', users: 28, cost: 1400, ltv: 195, retention: 0.68 },
        { channel: 'referral', users: 35, cost: 350, ltv: 320, retention: 0.89 },
        { channel: 'paid-ads', users: 22, cost: 2200, ltv: 180, retention: 0.55 },
        { channel: 'content-marketing', users: 18, cost: 900, ltv: 250, retention: 0.75 }
      ];

      const channelAnalysis = await businessIntelligence.analyzeAcquisitionChannels(acquisitionData);

      expect(channelAnalysis.mostEffective.channel).toBe('referral'); // Highest ROI
      expect(channelAnalysis.channelROI.referral).toBeGreaterThan(8); // $320 LTV - $10 cost per user
      expect(channelAnalysis.budgetRecommendations.increase).toContain('organic-search');
      expect(channelAnalysis.budgetRecommendations.decrease).toContain('paid-ads');
    });

    it('should forecast business metrics using predictive models', async () => {
      const historicalMetrics = Array.from({ length: 24 }, (_, i) => ({
        month: `2024-${String(i + 1).padStart(2, '0')}`,
        users: 50 + (i * 8) + (Math.random() * 10),
        revenue: 5000 + (i * 1200) + (Math.random() * 500),
        churnRate: 0.05 + (Math.random() * 0.02),
        satisfactionScore: 3.8 + (Math.random() * 0.4)
      }));

      const forecast = await businessIntelligence.forecastMetrics(historicalMetrics, {
        forecastMonths: 6,
        confidenceInterval: 0.95
      });

      expect(forecast.userGrowth.prediction).toHaveLength(6);
      expect(forecast.revenueGrowth.prediction).toHaveLength(6);
      expect(forecast.confidenceIntervals.users).toBeDefined();
      expect(forecast.assumptions.growth.sustainable).toBeDefined();
      expect(forecast.riskFactors).toHaveLength.greaterThan(0);
    });

    it('should provide market analysis and competitive positioning', async () => {
      const marketData = {
        totalAddressableMarket: 50000000000, // $50B
        servicableAddressableMarket: 2000000000, // $2B
        currentMarketShare: 0.0001, // 0.01%
        competitors: [
          { name: 'CompetitorA', marketShare: 0.15, pricing: 'premium' },
          { name: 'CompetitorB', marketShare: 0.08, pricing: 'competitive' },
          { name: 'CompetitorC', marketShare: 0.12, pricing: 'budget' }
        ],
        industryGrowth: 0.25 // 25% annual growth
      };

      const marketAnalysis = await businessIntelligence.analyzeMarketPosition(marketData);

      expect(marketAnalysis.growthOpportunity.revenue).toBeGreaterThan(500000000);
      expect(marketAnalysis.competitiveAdvantages).toHaveLength.greaterThan(0);
      expect(marketAnalysis.marketStrategy.recommended).toBeDefined();
      expect(marketAnalysis.timeToMarketLeadership.years).toBeLessThan(10);
    });
  });

  describe('Cost Optimization', () => {
    it('should optimize token usage across different models and agents', async () => {
      const tokenUsage = [
        { agent: '@code', model: 'gpt-4', tokens: 45000, cost: 0.90, tasks: 15 },
        { agent: '@research', model: 'claude-3', tokens: 38000, cost: 0.76, tasks: 12 },
        { agent: '@work', model: 'gpt-4', tokens: 52000, cost: 1.04, tasks: 18 },
        { agent: '@main', model: 'gpt-3.5', tokens: 25000, cost: 0.25, tasks: 20 }
      ];

      const optimizations = await costOptimization.optimizeTokenUsage(tokenUsage);

      expect(optimizations.recommendations).toHaveLength.greaterThan(0);
      expect(optimizations.potentialSavings.monthly).toBeGreaterThan(0);
      expect(optimizations.modelSuggestions).toBeDefined();
      expect(optimizations.efficiencyImprovements.averageTokensPerTask).toBeLessThan(3000);
    });

    it('should implement batch processing for cost-effective operations', async () => {
      const taskQueue = Array.from({ length: 50 }, (_, i) => ({
        id: `task-${i}`,
        type: i % 3 === 0 ? 'research' : i % 3 === 1 ? 'analysis' : 'summary',
        priority: i < 10 ? 'high' : i < 30 ? 'medium' : 'low',
        estimatedTokens: 1000 + (Math.random() * 2000),
        createdAt: Date.now() - (i * 60000)
      }));

      const batchStrategy = await costOptimization.createBatchStrategy(taskQueue);

      expect(batchStrategy.batches).toHaveLength.greaterThan(1);
      expect(batchStrategy.costSavings.percentage).toBeGreaterThan(0.2); // >20% savings
      expect(batchStrategy.processingTime.estimated).toBeLessThan(7200000); // <2 hours
      expect(batchStrategy.qualityImpact).toBe('minimal');
    });

    it('should provide real-time cost monitoring and alerts', async () => {
      const costThresholds = {
        daily: 100,
        weekly: 600,
        monthly: 2400
      };

      const currentUsage = {
        today: 85,
        thisWeek: 520,
        thisMonth: 1950
      };

      const costMonitoring = await costOptimization.monitorCosts(currentUsage, costThresholds);

      expect(costMonitoring.alerts.daily.triggered).toBe(false);
      expect(costMonitoring.alerts.weekly.triggered).toBe(false);
      expect(costMonitoring.alerts.monthly.triggered).toBe(false);
      expect(costMonitoring.projectedMonthly).toBeGreaterThan(2000);
      expect(costMonitoring.recommendations.immediate).toBeDefined();
    });

    it('should optimize compute resource allocation for different workloads', async () => {
      const workloadTypes = [
        { type: 'research-intensive', avgDuration: 1800, cpuUsage: 0.3, memoryUsage: 0.6, frequency: 25 },
        { type: 'code-generation', avgDuration: 900, cpuUsage: 0.8, memoryUsage: 0.4, frequency: 35 },
        { type: 'data-analysis', avgDuration: 1200, cpuUsage: 0.6, memoryUsage: 0.8, frequency: 20 },
        { type: 'simple-tasks', avgDuration: 300, cpuUsage: 0.2, memoryUsage: 0.2, frequency: 45 }
      ];

      const resourceOptimization = await costOptimization.optimizeResourceAllocation(workloadTypes);

      expect(resourceOptimization.recommendedInstances).toBeDefined();
      expect(resourceOptimization.costSavings.annual).toBeGreaterThan(1000);
      expect(resourceOptimization.performanceImpact).toBe('improved');
      expect(resourceOptimization.scalingStrategy.dynamic).toBe(true);
    });
  });

  describe('Comprehensive Analytics Dashboard', () => {
    it('should provide unified metrics across all system components', async () => {
      const dashboardData = await analyticsEngine.generateUnifiedDashboard({
        timeRange: { start: Date.now() - 604800000, end: Date.now() }, // 7 days
        includeForecasts: true,
        detailLevel: 'comprehensive'
      });

      expect(dashboardData.userMetrics).toBeDefined();
      expect(dashboardData.agentMetrics).toBeDefined();
      expect(dashboardData.systemMetrics).toBeDefined();
      expect(dashboardData.businessMetrics).toBeDefined();
      expect(dashboardData.costMetrics).toBeDefined();
      expect(dashboardData.forecasts.nextWeek).toBeDefined();
      expect(dashboardData.alerts.active).toBeGreaterThanOrEqual(0);
      expect(dashboardData.recommendations.priority).toHaveLength.greaterThan(0);
    });

    it('should enable drill-down analysis for specific metrics', async () => {
      const drillDownQuery = {
        metric: 'agent-performance',
        agent: '@code',
        timeRange: { start: Date.now() - 2592000000, end: Date.now() }, // 30 days
        groupBy: 'day',
        filters: { taskType: 'code-generation', complexity: 'high' }
      };

      const drillDownData = await analyticsEngine.drillDownAnalysis(drillDownQuery);

      expect(drillDownData.dataPoints).toHaveLength(30);
      expect(drillDownData.trends.performance).toBeDefined();
      expect(drillDownData.correlations.complexity).toBeDefined();
      expect(drillDownData.insights.keyFindings).toHaveLength.greaterThan(0);
      expect(drillDownData.comparisons.baseline).toBeDefined();
    });

    it('should provide automated insights and anomaly detection', async () => {
      const insights = await analyticsEngine.generateAutomatedInsights({
        analysisDepth: 'deep',
        confidenceThreshold: 0.8,
        includeRecommendations: true
      });

      expect(insights.anomalies.detected).toHaveLength.greaterThanOrEqual(0);
      expect(insights.patterns.significant).toHaveLength.greaterThan(0);
      expect(insights.recommendations.actionable).toHaveLength.greaterThan(0);
      expect(insights.predictions.confidence).toBeGreaterThan(0.8);
      expect(insights.businessImpact.estimated).toBeDefined();
    });

    it('should support custom reporting and scheduled delivery', async () => {
      const customReport = {
        name: 'Weekly Executive Summary',
        schedule: { frequency: 'weekly', day: 'monday', time: '09:00' },
        recipients: ['ceo@company.com', 'cto@company.com'],
        sections: [
          'business-overview',
          'user-growth',
          'agent-performance',
          'cost-analysis',
          'key-insights'
        ],
        format: 'pdf',
        delivery: 'email'
      };

      const reportResult = await analyticsEngine.createCustomReport(customReport);

      expect(reportResult.created).toBe(true);
      expect(reportResult.reportId).toBeDefined();
      expect(reportResult.nextScheduledRun).toBeInstanceOf(Date);
      expect(reportResult.estimatedSize).toBeLessThan(5000000); // <5MB
      expect(reportResult.deliveryMethod.configured).toBe(true);
    });
  });
});