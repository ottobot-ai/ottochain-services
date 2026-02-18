/**
 * Mobile Application Integration Tests (Phase 4)
 * 
 * TDD tests for native iOS/Android features including voice integration,
 * camera features, push notifications, and offline mode capabilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MobileApiService } from '../mobile-api-service.js';
import { VoiceIntegrationService } from '../voice-integration.js';
import { CameraService } from '../camera-service.js';
import { PushNotificationService } from '../push-notifications.js';
import { OfflineModeManager } from '../offline-mode-manager.js';
import { TaskSyncManager } from '../task-sync-manager.js';

describe('Mobile Application Integration', () => {
  let mobileApi: MobileApiService;
  let voiceService: VoiceIntegrationService;
  let cameraService: CameraService;
  let pushService: PushNotificationService;
  let offlineManager: OfflineModeManager;
  let syncManager: TaskSyncManager;

  beforeEach(() => {
    voiceService = new VoiceIntegrationService({
      speechToTextProvider: 'azure',
      textToSpeechProvider: 'elevenlabs',
      voiceCommands: true
    });
    
    cameraService = new CameraService({
      documentScanning: true,
      whiteboardCapture: true,
      ocrEnabled: true,
      imageCompression: 0.8
    });
    
    pushService = new PushNotificationService({
      provider: 'fcm',
      categories: ['task-updates', 'reputation-changes', 'system-alerts']
    });
    
    offlineManager = new OfflineModeManager({
      maxQueuedTasks: 100,
      syncRetryInterval: 30000,
      compressionEnabled: true
    });
    
    syncManager = new TaskSyncManager();
    
    mobileApi = new MobileApiService({
      voiceService,
      cameraService,
      pushService,
      offlineManager,
      syncManager
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Voice Integration', () => {
    it('should convert speech to task specification accurately', async () => {
      const speechInput = {
        audioBuffer: new ArrayBuffer(1024),
        format: 'wav',
        sampleRate: 16000,
        duration: 5.2
      };

      const result = await voiceService.speechToTask(speechInput);

      expect(result.confidence).toBeGreaterThan(0.85);
      expect(result.taskSpecification).toHaveProperty('title');
      expect(result.taskSpecification).toHaveProperty('description');
      expect(result.taskSpecification).toHaveProperty('priority');
      expect(result.taskSpecification).toHaveProperty('estimatedAgent');
    });

    it('should handle voice commands for task management', async () => {
      const voiceCommands = [
        { command: 'show my active tasks', expectedAction: 'list-tasks', filter: 'active' },
        { command: 'cancel task number 3', expectedAction: 'cancel-task', taskId: '3' },
        { command: 'set high priority for task marketplace analysis', expectedAction: 'set-priority', priority: 'high' },
        { command: 'delegate research task to agent research', expectedAction: 'delegate', agent: '@research' }
      ];

      for (const { command, expectedAction, ...expectedParams } of voiceCommands) {
        const result = await voiceService.parseVoiceCommand(command);
        
        expect(result.action).toBe(expectedAction);
        Object.entries(expectedParams).forEach(([key, value]) => {
          expect(result.parameters[key]).toBe(value);
        });
      }
    });

    it('should provide voice feedback for task completion', async () => {
      const taskUpdate = {
        taskId: 'task-123',
        status: 'completed',
        result: {
          summary: 'Market analysis completed successfully',
          confidence: 0.92,
          agent: '@research'
        }
      };

      const voiceFeedback = await voiceService.generateTaskUpdateFeedback(taskUpdate);

      expect(voiceFeedback.audioBuffer).toBeInstanceOf(ArrayBuffer);
      expect(voiceFeedback.duration).toBeGreaterThan(0);
      expect(voiceFeedback.transcript).toContain('Market analysis completed');
      expect(voiceFeedback.transcript).toContain('research agent');
    });

    it('should handle multiple languages and accents', async () => {
      const multiLanguageTests = [
        { language: 'en-US', accent: 'southern', text: 'Create a new task for fixin\' the server' },
        { language: 'en-GB', accent: 'london', text: 'Schedule a meeting with the brilliant team' },
        { language: 'es-US', accent: 'mexican', text: 'Crear una tarea para el análisis de mercado' }
      ];

      for (const test of multiLanguageTests) {
        const result = await voiceService.speechToTask({
          audioBuffer: new ArrayBuffer(2048),
          language: test.language,
          accent: test.accent
        });

        expect(result.detectedLanguage).toBe(test.language);
        expect(result.confidence).toBeGreaterThan(0.7);
        expect(result.taskSpecification).toBeDefined();
      }
    });
  });

  describe('Camera Integration', () => {
    it('should scan documents and extract text accurately', async () => {
      const documentImage = {
        imageData: new ArrayBuffer(50000), // Simulated image data
        width: 1920,
        height: 1080,
        format: 'jpeg'
      };

      const scanResult = await cameraService.scanDocument(documentImage);

      expect(scanResult.extractedText).toBeDefined();
      expect(scanResult.extractedText.length).toBeGreaterThan(0);
      expect(scanResult.confidence).toBeGreaterThan(0.8);
      expect(scanResult.documentType).toBeOneOf(['contract', 'invoice', 'report', 'memo', 'other']);
      expect(scanResult.correctedImage).toBeInstanceOf(ArrayBuffer);
    });

    it('should capture whiteboard content and convert to structured data', async () => {
      const whiteboardImage = {
        imageData: new ArrayBuffer(75000),
        width: 2560,
        height: 1440,
        format: 'jpeg',
        metadata: { captureMode: 'whiteboard', autoCorrection: true }
      };

      const captureResult = await cameraService.captureWhiteboard(whiteboardImage);

      expect(captureResult.structuredData).toHaveProperty('diagrams');
      expect(captureResult.structuredData).toHaveProperty('textBlocks');
      expect(captureResult.structuredData).toHaveProperty('annotations');
      expect(captureResult.enhancedImage).toBeInstanceOf(ArrayBuffer);
      expect(captureResult.extractedElements.length).toBeGreaterThan(0);
    });

    it('should enable visual task input through image analysis', async () => {
      const taskImage = {
        imageData: new ArrayBuffer(40000),
        width: 1080,
        height: 1920,
        format: 'jpeg',
        context: 'task-creation'
      };

      const visualTaskResult = await cameraService.analyzeTaskImage(taskImage);

      expect(visualTaskResult.suggestedTask).toHaveProperty('title');
      expect(visualTaskResult.suggestedTask).toHaveProperty('description');
      expect(visualTaskResult.suggestedTask).toHaveProperty('category');
      expect(visualTaskResult.suggestedTask.estimatedAgent).toMatch(/^@(main|work|research|code|think)$/);
      expect(visualTaskResult.confidence).toBeGreaterThan(0.6);
    });

    it('should handle poor lighting and image quality gracefully', async () => {
      const poorQualityImages = [
        { scenario: 'low-light', brightness: 0.1, noise: 0.8 },
        { scenario: 'motion-blur', sharpness: 0.2, blur: 0.9 },
        { scenario: 'bad-angle', perspective: 45, distortion: 0.7 }
      ];

      for (const { scenario, ...qualityMetrics } of poorQualityImages) {
        const testImage = {
          imageData: new ArrayBuffer(30000),
          width: 1080,
          height: 720,
          format: 'jpeg',
          qualityMetrics
        };

        const result = await cameraService.enhanceAndAnalyze(testImage);

        expect(result.enhancement.applied).toBe(true);
        expect(result.enhancement.improvements).toContain(scenario);
        expect(result.confidence).toBeGreaterThan(0.4); // Lower threshold for poor quality
      }
    });
  });

  describe('Push Notifications', () => {
    it('should send real-time task completion notifications', async () => {
      const taskCompletion = {
        userId: 'user-123',
        taskId: 'task-456',
        taskTitle: 'Market Research Analysis',
        completedBy: '@research',
        completionTime: new Date(),
        result: {
          summary: 'Comprehensive market analysis completed',
          attachments: 2,
          confidence: 0.94
        }
      };

      const notification = await pushService.sendTaskCompletionNotification(taskCompletion);

      expect(notification.sent).toBe(true);
      expect(notification.messageId).toBeDefined();
      expect(notification.payload.title).toContain('Task Complete');
      expect(notification.payload.body).toContain('Market Research Analysis');
      expect(notification.payload.category).toBe('task-updates');
      expect(notification.payload.actions).toHaveLength(2); // View Results, Mark Reviewed
    });

    it('should notify about reputation changes', async () => {
      const reputationChange = {
        userId: 'user-789',
        previousScore: 85.2,
        newScore: 88.7,
        change: +3.5,
        reason: 'Successful task completion with high quality rating',
        milestone: 'Trusted Delegator'
      };

      const notification = await pushService.sendReputationNotification(reputationChange);

      expect(notification.sent).toBe(true);
      expect(notification.payload.title).toBe('Reputation Updated');
      expect(notification.payload.body).toContain('+3.5 points');
      expect(notification.payload.body).toContain('Trusted Delegator');
      expect(notification.payload.category).toBe('reputation-changes');
    });

    it('should handle notification preferences and quiet hours', async () => {
      const userPreferences = {
        userId: 'user-456',
        quietHours: { start: '22:00', end: '08:00', timezone: 'America/New_York' },
        categories: {
          'task-updates': { enabled: true, priority: 'high' },
          'reputation-changes': { enabled: true, priority: 'normal' },
          'system-alerts': { enabled: false, priority: 'low' }
        }
      };

      await pushService.updateUserPreferences(userPreferences);

      // Test during quiet hours
      const quietHourNotification = {
        userId: 'user-456',
        category: 'task-updates',
        priority: 'normal',
        scheduledTime: new Date('2026-02-19T23:30:00-05:00') // 11:30 PM EST
      };

      const result = await pushService.scheduleNotification(quietHourNotification);

      expect(result.deferred).toBe(true);
      expect(result.scheduledFor.getHours()).toBe(8); // Deferred to 8 AM
    });

    it('should batch and summarize low-priority notifications', async () => {
      const lowPriorityUpdates = Array.from({ length: 15 }, (_, i) => ({
        userId: 'user-batch-test',
        category: 'system-alerts',
        priority: 'low',
        message: `System maintenance update ${i + 1}`,
        timestamp: new Date(Date.now() + i * 60000) // 1 minute apart
      }));

      for (const update of lowPriorityUpdates) {
        await pushService.queueNotification(update);
      }

      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 5000));

      const batchNotification = await pushService.getLastBatchNotification('user-batch-test');

      expect(batchNotification.type).toBe('batch-summary');
      expect(batchNotification.payload.title).toContain('15 Updates');
      expect(batchNotification.payload.summary).toContain('system maintenance');
    });
  });

  describe('Offline Mode', () => {
    it('should queue tasks when network is unavailable', async () => {
      // Simulate network disconnection
      vi.spyOn(offlineManager, 'isOnline').mockReturnValue(false);

      const offlineTask = {
        id: 'offline-task-1',
        title: 'Analyze data when online',
        description: 'This task was created while offline',
        priority: 'medium',
        agent: '@research'
      };

      const queueResult = await mobileApi.createTask(offlineTask);

      expect(queueResult.queued).toBe(true);
      expect(queueResult.syncWhenOnline).toBe(true);
      expect(offlineManager.getQueueLength()).toBe(1);
    });

    it('should sync queued tasks when connectivity is restored', async () => {
      // Start offline with queued tasks
      vi.spyOn(offlineManager, 'isOnline').mockReturnValue(false);
      
      await mobileApi.createTask({ id: 'task-1', title: 'Task 1' });
      await mobileApi.createTask({ id: 'task-2', title: 'Task 2' });
      await mobileApi.createTask({ id: 'task-3', title: 'Task 3' });

      expect(offlineManager.getQueueLength()).toBe(3);

      // Simulate connectivity restoration
      vi.spyOn(offlineManager, 'isOnline').mockReturnValue(true);
      
      const syncResult = await offlineManager.syncQueuedTasks();

      expect(syncResult.synced).toBe(3);
      expect(syncResult.failed).toBe(0);
      expect(offlineManager.getQueueLength()).toBe(0);
      expect(syncResult.conflicts).toHaveLength(0);
    });

    it('should handle sync conflicts intelligently', async () => {
      const conflictingTask = {
        id: 'task-conflict',
        title: 'Original Title',
        lastModified: new Date('2026-02-18T10:00:00Z')
      };

      // Task modified offline
      const offlineVersion = {
        ...conflictingTask,
        title: 'Modified Offline',
        description: 'Added description offline',
        lastModified: new Date('2026-02-18T11:00:00Z')
      };

      // Same task modified on server
      const serverVersion = {
        ...conflictingTask,
        title: 'Modified on Server',
        priority: 'high',
        lastModified: new Date('2026-02-18T11:30:00Z')
      };

      vi.spyOn(syncManager, 'getServerVersion').mockResolvedValue(serverVersion);

      const conflictResolution = await offlineManager.resolveConflict(
        offlineVersion,
        serverVersion
      );

      expect(conflictResolution.strategy).toBe('merge');
      expect(conflictResolution.mergedVersion.title).toBe('Modified on Server'); // Server wins for conflicts
      expect(conflictResolution.mergedVersion.description).toBe('Added description offline'); // Offline addition preserved
      expect(conflictResolution.mergedVersion.priority).toBe('high'); // Server addition preserved
    });

    it('should compress data to optimize storage in offline mode', async () => {
      const largeTaskData = {
        id: 'large-task',
        title: 'Large Task with Attachments',
        attachments: Array.from({ length: 10 }, (_, i) => ({
          id: `attachment-${i}`,
          data: new ArrayBuffer(100000), // 100KB each
          type: 'image/jpeg'
        }))
      };

      const storedSize = await offlineManager.storeTask(largeTaskData);
      const compressionRatio = storedSize / (1000000 + JSON.stringify(largeTaskData).length);

      expect(compressionRatio).toBeLessThan(0.3); // Should compress to less than 30%
      expect(offlineManager.getStorageUsage()).toBeLessThan(500000); // Under 500KB stored
    });
  });

  describe('Cross-Platform Compatibility', () => {
    it('should handle iOS-specific features correctly', async () => {
      const iosContext = {
        platform: 'ios',
        version: '17.2',
        device: 'iPhone15Pro',
        features: ['haptic-feedback', 'face-id', 'siri-shortcuts']
      };

      const iosIntegration = await mobileApi.initializePlatform(iosContext);

      expect(iosIntegration.hapticFeedback.enabled).toBe(true);
      expect(iosIntegration.biometricAuth.type).toBe('face-id');
      expect(iosIntegration.voiceAssistant.shortcuts).toHaveLength(5);
      expect(iosIntegration.notifications.provider).toBe('apns');
    });

    it('should handle Android-specific features correctly', async () => {
      const androidContext = {
        platform: 'android',
        version: '14',
        device: 'Pixel8Pro',
        features: ['adaptive-brightness', 'fingerprint', 'google-assistant']
      };

      const androidIntegration = await mobileApi.initializePlatform(androidContext);

      expect(androidIntegration.adaptiveUI.enabled).toBe(true);
      expect(androidIntegration.biometricAuth.type).toBe('fingerprint');
      expect(androidIntegration.voiceAssistant.provider).toBe('google-assistant');
      expect(androidIntegration.notifications.provider).toBe('fcm');
    });

    it('should maintain feature parity across platforms', async () => {
      const coreFeatures = [
        'voice-commands',
        'camera-scanning',
        'push-notifications',
        'offline-sync',
        'biometric-auth'
      ];

      const iosFeatures = await mobileApi.getSupportedFeatures({ platform: 'ios' });
      const androidFeatures = await mobileApi.getSupportedFeatures({ platform: 'android' });

      for (const feature of coreFeatures) {
        expect(iosFeatures.includes(feature)).toBe(true);
        expect(androidFeatures.includes(feature)).toBe(true);
      }
    });
  });
});