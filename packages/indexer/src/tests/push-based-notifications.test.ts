import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BridgeNotifier } from '../bridge-notifier'; // This doesn't exist yet - TDD!
import { SnapshotProcessor } from '../snapshot-processor'; // This doesn't exist yet - TDD!
import { ML0Poller } from '../ml0-poller'; // This doesn't exist yet - TDD!

describe('Indexer Push-based Notifications', () => {
  let bridgeNotifier: BridgeNotifier;
  let snapshotProcessor: SnapshotProcessor;
  let ml0Poller: ML0Poller;

  beforeEach(() => {
    // These will fail until we implement the classes
    bridgeNotifier = new BridgeNotifier({
      bridgeUrl: 'http://localhost:8080',
      retryAttempts: 3,
      retryDelayMs: 100,
      batchSize: 10
    });
    
    snapshotProcessor = new SnapshotProcessor({
      bridgeNotifier,
      enableBatching: true,
      maxBatchSize: 50
    });
    
    ml0Poller = new ML0Poller({
      ml0Url: 'http://localhost:9000',
      pollIntervalMs: 1000,
      snapshotProcessor
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('BridgeNotifier', () => {
    it('should send confirmed transaction notification to bridge', async () => {
      const notificationData = {
        fiberId: 'fiber-123',
        event: 'create',
        status: 'confirmed' as const,
        ordinal: 12345,
        ml0Hash: '0xabc123...',
        confirmationTime: Date.now()
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, processed: true })
      });
      global.fetch = fetchSpy;

      const result = await bridgeNotifier.notifyConfirmation(notificationData);

      expect(result.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8080/internal/indexer-notify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(notificationData)
        }
      );
    });

    it('should send rejection notification to bridge', async () => {
      const rejectionData = {
        fiberId: 'fiber-reject',
        event: 'create',
        status: 'rejected' as const,
        error: 'INVALID_SIGNATURE',
        rejectionReason: 'Signature verification failed',
        rejectionTime: Date.now()
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, processed: true })
      });
      global.fetch = fetchSpy;

      const result = await bridgeNotifier.notifyRejection(rejectionData);

      expect(result.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8080/internal/indexer-notify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rejectionData)
        }
      );
    });

    it('should batch multiple notifications for efficiency', async () => {
      const notifications = [
        {
          fiberId: 'fiber-batch-1',
          event: 'create',
          status: 'confirmed' as const,
          ordinal: 12346
        },
        {
          fiberId: 'fiber-batch-2',
          event: 'update',
          status: 'confirmed' as const,
          ordinal: 12346
        },
        {
          fiberId: 'fiber-batch-3',
          event: 'create',
          status: 'rejected' as const,
          error: 'TIMEOUT'
        }
      ];

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ 
          success: true, 
          processedCount: 3,
          batchProcessed: true 
        })
      });
      global.fetch = fetchSpy;

      const result = await bridgeNotifier.notifyBatch(notifications);

      expect(result.success).toBe(true);
      expect(result.processedCount).toBe(3);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8080/internal/indexer-notify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batchNotification: true,
            notifications
          })
        }
      );
    });

    it('should retry failed notifications with exponential backoff', async () => {
      const notificationData = {
        fiberId: 'fiber-retry',
        event: 'create',
        status: 'confirmed' as const,
        ordinal: 12347
      };

      const fetchSpy = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true })
        });
      global.fetch = fetchSpy;

      const startTime = Date.now();
      const result = await bridgeNotifier.notifyConfirmation(notificationData);
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(duration).toBeGreaterThan(200); // Should have exponential backoff delays
    });

    it('should handle permanent failures gracefully', async () => {
      const notificationData = {
        fiberId: 'fiber-permanent-fail',
        event: 'create',
        status: 'confirmed' as const,
        ordinal: 12348
      };

      const fetchSpy = vi.fn().mockRejectedValue(new Error('Bridge permanently down'));
      global.fetch = fetchSpy;

      const result = await bridgeNotifier.notifyConfirmation(notificationData);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error.message).toBe('Bridge permanently down');
      expect(fetchSpy).toHaveBeenCalledTimes(3); // Should retry configured number of times
    });

    it('should handle bridge 4xx responses as non-retryable', async () => {
      const notificationData = {
        fiberId: 'fiber-400-error',
        event: 'create',
        status: 'confirmed' as const,
        ordinal: 12349
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ 
          error: 'Invalid notification format',
          details: 'Missing required field: ordinal'
        })
      });
      global.fetch = fetchSpy;

      const result = await bridgeNotifier.notifyConfirmation(notificationData);

      expect(result.success).toBe(false);
      expect(result.error.message).toContain('Invalid notification format');
      expect(fetchSpy).toHaveBeenCalledTimes(1); // Should not retry 4xx errors
    });

    it('should track notification metrics', async () => {
      const notifications = [
        { fiberId: 'f1', event: 'create', status: 'confirmed' as const, ordinal: 1 },
        { fiberId: 'f2', event: 'create', status: 'confirmed' as const, ordinal: 2 }
      ];

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });
      global.fetch = fetchSpy;

      await bridgeNotifier.notifyConfirmation(notifications[0]);
      await bridgeNotifier.notifyConfirmation(notifications[1]);

      const metrics = await bridgeNotifier.getMetrics();

      expect(metrics.totalNotifications).toBe(2);
      expect(metrics.successfulNotifications).toBe(2);
      expect(metrics.failedNotifications).toBe(0);
      expect(metrics.averageLatencyMs).toBeTypeOf('number');
      expect(metrics.retryRate).toBe(0);
    });
  });

  describe('SnapshotProcessor', () => {
    it('should extract fiber confirmations from ML0 snapshot', async () => {
      const ml0Snapshot = {
        ordinal: 12350,
        timestamp: Date.now(),
        hash: '0xsnapshot123...',
        transactions: [
          {
            fiberId: 'fiber-extract-1',
            event: 'create',
            status: 'accepted',
            stateHash: '0xstate1...'
          },
          {
            fiberId: 'fiber-extract-2',
            event: 'update',
            status: 'accepted',
            stateHash: '0xstate2...'
          }
        ]
      };

      const notificationSpy = vi.spyOn(bridgeNotifier, 'notifyBatch').mockResolvedValue({
        success: true,
        processedCount: 2
      });

      await snapshotProcessor.processSnapshot(ml0Snapshot);

      expect(notificationSpy).toHaveBeenCalledWith([
        {
          fiberId: 'fiber-extract-1',
          event: 'create',
          status: 'confirmed',
          ordinal: 12350,
          ml0Hash: '0xsnapshot123...',
          confirmationTime: expect.any(Number)
        },
        {
          fiberId: 'fiber-extract-2',
          event: 'update',
          status: 'confirmed',
          ordinal: 12350,
          ml0Hash: '0xsnapshot123...',
          confirmationTime: expect.any(Number)
        }
      ]);
    });

    it('should extract fiber rejections from ML0 snapshot', async () => {
      const ml0Snapshot = {
        ordinal: 12351,
        timestamp: Date.now(),
        hash: '0xsnapshot124...',
        rejectedTransactions: [
          {
            fiberId: 'fiber-rejected-1',
            event: 'create',
            rejectionReason: 'INVALID_STATE_TRANSITION',
            details: 'Cannot transition from ACTIVE to PENDING'
          },
          {
            fiberId: 'fiber-rejected-2',
            event: 'update',
            rejectionReason: 'SIGNATURE_INVALID',
            details: 'Invalid signature for updater'
          }
        ]
      };

      const notificationSpy = vi.spyOn(bridgeNotifier, 'notifyBatch').mockResolvedValue({
        success: true,
        processedCount: 2
      });

      await snapshotProcessor.processSnapshot(ml0Snapshot);

      expect(notificationSpy).toHaveBeenCalledWith([
        {
          fiberId: 'fiber-rejected-1',
          event: 'create',
          status: 'rejected',
          error: 'INVALID_STATE_TRANSITION',
          rejectionReason: 'Cannot transition from ACTIVE to PENDING',
          rejectionTime: expect.any(Number)
        },
        {
          fiberId: 'fiber-rejected-2',
          event: 'update',
          status: 'rejected',
          error: 'SIGNATURE_INVALID',
          rejectionReason: 'Invalid signature for updater',
          rejectionTime: expect.any(Number)
        }
      ]);
    });

    it('should handle mixed confirmed and rejected transactions', async () => {
      const ml0Snapshot = {
        ordinal: 12352,
        timestamp: Date.now(),
        hash: '0xsnapshot125...',
        transactions: [
          { fiberId: 'fiber-confirmed', event: 'create', status: 'accepted' }
        ],
        rejectedTransactions: [
          { fiberId: 'fiber-rejected', event: 'create', rejectionReason: 'TIMEOUT' }
        ]
      };

      const notificationSpy = vi.spyOn(bridgeNotifier, 'notifyBatch').mockResolvedValue({
        success: true,
        processedCount: 2
      });

      await snapshotProcessor.processSnapshot(ml0Snapshot);

      expect(notificationSpy).toHaveBeenCalledWith([
        {
          fiberId: 'fiber-confirmed',
          event: 'create',
          status: 'confirmed',
          ordinal: 12352,
          ml0Hash: '0xsnapshot125...',
          confirmationTime: expect.any(Number)
        },
        {
          fiberId: 'fiber-rejected',
          event: 'create',
          status: 'rejected',
          error: 'TIMEOUT',
          rejectionReason: 'TIMEOUT',
          rejectionTime: expect.any(Number)
        }
      ]);
    });

    it('should filter out duplicate notifications within same snapshot', async () => {
      const ml0Snapshot = {
        ordinal: 12353,
        timestamp: Date.now(),
        hash: '0xsnapshot126...',
        transactions: [
          { fiberId: 'fiber-duplicate', event: 'create', status: 'accepted' },
          { fiberId: 'fiber-duplicate', event: 'create', status: 'accepted' }, // Duplicate
          { fiberId: 'fiber-unique', event: 'update', status: 'accepted' }
        ]
      };

      const notificationSpy = vi.spyOn(bridgeNotifier, 'notifyBatch').mockResolvedValue({
        success: true,
        processedCount: 2
      });

      await snapshotProcessor.processSnapshot(ml0Snapshot);

      expect(notificationSpy).toHaveBeenCalledWith([
        {
          fiberId: 'fiber-duplicate',
          event: 'create',
          status: 'confirmed',
          ordinal: 12353,
          ml0Hash: '0xsnapshot126...',
          confirmationTime: expect.any(Number)
        },
        {
          fiberId: 'fiber-unique',
          event: 'update',
          status: 'confirmed',
          ordinal: 12353,
          ml0Hash: '0xsnapshot126...',
          confirmationTime: expect.any(Number)
        }
      ]);
    });

    it('should track processing metrics', async () => {
      const ml0Snapshot = {
        ordinal: 12354,
        timestamp: Date.now(),
        hash: '0xsnapshot127...',
        transactions: [
          { fiberId: 'f1', event: 'create', status: 'accepted' },
          { fiberId: 'f2', event: 'create', status: 'accepted' }
        ]
      };

      vi.spyOn(bridgeNotifier, 'notifyBatch').mockResolvedValue({
        success: true,
        processedCount: 2
      });

      await snapshotProcessor.processSnapshot(ml0Snapshot);

      const metrics = await snapshotProcessor.getMetrics();

      expect(metrics.totalSnapshotsProcessed).toBe(1);
      expect(metrics.totalNotificationsSent).toBe(2);
      expect(metrics.averageProcessingTimeMs).toBeTypeOf('number');
      expect(metrics.lastProcessedOrdinal).toBe(12354);
    });

    it('should handle empty snapshots gracefully', async () => {
      const emptySnapshot = {
        ordinal: 12355,
        timestamp: Date.now(),
        hash: '0xempty...',
        transactions: [],
        rejectedTransactions: []
      };

      const notificationSpy = vi.spyOn(bridgeNotifier, 'notifyBatch');

      await snapshotProcessor.processSnapshot(emptySnapshot);

      expect(notificationSpy).not.toHaveBeenCalled();
    });
  });

  describe('ML0Poller', () => {
    it('should poll ML0 for new snapshots periodically', async () => {
      const mockSnapshot = {
        ordinal: 12356,
        timestamp: Date.now(),
        hash: '0xpolled...',
        transactions: [
          { fiberId: 'fiber-polled', event: 'create', status: 'accepted' }
        ]
      };

      const fetchSpy = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ snapshots: [mockSnapshot] })
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ snapshots: [] }) // No new snapshots
        });
      global.fetch = fetchSpy;

      const processingSpy = vi.spyOn(snapshotProcessor, 'processSnapshot').mockResolvedValue();

      // Start polling
      ml0Poller.start();

      // Wait for at least one poll cycle
      await new Promise(resolve => setTimeout(resolve, 1200));

      ml0Poller.stop();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:9000/snapshots/latest',
        { method: 'GET' }
      );
      expect(processingSpy).toHaveBeenCalledWith(mockSnapshot);
    });

    it('should track last processed ordinal to avoid reprocessing', async () => {
      const snapshots = [
        { ordinal: 100, hash: '0x100', transactions: [] },
        { ordinal: 101, hash: '0x101', transactions: [] },
        { ordinal: 102, hash: '0x102', transactions: [] }
      ];

      const fetchSpy = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ snapshots: snapshots.slice(0, 2) }) // First 2
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ snapshots: [snapshots[2]] }) // Just the 3rd
        });
      global.fetch = fetchSpy;

      const processingSpy = vi.spyOn(snapshotProcessor, 'processSnapshot').mockResolvedValue();

      ml0Poller.start();
      await new Promise(resolve => setTimeout(resolve, 1200));
      ml0Poller.stop();

      expect(processingSpy).toHaveBeenCalledTimes(3);
      expect(processingSpy).toHaveBeenNthCalledWith(1, snapshots[0]);
      expect(processingSpy).toHaveBeenNthCalledWith(2, snapshots[1]);
      expect(processingSpy).toHaveBeenNthCalledWith(3, snapshots[2]);
    });

    it('should handle ML0 polling errors gracefully', async () => {
      const fetchSpy = vi.fn()
        .mockRejectedValueOnce(new Error('ML0 connection failed'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ snapshots: [] })
        });
      global.fetch = fetchSpy;

      const errorSpy = vi.fn();
      ml0Poller.onError(errorSpy);

      ml0Poller.start();
      await new Promise(resolve => setTimeout(resolve, 1200));
      ml0Poller.stop();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          message: expect.stringContaining('ML0 connection failed')
        })
      );
    });

    it('should provide polling status and metrics', async () => {
      const status = ml0Poller.getStatus();

      expect(status.isRunning).toBe(false);
      expect(status.lastPollTime).toBeNull();
      expect(status.pollCount).toBe(0);
      expect(status.errorCount).toBe(0);

      ml0Poller.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      const runningStatus = ml0Poller.getStatus();
      expect(runningStatus.isRunning).toBe(true);

      ml0Poller.stop();
    });

    it('should support configurable poll intervals', async () => {
      const fastPoller = new ML0Poller({
        ml0Url: 'http://localhost:9000',
        pollIntervalMs: 500, // Fast polling
        snapshotProcessor
      });

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ snapshots: [] })
      });
      global.fetch = fetchSpy;

      fastPoller.start();
      await new Promise(resolve => setTimeout(resolve, 1200));
      fastPoller.stop();

      // Should have polled at least twice in 1200ms with 500ms interval
      expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('End-to-End Integration', () => {
    it('should complete full indexer notification flow', async () => {
      const ml0Snapshot = {
        ordinal: 12360,
        timestamp: Date.now(),
        hash: '0xe2e...',
        transactions: [
          { fiberId: 'fiber-e2e-indexer', event: 'create', status: 'accepted' }
        ]
      };

      // Mock bridge notification endpoint
      const bridgeFetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, processed: true })
      });

      // Mock ML0 polling
      const ml0FetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ snapshots: [ml0Snapshot] })
      });

      global.fetch = vi.fn((url) => {
        if (url.includes('internal/indexer-notify')) {
          return bridgeFetchSpy(url);
        } else if (url.includes('snapshots/latest')) {
          return ml0FetchSpy(url);
        }
        return Promise.reject(new Error('Unexpected fetch URL'));
      });

      // Start the indexer
      ml0Poller.start();

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 1200));

      ml0Poller.stop();

      // Verify ML0 was polled
      expect(ml0FetchSpy).toHaveBeenCalled();

      // Verify bridge notification was sent
      expect(bridgeFetchSpy).toHaveBeenCalledWith('http://localhost:8080/internal/indexer-notify');
    });

    it('should handle high-throughput snapshot processing', async () => {
      const largeSnapshot = {
        ordinal: 12361,
        timestamp: Date.now(),
        hash: '0xbig...',
        transactions: Array.from({ length: 100 }, (_, i) => ({
          fiberId: `high-throughput-fiber-${i}`,
          event: 'create',
          status: 'accepted'
        }))
      };

      const bridgeFetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ 
          success: true, 
          processedCount: 100,
          batchProcessed: true 
        })
      });
      global.fetch = bridgeFetchSpy;

      const startTime = Date.now();
      await snapshotProcessor.processSnapshot(largeSnapshot);
      const processingTime = Date.now() - startTime;

      expect(bridgeFetchSpy).toHaveBeenCalledWith(
        'http://localhost:8080/internal/indexer-notify',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('batchNotification')
        })
      );

      // Should process 100 transactions efficiently
      expect(processingTime).toBeLessThan(1000);
    });

    it('should maintain system health during notification failures', async () => {
      const snapshot = {
        ordinal: 12362,
        timestamp: Date.now(),
        hash: '0xhealth...',
        transactions: [
          { fiberId: 'fiber-health-test', event: 'create', status: 'accepted' }
        ]
      };

      // Simulate bridge failures
      const bridgeFetchSpy = vi.fn().mockRejectedValue(new Error('Bridge down'));
      global.fetch = bridgeFetchSpy;

      // Should not throw despite bridge failures
      await expect(snapshotProcessor.processSnapshot(snapshot)).resolves.not.toThrow();

      // System should track failed notifications
      const metrics = await snapshotProcessor.getMetrics();
      expect(metrics.failedNotifications).toBeGreaterThan(0);

      const bridgeMetrics = await bridgeNotifier.getMetrics();
      expect(bridgeMetrics.failedNotifications).toBeGreaterThan(0);
    });
  });
});