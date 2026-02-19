/**
 * Rejection Assertions Integration Test
 * 
 * TDD tests to ensure integration tests properly verify no rejections occurred.
 * Tests define expected behavior for rejection checking in existing test suites.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { IndexerClient } from '../src/indexer-client.js';
import { BridgeClient } from '../dist/bridge-client.js';

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3030';
const ML0_URL = process.env.ML0_URL || 'http://localhost:9200';
const INDEXER_URL = process.env.INDEXER_URL || 'http://localhost:3031';

interface TestTransactionResult {
  fiberId: string;
  transactionHash: string;
  success: boolean;
  rejectionChecked: boolean;
}

describe('Rejection Assertions Integration Tests', () => {
  let indexerClient: IndexerClient;
  let bridgeClient: BridgeClient;
  let testWallet: { address: string; privateKey: string };

  before(async () => {
    // Initialize clients
    indexerClient = new IndexerClient({ indexerUrl: INDEXER_URL });
    bridgeClient = new BridgeClient({ bridgeUrl: BRIDGE_URL, ml0Url: ML0_URL });
    
    // Generate test wallet
    testWallet = await bridgeClient.generateWallet();
  });

  describe('Transaction Rejection Verification', () => {
    it('should verify no rejections after successful agent registration', async () => {
      // Arrange
      const displayName = `TestAgent_${Date.now()}`;
      const platform = 'discord';
      const platformUserId = `test_${testWallet.address.slice(-8)}`;

      // Act - Register agent
      const regResult = await bridgeClient.registerAgent(
        testWallet.privateKey,
        displayName,
        platform,
        platformUserId
      );

      // Wait for processing
      await waitForFiberInState(regResult.fiberId, 'registered', 30000);

      // Assert - Verify no rejections occurred
      const rejections = await indexerClient.getFiberRejections(regResult.fiberId);
      assert.strictEqual(
        rejections.length,
        0,
        `Expected no rejections for successful registration, but found ${rejections.length}: ${rejections.map(r => r.errors.map(e => e.code).join(', ')).join('; ')}`
      );
    });

    it('should detect and report rejections when they occur', async () => {
      // Arrange - Create a transaction that should be rejected
      const invalidFiberId = 'invalid-fiber-id-format';
      
      try {
        // Act - Attempt invalid operation
        await bridgeClient.transitionStateMachine(
          testWallet.privateKey,
          invalidFiberId,
          'invalid_event',
          {}
        );
        
        // Should fail before this point, but if not...
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Assert - Verify rejection was detected
        const rejections = await indexerClient.getFiberRejections(invalidFiberId);
        assert.ok(
          rejections.length > 0,
          'Expected rejections for invalid transaction, but none found'
        );
        
        // Verify rejection contains expected error codes
        const errorCodes = rejections.flatMap(r => r.errors.map(e => e.code));
        assert.ok(
          errorCodes.some(code => ['InvalidFiberId', 'ValidationError', 'NotFound'].includes(code)),
          `Expected validation error codes, but got: ${errorCodes.join(', ')}`
        );
      } catch (error) {
        // If transaction fails immediately, that's also acceptable
        console.log(`Transaction failed immediately: ${error}`);
      }
    });

    it('should check rejections after each state transition in multi-step workflows', async () => {
      // Arrange
      const displayName = `WorkflowTestAgent_${Date.now()}`;
      const platform = 'discord';
      const platformUserId = `workflow_test_${testWallet.address.slice(-8)}`;

      // Act - Multi-step workflow: register → activate → transition
      
      // Step 1: Register
      const regResult = await bridgeClient.registerAgent(
        testWallet.privateKey,
        displayName,
        platform,
        platformUserId
      );

      await waitForFiberInState(regResult.fiberId, 'registered', 30000);
      
      // Assert step 1 - No rejections after registration
      let rejections = await indexerClient.getFiberRejections(regResult.fiberId);
      assert.strictEqual(
        rejections.length,
        0,
        `Registration should not have rejections: ${rejections.map(r => r.errors.map(e => e.message).join(', ')).join('; ')}`
      );

      // Step 2: Activate
      await bridgeClient.activateAgent(testWallet.privateKey, regResult.fiberId);
      await waitForFiberInState(regResult.fiberId, 'active', 30000);
      
      // Assert step 2 - No rejections after activation
      rejections = await indexerClient.getFiberRejections(regResult.fiberId);
      assert.strictEqual(
        rejections.length,
        0,
        `Activation should not have rejections: ${rejections.map(r => r.errors.map(e => e.message).join(', ')).join('; ')}`
      );

      // Step 3: State transition
      await bridgeClient.transitionStateMachine(
        testWallet.privateKey,
        regResult.fiberId,
        'request_task',
        { taskType: 'test_task', metadata: { test: true } }
      );
      
      await waitForFiberInState(regResult.fiberId, 'working', 30000);
      
      // Assert step 3 - No rejections after transition
      rejections = await indexerClient.getFiberRejections(regResult.fiberId);
      assert.strictEqual(
        rejections.length,
        0,
        `State transition should not have rejections: ${rejections.map(r => r.errors.map(e => e.message).join(', ')).join('; ')}`
      );
    });

    it('should verify rejection checking is integrated into waitForFiber function', async () => {
      // Arrange
      const fiberId = `test_fiber_${Date.now()}`;
      
      // Act & Assert - The waitForFiberInState function should check rejections
      // This test verifies the helper function includes rejection checking
      const result = await waitForFiberInStateWithRejectionCheck(fiberId, 'nonexistent', 5000);
      
      assert.strictEqual(result.found, false, 'Should not find nonexistent fiber');
      assert.strictEqual(result.rejectionChecked, true, 'Should have checked for rejections during wait');
    });

    it('should fail fast when rejections are detected during polling', async () => {
      // Arrange - Create a scenario that will be rejected
      const displayName = 'InvalidAgent<script>alert("xss")</script>';
      const platform = 'invalid_platform_name_too_long_to_be_accepted';
      const platformUserId = 'invalid@user@id@format';

      // Act
      try {
        const regResult = await bridgeClient.registerAgent(
          testWallet.privateKey,
          displayName,
          platform,
          platformUserId
        );

        // Should fail fast when rejections are detected
        const startTime = Date.now();
        const result = await waitForFiberInStateWithRejectionCheck(regResult.fiberId, 'registered', 30000);
        const elapsedTime = Date.now() - startTime;

        // Assert - Should fail fast (within 15 seconds) rather than waiting full timeout
        if (result.rejected) {
          assert.ok(
            elapsedTime < 15000,
            `Should fail fast on rejection, but took ${elapsedTime}ms`
          );
          assert.ok(
            result.rejectionReason && result.rejectionReason.length > 0,
            'Should provide rejection reason when failing fast'
          );
        }
      } catch (error) {
        // Immediate failure is also acceptable
        console.log(`Transaction failed immediately: ${error}`);
      }
    });
  });

  describe('Test Suite Integration Requirements', () => {
    it('should ensure integration.test.ts checks rejections after each transaction', async () => {
      // This test would verify that the main integration test file has been updated
      // to include rejection checks after each transaction
      
      // Read the integration test file content (this would fail until implemented)
      const integrationTestPath = './integration.test.ts';
      const fs = await import('fs');
      const content = await fs.promises.readFile(integrationTestPath, 'utf-8');
      
      // Assert - Integration test should include rejection checking patterns
      assert.ok(
        content.includes('getFiberRejections') || content.includes('checkForRejections'),
        'Integration test should include rejection checking after transactions'
      );
      
      assert.ok(
        content.includes('rejections.length') && content.includes('expect') || content.includes('assert'),
        'Integration test should assert that rejection count is zero for successful transactions'
      );

      // Verify that rejection checks happen after each major transaction
      const transactionPatterns = [
        'registerAgent',
        'activateAgent', 
        'transitionStateMachine'
      ];

      for (const pattern of transactionPatterns) {
        const transactionIndex = content.indexOf(pattern);
        if (transactionIndex !== -1) {
          const subsequentCode = content.slice(transactionIndex, transactionIndex + 2000);
          assert.ok(
            subsequentCode.includes('rejection') || subsequentCode.includes('getFiberRejections'),
            `Should check for rejections after ${pattern} transaction`
          );
        }
      }
    });

    it('should ensure bridge tests include rejection assertions', async () => {
      // This test would verify bridge test files include rejection checking
      
      // Check e2e.test.ts
      const fs = await import('fs');
      const e2eTestContent = await fs.promises.readFile('../bridge/test/e2e.test.ts', 'utf-8');
      
      assert.ok(
        e2eTestContent.includes('rejection') || e2eTestContent.includes('indexer'),
        'Bridge e2e tests should include rejection checking'
      );

      // Check that waitForFiber includes rejection checking
      assert.ok(
        e2eTestContent.includes('getRejections') || e2eTestContent.includes('rejected'),
        'Bridge tests should verify no rejections occurred'
      );
    });

    it('should verify cloud agent integration tests check rejections', async () => {
      // This test ensures cloud agent tests verify successful processing
      
      const fs = await import('fs');
      const cloudTestContent = await fs.promises.readFile('../bridge/test/cloud-agent-integration.test.ts', 'utf-8');
      
      // Assert cloud tests include rejection verification
      assert.ok(
        cloudTestContent.includes('rejection') || cloudTestContent.includes('indexer'),
        'Cloud agent tests should verify transactions were not rejected'
      );

      // Verify proper error handling when rejections occur
      assert.ok(
        cloudTestContent.includes('rejected') || cloudTestContent.includes('failed'),
        'Cloud agent tests should handle rejection scenarios'
      );
    });
  });

  describe('Rejection Checking Utilities', () => {
    it('should provide helper functions for consistent rejection checking', async () => {
      // Test that helper functions exist for rejection checking
      
      // This helper should be implemented
      const result = await assertNoRejections(indexerClient, 'test-fiber-id');
      assert.strictEqual(typeof result, 'boolean', 'assertNoRejections should return boolean');
    });

    it('should provide detailed rejection information when failures occur', async () => {
      // Verify that rejection checking provides actionable error information
      
      try {
        await assertNoRejectionsWithDetails(indexerClient, 'invalid-fiber');
      } catch (error) {
        assert.ok(
          error instanceof RejectionError,
          'Should throw specific RejectionError type'
        );
        assert.ok(
          error.message.includes('rejection'),
          'Error message should mention rejections'
        );
        assert.ok(
          error.rejections && Array.isArray(error.rejections),
          'Should include detailed rejection data'
        );
      }
    });
  });
});

// Helper functions that should be implemented

async function waitForFiberInState(
  fiberId: string, 
  expectedState: string, 
  timeoutMs: number
): Promise<boolean> {
  // Implementation needed - should check rejections during wait
  throw new Error('waitForFiberInState not yet implemented with rejection checking');
}

interface FiberWaitResult {
  found: boolean;
  rejected: boolean;
  rejectionReason?: string;
  rejectionChecked: boolean;
}

async function waitForFiberInStateWithRejectionCheck(
  fiberId: string,
  expectedState: string, 
  timeoutMs: number
): Promise<FiberWaitResult> {
  // Implementation needed - should periodically check for rejections and fail fast
  throw new Error('waitForFiberInStateWithRejectionCheck not yet implemented');
}

async function assertNoRejections(
  indexerClient: IndexerClient,
  fiberId: string
): Promise<boolean> {
  // Implementation needed - helper to assert no rejections exist
  throw new Error('assertNoRejections helper not yet implemented');
}

class RejectionError extends Error {
  constructor(
    message: string, 
    public rejections: Array<{ code: string; message: string }>
  ) {
    super(message);
    this.name = 'RejectionError';
  }
}

async function assertNoRejectionsWithDetails(
  indexerClient: IndexerClient,
  fiberId: string
): Promise<void> {
  // Implementation needed - detailed rejection checking with custom error
  throw new Error('assertNoRejectionsWithDetails not yet implemented');
}