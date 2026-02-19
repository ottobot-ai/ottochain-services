/**
 * Integration Test Enhancement Validation
 * 
 * TDD tests to validate that the existing integration.test.ts has been properly
 * enhanced with rejection checking after each transaction.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'fs/promises';
import { join } from 'path';

describe('Integration Test Enhancement Validation', () => {
  describe('Code Analysis Tests', () => {
    it('should verify integration.test.ts includes rejection API imports', async () => {
      // Read the integration test file
      const testFilePath = join(__dirname, 'integration.test.ts');
      const content = await readFile(testFilePath, 'utf-8');
      
      // Should import IndexerClient for rejection checking
      assert.ok(
        content.includes('IndexerClient') || content.includes('indexer-client'),
        'Integration test should import IndexerClient for rejection checking'
      );
      
      // Should have indexer configuration
      assert.ok(
        content.includes('INDEXER_URL') || content.includes('indexerUrl'),
        'Integration test should configure indexer URL for rejection API'
      );
    });

    it('should verify checkForRejections function is enhanced with proper assertions', async () => {
      // Read the integration test file
      const testFilePath = join(__dirname, 'integration.test.ts');
      const content = await readFile(testFilePath, 'utf-8');
      
      // Find the checkForRejections function
      const checkForRejectionsMatch = content.match(
        /async function checkForRejections\([\s\S]*?\n\}/m
      );
      
      assert.ok(
        checkForRejectionsMatch,
        'checkForRejections function should exist in integration test'
      );
      
      const functionBody = checkForRejectionsMatch[0];
      
      // Should make proper API call to indexer
      assert.ok(
        functionBody.includes('/fibers/') && functionBody.includes('/rejections'),
        'checkForRejections should call proper indexer rejection API endpoint'
      );
      
      // Should return structured rejection data
      assert.ok(
        functionBody.includes('rejected') && functionBody.includes('reason'),
        'checkForRejections should return rejection status and reason'
      );
    });

    it('should verify waitForFiber function includes rejection checking', async () => {
      // Read the integration test file  
      const testFilePath = join(__dirname, 'integration.test.ts');
      const content = await readFile(testFilePath, 'utf-8');
      
      // Find the waitForFiber function
      const waitForFiberMatch = content.match(
        /async function waitForFiber\([\s\S]*?(?=^async function|^\/\*\*|^$)/m
      );
      
      assert.ok(
        waitForFiberMatch,
        'waitForFiber function should exist in integration test'
      );
      
      const functionBody = waitForFiberMatch[0];
      
      // Should call checkForRejections during polling
      assert.ok(
        functionBody.includes('checkForRejections') || functionBody.includes('getRejections'),
        'waitForFiber should check for rejections during polling'
      );
      
      // Should return rejection information in result
      assert.ok(
        functionBody.includes('rejected') && functionBody.includes('rejectReason'),
        'waitForFiber should return rejection status in result object'
      );
      
      // Should check rejections periodically (not every iteration)
      assert.ok(
        functionBody.includes('% 10') || functionBody.includes('checkCount'),
        'waitForFiber should check rejections periodically to optimize performance'
      );
    });

    it('should verify main test function includes rejection assertions', async () => {
      // Read the integration test file
      const testFilePath = join(__dirname, 'integration.test.ts');
      const content = await readFile(testFilePath, 'utf-8');
      
      // Find the main function
      const mainFunctionMatch = content.match(
        /async function main\(\)[\s\S]*?(?=^}$)/m
      );
      
      assert.ok(
        mainFunctionMatch,
        'main function should exist in integration test'
      );
      
      const mainFunction = mainFunctionMatch[0];
      
      // Should have assertions after agent registration
      const registrationSection = mainFunction.slice(
        mainFunction.indexOf('registerAgent'),
        mainFunction.indexOf('registerAgent') + 1500
      );
      
      assert.ok(
        registrationSection.includes('rejected') || registrationSection.includes('rejections'),
        'Should check for rejections after agent registration'
      );
      
      // Should have assertions after activation
      if (mainFunction.includes('activateAgent')) {
        const activationSection = mainFunction.slice(
          mainFunction.indexOf('activateAgent'),
          mainFunction.indexOf('activateAgent') + 1500
        );
        
        assert.ok(
          activationSection.includes('rejected') || activationSection.includes('rejections'),
          'Should check for rejections after agent activation'
        );
      }
    });

    it('should verify test results include rejection status', async () => {
      // Read the integration test file
      const testFilePath = join(__dirname, 'integration.test.ts');
      const content = await readFile(testFilePath, 'utf-8');
      
      // Should have TestResult interface with rejection information
      const testResultInterface = content.match(/interface TestResult\s*{[\s\S]*?}/);
      
      if (testResultInterface) {
        assert.ok(
          testResultInterface[0].includes('rejection') || content.includes('rejectionCount'),
          'TestResult interface should include rejection tracking fields'
        );
      }
      
      // Should report rejection statistics in summary
      const printSummaryMatch = content.match(/function printSummary[\s\S]*?(?=^})/m);
      
      if (printSummaryMatch) {
        assert.ok(
          printSummaryMatch[0].includes('rejection') || printSummaryMatch[0].includes('Rejected'),
          'Summary should include rejection statistics'
        );
      }
    });
  });

  describe('Pattern Validation Tests', () => {
    it('should validate transaction-rejection checking pattern is applied consistently', async () => {
      // This test validates the pattern: Transaction → Wait → Check Rejections → Assert
      
      const testFilePath = join(__dirname, 'integration.test.ts');
      const content = await readFile(testFilePath, 'utf-8');
      
      // Find all transaction calls
      const transactionPatterns = [
        'registerAgent',
        'activateAgent', 
        'transitionStateMachine'
      ];
      
      for (const pattern of transactionPatterns) {
        const matches = [...content.matchAll(new RegExp(`${pattern}\\(`, 'g'))];
        
        for (const match of matches) {
          const startIndex = match.index || 0;
          // Look at the next 2000 characters after the transaction call
          const subsequentCode = content.slice(startIndex, startIndex + 2000);
          
          // Should have waitForFiber call
          assert.ok(
            subsequentCode.includes('waitForFiber'),
            `${pattern} should be followed by waitForFiber call`
          );
          
          // Should check for rejections (either in waitForFiber or separately)
          assert.ok(
            subsequentCode.includes('checkForRejections') || 
            subsequentCode.includes('getRejections') ||
            subsequentCode.includes('rejected'),
            `${pattern} should be followed by rejection checking`
          );
          
          // Should have assertion about rejection status
          assert.ok(
            subsequentCode.includes('assert') || 
            subsequentCode.includes('throw') ||
            subsequentCode.includes('error') ||
            subsequentCode.includes('fail'),
            `${pattern} should include assertion about rejection status`
          );
        }
      }
    });

    it('should verify error handling includes rejection context', async () => {
      // Test that error messages include rejection information when available
      
      const testFilePath = join(__dirname, 'integration.test.ts');
      const content = await readFile(testFilePath, 'utf-8');
      
      // Find error handling sections
      const errorHandlingPatterns = [
        /catch\s*\([^)]*\)\s*{[^}]*}/g,
        /throw new Error\([^)]*\)/g,
        /console\.error\([^)]*\)/g
      ];
      
      let hasRejectionContextInErrors = false;
      
      for (const pattern of errorHandlingPatterns) {
        const matches = [...content.matchAll(pattern)];
        
        for (const match of matches) {
          if (match[0].includes('rejection') || match[0].includes('rejected')) {
            hasRejectionContextInErrors = true;
            break;
          }
        }
        
        if (hasRejectionContextInErrors) break;
      }
      
      assert.ok(
        hasRejectionContextInErrors,
        'Error handling should include rejection context when applicable'
      );
    });

    it('should verify test configuration includes indexer settings', async () => {
      // Test that configuration section includes indexer settings
      
      const testFilePath = join(__dirname, 'integration.test.ts');
      const content = await readFile(testFilePath, 'utf-8');
      
      // Should have CONFIG object with indexer settings
      const configMatch = content.match(/const CONFIG\s*=\s*{[\s\S]*?};/);
      
      assert.ok(
        configMatch,
        'Integration test should have CONFIG object'
      );
      
      if (configMatch) {
        const configObject = configMatch[0];
        
        assert.ok(
          configObject.includes('indexer') || configObject.includes('INDEXER'),
          'CONFIG should include indexer URL configuration'
        );
      }
      
      // Should have environment variable for indexer URL
      assert.ok(
        content.includes('INDEXER_URL') || content.includes('process.env.INDEXER'),
        'Should support INDEXER_URL environment variable'
      );
    });
  });

  describe('Performance Impact Tests', () => {
    it('should verify rejection checking does not significantly impact test performance', async () => {
      // This test ensures rejection checking is optimized and doesn't slow down tests
      
      const testFilePath = join(__dirname, 'integration.test.ts');
      const content = await readFile(testFilePath, 'utf-8');
      
      // Should use efficient polling intervals for rejection checks
      const pollingMatches = content.match(/checkCount\s*%\s*(\d+)/g);
      
      if (pollingMatches) {
        for (const match of pollingMatches) {
          const interval = parseInt(match.match(/\d+/)?.[0] || '0');
          assert.ok(
            interval >= 5,
            `Rejection check interval should be at least 5 iterations for performance, but found ${interval}`
          );
        }
      }
      
      // Should have reasonable timeouts for rejection API calls
      const timeoutMatches = content.match(/timeout\s*:\s*(\d+)/g) || content.match(/AbortSignal\.timeout\((\d+)\)/g);
      
      if (timeoutMatches) {
        for (const match of timeoutMatches) {
          const timeout = parseInt(match.match(/\d+/)?.[0] || '0');
          assert.ok(
            timeout <= 10000,
            `Rejection API timeout should be reasonable (≤10s), but found ${timeout}ms`
          );
        }
      }
    });

    it('should verify rejection checks are batched or optimized for multiple fibers', async () => {
      // Test that rejection checking is optimized when testing multiple fibers
      
      const testFilePath = join(__dirname, 'integration.test.ts');
      const content = await readFile(testFilePath, 'utf-8');
      
      // Look for efficient rejection checking patterns
      const batchPatterns = [
        'Promise.all',
        'Promise.allSettled', 
        'batch',
        'multiple'
      ];
      
      let hasOptimizedPattern = false;
      for (const pattern of batchPatterns) {
        if (content.includes(pattern) && content.indexOf(pattern) !== -1) {
          const contextStart = Math.max(0, content.indexOf(pattern) - 200);
          const contextEnd = Math.min(content.length, content.indexOf(pattern) + 200);
          const context = content.slice(contextStart, contextEnd);
          
          if (context.includes('rejection') || context.includes('fiber')) {
            hasOptimizedPattern = true;
            break;
          }
        }
      }
      
      // This is a guideline rather than strict requirement
      if (content.includes('multiple') || content.includes('concurrent')) {
        assert.ok(
          hasOptimizedPattern,
          'When testing multiple fibers, rejection checking should use optimized patterns'
        );
      }
    });
  });
});