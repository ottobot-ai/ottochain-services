/**
 * Sybil Detection Service for OttoChain Bridge API
 * 
 * Provides REST endpoints for Sybil resistance and collusion detection system.
 * Integrates with the Scala-based detection engine via metagraph queries.
 */

import { Request, Response } from 'express';
import { z } from 'zod';

// API Request/Response Schemas
export const AgentScreeningRequest = z.object({
  agentId: z.string(),
  registrationData: z.object({
    providedStake: z.number(),
    registrationTimestamp: z.number(),
    ipAddress: z.string(),
    userAgent: z.string()
  })
});

export const BehaviorProfileUpdate = z.object({
  agentId: z.string(),
  profile: z.object({
    avgResponseTime: z.number(),
    responseTimeStdDev: z.number(),
    typingPattern: z.array(z.number()),
    vocabularyFingerprint: z.array(z.string()),
    transactionPattern: z.object({
      avgTxInterval: z.number(),
      typicalAmounts: z.array(z.number()),
      gasPreferences: z.object({
        preferredGasPrice: z.tuple([z.number(), z.number()]),
        gasLimitPreferences: z.array(z.number()),
        mevSensitivity: z.number()
      }),
      contractUsage: z.record(z.number())
    }),
    activityPattern: z.record(z.number()),
    lastUpdated: z.number()
  })
});

export const DetectionRequest = z.object({
  agents: z.array(z.string()),
  timeWindow: z.number().optional().default(7 * 24 * 3600 * 1000), // 1 week default
  includeNetworkAnalysis: z.boolean().optional().default(true),
  confidenceThreshold: z.number().min(0).max(1).optional().default(0.7)
});

export const HardwareFingerprintSubmission = z.object({
  agentId: z.string(),
  fingerprint: z.object({
    teeAttestation: z.string().optional(),
    cpuSignature: z.string(),
    systemHash: z.string(),
    timestamp: z.number()
  })
});

export const PenaltyAppealRequest = z.object({
  agentId: z.string(),
  detectionId: z.string(),
  penaltyId: z.string(),
  evidence: z.array(z.object({
    evidenceType: z.string(),
    description: z.string(),
    supportingData: z.record(z.string())
  }))
});

// Response Types
interface ScreeningResult {
  agentId: string;
  riskLevel: 'Low' | 'Medium' | 'High';
  riskScore: number;
  flags: string[];
  recommendedAction: string;
  screenedAt: number;
}

interface DetectionResult {
  detectionId: string;
  analyzedAgents: string[];
  individualResults: Array<{
    agentId: string;
    sybilProbability: number;
    componentScores: Record<string, number>;
    confidence: number;
    explanation: string;
  }>;
  suspiciousClusters: Array<{
    agents: string[];
    suspicionScore: number;
    behaviorType: string;
    evidence: any[];
    detectedAt: number;
  }>;
  appliedPenalties: any[];
  systemHealth: {
    overallScore: number;
    totalAgentsAnalyzed: number;
    flaggedAgents: number;
    criticalThreats: number;
    systemStatus: string;
  };
  detectedAt: number;
}

interface AgentPenaltyStatus {
  agentId: string;
  activePenalties: any[];
  totalReputationSlash: number;
  currentRestrictions: string[];
  appealEligible: boolean;
  lastUpdated: number;
}

/**
 * Sybil Detection Service Class
 */
export class SybilDetectorService {
  private config: {
    behaviorSimilarityThreshold: number;
    minSuspiciousClusterSize: number;
    correlationTimeWindow: number;
    sybilReputationSlash: number;
    falsePositiveTarget: number;
    minimumStake: number;
    requireHardwareAttestation: boolean;
  };

  private behaviorProfiles: Map<string, any> = new Map();
  private hardwareFingerprints: Map<string, any> = new Map();
  private detectionHistory: Map<string, DetectionResult> = new Map();
  private penaltyDatabase: Map<string, any> = new Map();

