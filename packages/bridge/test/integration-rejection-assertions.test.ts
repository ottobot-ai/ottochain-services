/**
 * Integration Rejection Assertions (TDD)
 * 
 * These tests enforce that integration tests properly assert no rejections occurred.
 * Tests will FAIL until integration test files are updated with proper rejection assertions.
 * 
 * Acceptance Criteria from Trello card:
 * - Integration tests must check rejection API after each transaction
 * - Tests must fail if unexpected rejections are found
 * - Example pattern: const rejections = await indexer.getRejections({ fiberId }); expect(rejections.length).toBe(0);
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BRIDGE_TEST_DIR = __dirname;
const TRAFFIC_GEN_TEST_DIR = join(__dirname, '../../../traffic-generator/test');

/**
 * Read and analyze test file content to check for proper rejection assertions
 */
function analyzeTestFileForRejectionAssertions(filePath: string): {
  hasRejectionChecking: boolean;
  hasRejectionAssertions: boolean;
  rejectionCheckPatterns: string[];
  missingPatterns: string[];
} {
  try {
    const content = readFileSync(filePath, 'utf8');
    
    // Look for rejection checking patterns
    const rejectionCheckPatterns = [
      /getRejections\s*\(/g,
      /rejections\.length/g,
      /expect\(.*rejections.*\.length\)\.toBe\(0\)/g,
      /assert\.strictEqual\(.*rejections.*\.length.*,\s*0\)/g,
      /assert\.equal\(.*rejections.*\.length.*,\s*0\)/g
    ];

    const foundPatterns: string[] = [];
    const missingPatterns: string[] = [];
    
    let hasRejectionChecking = false;
    let hasRejectionAssertions = false;

    for (let i = 0; i < rejectionCheckPatterns.length; i++) {
      const pattern = rejectionCheckPatterns[i];
      const matches = content.match(pattern);
      
      if (matches && matches.length > 0) {
        foundPatterns.push(pattern.source);
        hasRejectionChecking = true;
        
        // Patterns 2+ indicate proper assertions
        if (i >= 1) {
          hasRejectionAssertions = true;
        }
      } else {
        missingPatterns.push(pattern.source);
      }
    }

    return {
      hasRejectionChecking,
      hasRejectionAssertions,
      rejectionCheckPatterns: foundPatterns,
      missingPatterns
    };
  } catch (error) {
    return {
      hasRejectionChecking: false,
      hasRejectionAssertions: false,
      rejectionCheckPatterns: [],
      missingPatterns: ['File not readable']
    };
  }
}

describe('Integration Test Rejection Assertions (TDD)', () => {
  
  describe('Traffic Generator Integration Tests', () => {
    const integrationTestPath = join(TRAFFIC_GEN_TEST_DIR, 'integration.test.ts');
    
    it('SHOULD FAIL: traffic-generator integration.test.ts must assert no rejections after agent registration', () => {
      const analysis = analyzeTestFileForRejectionAssertions(integrationTestPath);
      
      // This test SHOULD FAIL until integration.test.ts is updated
      assert.ok(
        analysis.hasRejectionAssertions,
        `FAILING AS EXPECTED: integration.test.ts must include rejection assertions like "expect(rejections.length).toBe(0)". ` +
        `Found patterns: [${analysis.rejectionCheckPatterns.join(', ')}]. ` +
        `Missing: [${analysis.missingPatterns.join(', ')}]. ` +
        `Update integration.test.ts to add proper rejection assertions after registerAgent() calls.`
      );
    });

    it('SHOULD FAIL: traffic-generator integration.test.ts must assert no rejections after agent activation', () => {
      const analysis = analyzeTestFileForRejectionAssertions(integrationTestPath);
      
      // Look specifically for assertions after activation
      const content = readFileSync(integrationTestPath, 'utf8');
      const hasActivationRejectionCheck = content.includes('activateAgent') && 
                                         content.match(/activateAgent[\s\S]{0,500}rejections\.length.*toBe\(0\)|assert.*rejections.*length.*0/);
      
      assert.ok(
        hasActivationRejectionCheck,
        `FAILING AS EXPECTED: integration.test.ts must check rejections after activateAgent() calls. ` +
        `Add rejection assertion in Test 5 (Agent Activation) section.`
      );
    });

    it('SHOULD FAIL: integration.test.ts waitForFiber function must include rejection assertions in test flow', () => {
      const content = readFileSync(integrationTestPath, 'utf8');
      
      // Check that waitForFiber results in test assertions, not just diagnostic logging
      const hasWaitForFiberAssertions = content.match(/waitForFiber[\s\S]{0,800}(assert|expect).*reject/i);
      
      assert.ok(
        hasWaitForFiberAssertions,
        `FAILING AS EXPECTED: waitForFiber function must lead to proper test assertions about rejections. ` +
        `Currently only has diagnostic logging. Add assertions in main test flow after waitForFiber calls.`
      );
    });
  });

  describe('Bridge E2E Tests', () => {
    const e2eTestPath = join(BRIDGE_TEST_DIR, 'e2e.test.ts');
    
    it('SHOULD FAIL: bridge e2e.test.ts must assert no rejections after state machine operations', () => {
      const analysis = analyzeTestFileForRejectionAssertions(e2eTestPath);
      
      // This test SHOULD FAIL until e2e.test.ts is updated
      assert.ok(
        analysis.hasRejectionAssertions,
        `FAILING AS EXPECTED: e2e.test.ts must include rejection assertions after state machine operations. ` +
        `Pattern needed: "const rejections = await indexer.getRejections({ fiberId }); assert.strictEqual(rejections.length, 0);". ` +
        `Found: [${analysis.rejectionCheckPatterns.join(', ')}]. Missing: [${analysis.missingPatterns.join(', ')}]`
      );
    });

    it('SHOULD FAIL: bridge e2e.test.ts must check rejections after agent registration', () => {
      const content = readFileSync(e2eTestPath, 'utf8');
      
      // Look for registration followed by rejection checking
      const hasRegistrationRejectionCheck = content.match(/register[\s\S]{0,600}rejections/i);
      
      assert.ok(
        hasRegistrationRejectionCheck,
        `FAILING AS EXPECTED: e2e.test.ts must check rejections after agent registration operations. ` +
        `Add rejection API call and assertion after bridge registration calls.`
      );
    });

    it('SHOULD FAIL: bridge e2e.test.ts must check rejections after state transitions', () => {
      const content = readFileSync(e2eTestPath, 'utf8');
      
      // Look for state transition operations followed by rejection checking
      const hasStateTransitionRejectionCheck = content.match(/(activate|transition)[\s\S]{0,600}rejections/i);
      
      assert.ok(
        hasStateTransitionRejectionCheck,
        `FAILING AS EXPECTED: e2e.test.ts must check rejections after state transition operations. ` +
        `Add rejection assertions after activate/transition calls in state machine tests.`
      );
    });

    it('SHOULD FAIL: bridge e2e.test.ts waitForFiber/waitForState helpers must be enhanced with rejection checking', () => {
      const content = readFileSync(e2eTestPath, 'utf8');
      
      // Check if waitForFiber or waitForState include rejection checking
      const hasEnhancedWaitHelpers = content.match(/waitFor(Fiber|State)[\s\S]{0,800}getRejections/);
      
      assert.ok(
        hasEnhancedWaitHelpers,
        `FAILING AS EXPECTED: e2e.test.ts waitForFiber/waitForState helpers must include rejection checking. ` +
        `Enhance these helper functions to check rejections and fail fast if found.`
      );
    });
  });

  describe('Required Rejection API Integration Patterns', () => {
    
    it('SHOULD FAIL: integration tests must use INDEXER_URL environment variable for rejection checking', () => {
      const integrationContent = readFileSync(join(TRAFFIC_GEN_TEST_DIR, 'integration.test.ts'), 'utf8');
      const e2eContent = readFileSync(join(BRIDGE_TEST_DIR, 'e2e.test.ts'), 'utf8');
      
      const integrationUsesIndexerEnv = integrationContent.includes('INDEXER_URL');
      const e2eUsesIndexerEnv = e2eContent.includes('INDEXER_URL');
      
      assert.ok(
        integrationUsesIndexerEnv && e2eUsesIndexerEnv,
        `FAILING AS EXPECTED: Both integration.test.ts and e2e.test.ts must read INDEXER_URL environment variable. ` +
        `Integration: ${integrationUsesIndexerEnv}, E2E: ${e2eUsesIndexerEnv}. ` +
        `Add: const INDEXER_URL = process.env.INDEXER_URL || 'http://localhost:3031';`
      );
    });

    it('SHOULD FAIL: integration tests must implement getRejections API call pattern', () => {
      const requiredPattern = `fetch(\`\${indexerUrl}/fibers/\${fiberId}/rejections\`)`;
      
      const integrationContent = readFileSync(join(TRAFFIC_GEN_TEST_DIR, 'integration.test.ts'), 'utf8');
      const e2eContent = readFileSync(join(BRIDGE_TEST_DIR, 'e2e.test.ts'), 'utf8');
      
      const integrationHasPattern = integrationContent.includes('/rejections');
      const e2eHasPattern = e2eContent.includes('/rejections');
      
      assert.ok(
        integrationHasPattern && e2eHasPattern,
        `FAILING AS EXPECTED: Integration tests must implement rejection API calls. ` +
        `Pattern: ${requiredPattern}. Integration: ${integrationHasPattern}, E2E: ${e2eHasPattern}. ` +
        `Add rejection API calls after each transaction.`
      );
    });

    it('SHOULD FAIL: integration tests must fail with detailed error messages when rejections found', () => {
      // This test checks that the pattern includes error details in assertions
      const integrationContent = readFileSync(join(TRAFFIC_GEN_TEST_DIR, 'integration.test.ts'), 'utf8');
      const e2eContent = readFileSync(join(BRIDGE_TEST_DIR, 'e2e.test.ts'), 'utf8');
      
      // Look for detailed error messages in assertions
      const integrationHasDetailedErrors = integrationContent.match(/assert.*rejections[\s\S]{0,200}(fiberId|error|reason)/i);
      const e2eHasDetailedErrors = e2eContent.match(/assert.*rejections[\s\S]{0,200}(fiberId|error|reason)/i);
      
      assert.ok(
        integrationHasDetailedErrors && e2eHasDetailedErrors,
        `FAILING AS EXPECTED: Rejection assertions must include detailed error messages with fiberId and rejection reasons. ` +
        `Integration: ${!!integrationHasDetailedErrors}, E2E: ${!!e2eHasDetailedErrors}. ` +
        `Example: assert.strictEqual(rejections.length, 0, \`Fiber \${fiberId} rejected: \${rejections.map(r => r.errors).join(', ')}\`);`
      );
    });
  });

  describe('Test Pattern Requirements (Based on Trello Spec)', () => {
    
    it('SHOULD FAIL: integration tests must implement example pattern from Trello card', () => {
      // The Trello card specifies this exact pattern:
      // const rejections = await indexer.getRejections({ fiberId });
      // expect(rejections.length).toBe(0);
      
      const integrationContent = readFileSync(join(TRAFFIC_GEN_TEST_DIR, 'integration.test.ts'), 'utf8');
      const e2eContent = readFileSync(join(BRIDGE_TEST_DIR, 'e2e.test.ts'), 'utf8');
      
      const trelloPattern = /getRejections\s*\(\s*{\s*fiberId\s*}\s*\)/;
      const integrationHasTrelloPattern = trelloPattern.test(integrationContent);
      const e2eHasTrelloPattern = trelloPattern.test(e2eContent);
      
      assert.ok(
        integrationHasTrelloPattern && e2eHasTrelloPattern,
        `FAILING AS EXPECTED: Tests must use exact pattern from Trello specification. ` +
        `Required: "await indexer.getRejections({ fiberId })". ` +
        `Integration: ${integrationHasTrelloPattern}, E2E: ${e2eHasTrelloPattern}. ` +
        `Update tests to match Trello card example.`
      );
    });
  });
});

/**
 * Additional failing tests for specific integration scenarios
 */
describe('Integration Test Coverage Gaps (TDD)', () => {

  it('SHOULD FAIL: traffic-generator must test rejection handling in retry scenarios', () => {
    const content = readFileSync(join(TRAFFIC_GEN_TEST_DIR, 'integration.test.ts'), 'utf8');
    
    // Look for retry logic combined with rejection checking
    const hasRetryRejectionLogic = content.match(/retry[\s\S]{0,500}rejection/i) || 
                                  content.match(/rejection[\s\S]{0,500}retry/i);
    
    assert.ok(
      hasRetryRejectionLogic,
      `FAILING AS EXPECTED: Retry scenarios must handle rejections properly. ` +
      `Add logic to distinguish between retryable failures and permanent rejections.`
    );
  });

  it('SHOULD FAIL: bridge tests must validate rejection error codes match expected patterns', () => {
    const e2eContent = readFileSync(join(BRIDGE_TEST_DIR, 'e2e.test.ts'), 'utf8');
    
    // Look for validation of specific rejection error codes
    const hasErrorCodeValidation = e2eContent.match(/error\.(code|type).*===/i) ||
                                   e2eContent.match(/(InvalidOwner|ValidationError|InvalidState)/);
    
    assert.ok(
      hasErrorCodeValidation,
      `FAILING AS EXPECTED: Tests must validate specific rejection error codes when rejections occur. ` +
      `Add validation for error codes like InvalidOwner, ValidationError, InvalidState.`
    );
  });

  it('SHOULD FAIL: integration tests must have comprehensive rejection assertion coverage', () => {
    const integrationContent = readFileSync(join(TRAFFIC_GEN_TEST_DIR, 'integration.test.ts'), 'utf8');
    const e2eContent = readFileSync(join(BRIDGE_TEST_DIR, 'e2e.test.ts'), 'utf8');
    
    // Count rejection assertions vs operations
    const integrationRejectionAssertions = (integrationContent.match(/assert.*rejections.*length.*0/gi) || []).length;
    const integrationOperations = (integrationContent.match(/(register|activate|transition)/gi) || []).length;
    
    const e2eRejectionAssertions = (e2eContent.match(/assert.*rejections.*length.*0/gi) || []).length;
    const e2eOperations = (e2eContent.match(/(register|activate|transition)/gi) || []).length;
    
    const integrationCoverage = integrationOperations > 0 ? integrationRejectionAssertions / integrationOperations : 0;
    const e2eCoverage = e2eOperations > 0 ? e2eRejectionAssertions / e2eOperations : 0;
    
    assert.ok(
      integrationCoverage >= 0.8 && e2eCoverage >= 0.8,
      `FAILING AS EXPECTED: Rejection assertion coverage too low. ` +
      `Integration: ${integrationRejectionAssertions}/${integrationOperations} (${(integrationCoverage * 100).toFixed(0)}%). ` +
      `E2E: ${e2eRejectionAssertions}/${e2eOperations} (${(e2eCoverage * 100).toFixed(0)}%). ` +
      `Need 80%+ coverage of operations with rejection assertions.`
    );
  });
});