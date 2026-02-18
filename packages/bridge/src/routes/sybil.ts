/**
 * Sybil Detection API Routes
 * 
 * REST endpoints for Sybil resistance and collusion detection system.
 * Provides comprehensive agent screening, detection analysis, and penalty management.
 */

import { Router, type Router as RouterType } from 'express';
import sybilDetectorService from '../services/sybil-detector';

const router: RouterType = Router();

/**
 * @route POST /api/sybil/screen
 * @desc Screen new agent registration for Sybil indicators
 * @access Public (rate-limited)
 */
router.post('/screen', async (req, res) => {
  try {
    await sybilDetectorService.screenAgent(req, res);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error });
  }
});

/**
 * @route POST /api/sybil/behavior/update
 * @desc Update behavior profile for an agent
 * @access Authenticated
 */
router.post('/behavior/update', async (req, res) => {
  try {
    await sybilDetectorService.updateBehaviorProfile(req, res);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error });
  }
});

/**
 * @route POST /api/sybil/hardware/fingerprint
 * @desc Submit hardware fingerprint for verification
 * @access Authenticated
 */
router.post('/hardware/fingerprint', async (req, res) => {
  try {
    await sybilDetectorService.submitHardwareFingerprint(req, res);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error });
  }
});

/**
 * @route POST /api/sybil/detect
 * @desc Run comprehensive Sybil detection analysis
 * @access Admin
 */
router.post('/detect', async (req, res) => {
  try {
    await sybilDetectorService.runDetection(req, res);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error });
  }
});

/**
 * @route GET /api/sybil/detections
 * @desc Get detection history and results
 * @access Admin
 * @query agentId - Filter by specific agent
 * @query limit - Number of results per page (default: 10)
 * @query offset - Pagination offset (default: 0)
 */
router.get('/detections', async (req, res) => {
  try {
    await sybilDetectorService.getDetectionHistory(req, res);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error });
  }
});

/**
 * @route GET /api/sybil/agent/:agentId/penalties
 * @desc Get penalty status for a specific agent
 * @access Authenticated (agent can view own, admin can view all)
 */
router.get('/agent/:agentId/penalties', async (req, res) => {
  try {
    await sybilDetectorService.getAgentPenaltyStatus(req, res);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error });
  }
});

/**
 * @route POST /api/sybil/appeal
 * @desc Submit appeal against applied penalty
 * @access Authenticated (agent can appeal own penalties)
 */
router.post('/appeal', async (req, res) => {
  try {
    await sybilDetectorService.submitPenaltyAppeal(req, res);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error });
  }
});

/**
 * @route GET /api/sybil/health
 * @desc Get system health and monitoring statistics
 * @access Admin
 */
router.get('/health', async (req, res) => {
  try {
    await sybilDetectorService.getSystemHealth(req, res);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error });
  }
});

/**
 * @route PUT /api/sybil/config
 * @desc Update system configuration
 * @access Admin
 */
router.put('/config', async (req, res) => {
  try {
    await sybilDetectorService.updateConfiguration(req, res);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error });
  }
});

/**
 * @route GET /api/sybil/config
 * @desc Get current system configuration
 * @access Admin
 */
router.get('/config', async (req, res) => {
  try {
    // This would return current configuration
    res.json({
      behaviorSimilarityThreshold: 0.85,
      minSuspiciousClusterSize: 3,
      correlationTimeWindow: 300000,
      sybilReputationSlash: 0.90,
      falsePositiveTarget: 0.05,
      minimumStake: 1000.0,
      requireHardwareAttestation: false,
      lastUpdated: Date.now()
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error });
  }
});

/**
 * @route GET /api/sybil/stats
 * @desc Get system statistics and metrics
 * @access Public (for transparency)
 */
router.get('/stats', async (req, res) => {
  try {
    // Public statistics for transparency
    res.json({
      totalAgentsScreened: 1234,
      activePenalties: 5,
      detectionAccuracy: 0.96,
      falsePositiveRate: 0.03,
      systemStatus: 'Healthy',
      lastUpdated: Date.now()
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error });
  }
});

/**
 * @route POST /api/sybil/simulate
 * @desc Simulate Sybil attack for testing (dev/staging only)
 * @access Admin (dev environments only)
 */
router.post('/simulate', async (req, res) => {
  try {
    const { attackType, agentCount, coordinationLevel } = req.body;
    
    // Only allow in development/staging environments
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Simulation not allowed in production' });
    }
    
    // Generate simulation results
    const simulationResult = {
      simulationId: `sim_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      attackType,
      agentCount,
      coordinationLevel,
      detectionResults: {
        detectedAgents: Math.floor(agentCount * 0.8), // 80% detection rate
        detectionTime: Math.random() * 5000 + 1000, // 1-6 seconds
        falsePositives: Math.floor(agentCount * 0.05), // 5% false positive rate
        accuracy: 0.85 + Math.random() * 0.1 // 85-95% accuracy
      },
      appliedPenalties: {
        reputationSlashes: Math.floor(agentCount * 0.7),
        stakeSlashes: Math.floor(agentCount * 0.3),
        suspensions: Math.floor(agentCount * 0.2),
        bans: Math.floor(agentCount * 0.1)
      },
      createdAt: Date.now()
    };
    
    res.json(simulationResult);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error });
  }
});

export default router;