  constructor() {
    this.config = {
      behaviorSimilarityThreshold: 0.85,
      minSuspiciousClusterSize: 3,
      correlationTimeWindow: 300000, // 5 minutes
      sybilReputationSlash: 0.90,
      falsePositiveTarget: 0.05,
      minimumStake: 1000.0,
      requireHardwareAttestation: false
    };
  }

  /**
   * Screen new agent registration for Sybil indicators
   */
  async screenAgent(req: Request, res: Response): Promise<Response> {
    try {
      const data = AgentScreeningRequest.parse(req.body);
      
      // Perform initial screening
      const riskFlags = this.analyzeRegistrationRisk(data);
      const hardwareRisk = await this.assessHardwareRisk(data.agentId);
      
      const riskScore = this.calculateInitialRiskScore(riskFlags, hardwareRisk);
      const riskLevel = this.categorizeRiskLevel(riskScore);
      const recommendedAction = this.determineScreeningAction(riskScore);
      
      const result: ScreeningResult = {
        agentId: data.agentId,
        riskLevel,
        riskScore,
        flags: riskFlags,
        recommendedAction,
        screenedAt: Date.now()
      };

      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid screening request', details: error });
    }
  }

  /**
   * Update behavior profile for an agent
   */
  async updateBehaviorProfile(req: Request, res: Response): Promise<Response> {
    try {
      const data = BehaviorProfileUpdate.parse(req.body);
      
      // Store behavior profile
      this.behaviorProfiles.set(data.agentId, data.profile);
      
      // Check for immediate Sybil indicators
      const similarAgents = await this.findSimilarBehaviorAgents(data.agentId, data.profile);
      
      const result = {
        success: true,
        agentId: data.agentId,
        profileUpdated: true,
        similarAgents: similarAgents.length,
        triggerAlert: similarAgents.length >= this.config.minSuspiciousClusterSize,
        updatedAt: Date.now()
      };

      // If threshold exceeded, trigger automatic detection
      if (result.triggerAlert) {
        this.triggerAutomaticDetection([data.agentId, ...similarAgents]);
      }

      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid behavior profile update', details: error });
    }
  }

  /**
   * Submit hardware fingerprint for verification
   */
  async submitHardwareFingerprint(req: Request, res: Response): Promise<Response> {
    try {
      const data = HardwareFingerprintSubmission.parse(req.body);
      
      // Verify fingerprint authenticity
      const { isValid, confidence } = await this.verifyHardwareFingerprint(data.fingerprint);
      
      if (!isValid) {
        return res.status(400).json({ 
          error: 'Invalid hardware fingerprint', 
          confidence 
        });
      }
      
      // Store fingerprint
      this.hardwareFingerprints.set(data.agentId, data.fingerprint);
      
      // Check for hardware sharing
      const sharedHardwareAgents = await this.detectHardwareSharing(data.agentId, data.fingerprint);
      
      const result = {
        success: true,
        agentId: data.agentId,
        fingerprintAccepted: true,
        confidence,
        sharedHardwareDetected: sharedHardwareAgents.length > 0,
        potentialSybilAgents: sharedHardwareAgents,
        submittedAt: Date.now()
      };

      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid fingerprint submission', details: error });
    }
  }

  /**
   * Run comprehensive Sybil detection analysis
   */
  async runDetection(req: Request, res: Response): Promise<Response> {
    try {
      const data = DetectionRequest.parse(req.body);
      
      // Gather data for analysis
      const behaviorProfiles = this.gatherBehaviorProfiles(data.agents);
      const hardwareFingerprints = this.gatherHardwareFingerprints(data.agents);
      const networkGraph = await this.buildNetworkGraph(data.agents, data.timeWindow);
      
      // Run detection analysis
      const detectionResult = await this.performDetection(
        data.agents,
        behaviorProfiles,
        hardwareFingerprints,
        networkGraph,
        data.confidenceThreshold
      );
      
      // Store detection result
      this.detectionHistory.set(detectionResult.detectionId, detectionResult);
      
      // Apply penalties if warranted
      if (data.confidenceThreshold <= 0.8) {
        await this.processPenalties(detectionResult);
      }

      return res.json(detectionResult);
    } catch (error) {
      return res.status(500).json({ error: 'Detection analysis failed', details: error });
    }
  }

  /**
   * Get detection history and results
   */
  async getDetectionHistory(req: Request, res: Response): Promise<Response> {
    try {
      const { agentId, limit = 10, offset = 0 } = req.query;
      
      let detections = Array.from(this.detectionHistory.values());
      
      // Filter by agent if specified
      if (agentId) {
        detections = detections.filter(d => 
          d.analyzedAgents.includes(agentId as string) ||
          d.individualResults.some(r => r.agentId === agentId)
        );
      }
      
      // Sort by detection time (most recent first)
      detections.sort((a, b) => b.detectedAt - a.detectedAt);
      
      // Apply pagination
      const paginatedDetections = detections.slice(Number(offset), Number(offset) + Number(limit));
      
      const result = {
        detections: paginatedDetections,
        total: detections.length,
        hasMore: Number(offset) + Number(limit) < detections.length
      };

      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to retrieve detection history', details: error });
    }
  }

  /**
   * Get penalty status for an agent
   */
  async getAgentPenaltyStatus(req: Request, res: Response): Promise<Response> {
    try {
      const agentId = req.params.agentId;
      
      if (!agentId) {
        return res.status(400).json({ error: 'Agent ID is required' });
      }
      
      const status: AgentPenaltyStatus = {
        agentId,
        activePenalties: this.getActivePenalties(agentId),
        totalReputationSlash: this.getTotalReputationSlash(agentId),
        currentRestrictions: this.getCurrentRestrictions(agentId),
        appealEligible: this.checkAppealEligibility(agentId),
        lastUpdated: Date.now()
      };

      return res.json(status);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to retrieve penalty status', details: error });
    }
  }

  /**
   * Submit appeal against applied penalty
   */
  async submitPenaltyAppeal(req: Request, res: Response): Promise<Response> {
    try {
      const data = PenaltyAppealRequest.parse(req.body);
      
      // Validate appeal eligibility
      const isEligible = this.checkAppealEligibility(data.agentId);
      if (!isEligible) {
        return res.status(400).json({ 
          error: 'Agent not eligible for appeal',
          reason: 'Appeal deadline expired or multiple appeals submitted'
        });
      }
      
      // Create appeal record
      const appealId = this.generateAppealId();
      const appeal = {
        appealId,
        agentId: data.agentId,
        detectionId: data.detectionId,
        penaltyId: data.penaltyId,
        evidence: data.evidence,
        appealDeadline: Date.now() + 7 * 24 * 3600 * 1000, // 7 days
        submittedAt: Date.now(),
        status: 'pending'
      };
      
      // Store appeal (in production, would go to database)
      this.storeAppeal(appeal);
      
      const result = {
        success: true,
        appealId,
        message: 'Appeal submitted successfully',
        expectedReviewTime: '3-5 business days',
        submittedAt: appeal.submittedAt
      };

      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid appeal submission', details: error });
    }
  }

  /**
   * Get system health and monitoring statistics
   */
  async getSystemHealth(req: Request, res: Response): Promise<Response> {
    try {
      const recentDetections = Array.from(this.detectionHistory.values())
        .filter(d => d.detectedAt > Date.now() - 24 * 3600 * 1000); // Last 24 hours
      
      const totalAgents = this.behaviorProfiles.size;
      const flaggedAgents = recentDetections.reduce((count, d) => 
        count + d.individualResults.filter(r => r.sybilProbability >= 0.6).length, 0
      );
      
      const criticalThreats = recentDetections.reduce((count, d) => 
        count + d.individualResults.filter(r => r.sybilProbability >= 0.9).length, 0
      );
      
      const healthScore = totalAgents > 0 ? 1.0 - (flaggedAgents / totalAgents) : 1.0;
      
      const systemHealth = {
        overallScore: healthScore,
        totalAgentsAnalyzed: totalAgents,
        flaggedAgents,
        criticalThreats,
        systemStatus: healthScore >= 0.9 ? 'Healthy' : healthScore >= 0.7 ? 'Warning' : 'Critical',
        recentDetections: recentDetections.length,
        config: this.config,
        lastAssessment: Date.now()
      };

      return res.json(systemHealth);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to assess system health', details: error });
    }
  }

  /**
   * Update system configuration
   */
  async updateConfiguration(req: Request, res: Response): Promise<Response> {
    try {
      const newConfig = req.body;
      
      // Validate configuration
      const validationResult = this.validateConfiguration(newConfig);
      if (!validationResult.isValid) {
        return res.status(400).json({ 
          error: 'Invalid configuration', 
          errors: validationResult.errors 
        });
      }
      
      const oldConfig = { ...this.config };
      this.config = { ...this.config, ...newConfig };
      
      const result = {
        success: true,
        oldConfig,
        newConfig: this.config,
        updatedAt: Date.now(),
        message: 'Configuration updated successfully'
      };

      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update configuration', details: error });
    }
  }

  // Private helper methods

  private analyzeRegistrationRisk(data: any): string[] {
    const flags: string[] = [];
    
    if (data.registrationData.providedStake < this.config.minimumStake) {
      flags.push('insufficient_stake');
    }
    
    if (Date.now() - data.registrationData.registrationTimestamp < 3600000) {
      flags.push('very_recent_registration');
    }
    
    // Additional risk analysis would go here
    return flags;
  }

  private async assessHardwareRisk(agentId: string): Promise<number> {
    // In production, would check against existing fingerprints
    return Math.random() * 0.3; // Mock implementation
  }

  private calculateInitialRiskScore(flags: string[], hardwareRisk: number): number {
    const flagPenalty = flags.length * 0.15;
    return Math.min(1.0, flagPenalty + hardwareRisk);
  }

  private categorizeRiskLevel(score: number): 'Low' | 'Medium' | 'High' {
    if (score >= 0.7) return 'High';
    if (score >= 0.4) return 'Medium';
    return 'Low';
  }

  private determineScreeningAction(score: number): string {
    if (score >= 0.7) return 'manual_review_required';
    if (score >= 0.4) return 'additional_verification';
    return 'automatic_approval';
  }

  private async findSimilarBehaviorAgents(agentId: string, profile: any): Promise<string[]> {
    const similar: string[] = [];
    
    for (const [otherId, otherProfile] of this.behaviorProfiles.entries()) {
      if (otherId === agentId) continue;
      
      const similarity = this.calculateBehaviorSimilarity(profile, otherProfile);
      if (similarity >= this.config.behaviorSimilarityThreshold) {
        similar.push(otherId);
      }
    }
    
    return similar;
  }

  private calculateBehaviorSimilarity(profile1: any, profile2: any): number {
    // Simplified similarity calculation
    const timeDiff = Math.abs(profile1.avgResponseTime - profile2.avgResponseTime);
    const maxTime = Math.max(profile1.avgResponseTime, profile2.avgResponseTime);
    const timeSimilarity = maxTime > 0 ? 1.0 - (timeDiff / maxTime) : 1.0;
    
    return timeSimilarity; // In production, would include all similarity factors
  }

  private async triggerAutomaticDetection(agentIds: string[]): Promise<void> {
    // Trigger background detection process
    console.log(`Automatic detection triggered for agents: ${agentIds.join(', ')}`);
  }

  private async verifyHardwareFingerprint(fingerprint: any): Promise<{ isValid: boolean; confidence: number }> {
    // Mock verification - in production would validate TEE attestations etc.
    return {
      isValid: fingerprint.cpuSignature && fingerprint.systemHash,
      confidence: 0.8
    };
  }

  private async detectHardwareSharing(agentId: string, fingerprint: any): Promise<string[]> {
    const sharedAgents: string[] = [];
    
    for (const [otherId, otherFingerprint] of this.hardwareFingerprints.entries()) {
      if (otherId === agentId) continue;
      
      const similarity = this.calculateHardwareSimilarity(fingerprint, otherFingerprint);
      if (similarity >= 0.95) {
        sharedAgents.push(otherId);
      }
    }
    
    return sharedAgents;
  }

  private calculateHardwareSimilarity(fp1: any, fp2: any): number {
    let similarity = 0;
    let factors = 0;
    
    if (fp1.cpuSignature === fp2.cpuSignature) {
      similarity += 0.4;
    }
    factors++;
    
    if (fp1.systemHash === fp2.systemHash) {
      similarity += 0.6;
    }
    factors++;
    
    return similarity;
  }

  private gatherBehaviorProfiles(agentIds: string[]): Map<string, any> {
    const profiles = new Map();
    for (const agentId of agentIds) {
      const profile = this.behaviorProfiles.get(agentId);
      if (profile) {
        profiles.set(agentId, profile);
      }
    }
    return profiles;
  }

  private gatherHardwareFingerprints(agentIds: string[]): Map<string, any> {
    const fingerprints = new Map();
    for (const agentId of agentIds) {
      const fingerprint = this.hardwareFingerprints.get(agentId);
      if (fingerprint) {
        fingerprints.set(agentId, fingerprint);
      }
    }
    return fingerprints;
  }

  private async buildNetworkGraph(agentIds: string[], timeWindow: number): Promise<any> {
    // In production, would query transaction/delegation history
    return {
      nodes: agentIds,
      edges: [],
      suspiciousClusters: []
    };
  }

  private async performDetection(
    agents: string[],
    behaviorProfiles: Map<string, any>,
    hardwareFingerprints: Map<string, any>,
    networkGraph: any,
    confidenceThreshold: number
  ): Promise<DetectionResult> {
    const detectionId = this.generateDetectionId();
    
    // Mock detection results - in production would call Scala detection engine
    const individualResults = agents.map(agentId => ({
      agentId,
      sybilProbability: Math.random() * 0.3, // Mock low probability
      componentScores: {
        behavior_similarity: Math.random() * 0.4,
        hardware_fingerprinting: Math.random() * 0.3,
        network_analysis: Math.random() * 0.2
      },
      confidence: 0.7 + Math.random() * 0.3,
      explanation: `Analysis completed for agent ${agentId}`
    }));
    
    const flaggedAgents = individualResults.filter(r => r.sybilProbability >= 0.6).length;
    const criticalThreats = individualResults.filter(r => r.sybilProbability >= 0.9).length;
    const healthScore = agents.length > 0 ? 1.0 - (flaggedAgents / agents.length) : 1.0;
    
    return {
      detectionId,
      analyzedAgents: agents,
      individualResults,
      suspiciousClusters: [],
      appliedPenalties: [],
      systemHealth: {
        overallScore: healthScore,
        totalAgentsAnalyzed: agents.length,
        flaggedAgents,
        criticalThreats,
        systemStatus: healthScore >= 0.9 ? 'Healthy' : 'Warning'
      },
      detectedAt: Date.now()
    };
  }

  private async processPenalties(detectionResult: DetectionResult): Promise<void> {
    // In production, would apply actual penalties
    console.log(`Processing penalties for detection ${detectionResult.detectionId}`);
  }

  private getActivePenalties(agentId: string): any[] {
    // In production, would query penalty database
    return [];
  }

  private getTotalReputationSlash(agentId: string): number {
    // In production, would calculate from penalty history
    return 0.0;
  }

  private getCurrentRestrictions(agentId: string): string[] {
    // In production, would check active restrictions
    return [];
  }

  private checkAppealEligibility(agentId: string): boolean {
    // In production, would check appeal history and deadlines
    return true;
  }

  private generateAppealId(): string {
    return `appeal_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  private generateDetectionId(): string {
    return `detect_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  private storeAppeal(appeal: any): void {
    // In production, would store in database
    console.log(`Appeal stored: ${appeal.appealId}`);
  }

  private validateConfiguration(config: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (config.behaviorSimilarityThreshold && (config.behaviorSimilarityThreshold < 0 || config.behaviorSimilarityThreshold > 1)) {
      errors.push('behaviorSimilarityThreshold must be between 0 and 1');
    }
    
    if (config.minimumStake && config.minimumStake < 0) {
      errors.push('minimumStake must be non-negative');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

export default new SybilDetectorService();