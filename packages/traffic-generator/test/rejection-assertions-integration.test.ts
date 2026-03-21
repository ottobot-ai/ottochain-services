/**
 * Traffic Generator Rejection Assertions — Pattern Verification
 *
 * Verifies that integration.test.ts has proper rejection checking patterns.
 * These are static analysis tests that don't need a running cluster.
 *
 * Run: npx tsx --test test/rejection-assertions-integration.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const INTEGRATION_TEST_PATH = join(__dirname, 'integration.test.ts');

const content = readFileSync(INTEGRATION_TEST_PATH, 'utf8');

describe('Traffic Generator Integration Test — Rejection Pattern Verification', () => {

  it('integration.test.ts exists and is non-empty', () => {
    assert.ok(content.length > 0, 'integration.test.ts should not be empty');
  });

  it('imports or defines getRejections function', () => {
    assert.ok(
      content.includes('getRejections'),
      'integration.test.ts must define or import getRejections',
    );
  });

  it('has rejection assertions using rejections.length', () => {
    const rejectionRefs = (content.match(/rejections/g) || []).length;
    assert.ok(
      rejectionRefs >= 2,
      `integration.test.ts must reference rejections multiple times, found: ${rejectionRefs}`,
    );
  });

  it('checks rejections.length for zero', () => {
    assert.ok(
      /rejections.*length/.test(content),
      'integration.test.ts must check rejections.length',
    );
  });

  it('includes fiberId in rejection checks', () => {
    assert.ok(
      /getRejections.*fiberId|rejections.*fiberId/.test(content),
      'integration.test.ts must include fiberId in rejection checks',
    );
  });

  it('reads INDEXER_URL environment variable', () => {
    assert.ok(
      content.includes('INDEXER_URL'),
      'integration.test.ts must read INDEXER_URL environment variable',
    );
  });

  it('uses rejection API endpoint pattern (/rejections)', () => {
    assert.ok(
      /\/rejections/.test(content),
      'integration.test.ts must use /rejections API endpoint',
    );
  });

  it('has rejection checks after agent registration flow', () => {
    const registerIndex = content.indexOf('register');
    const rejectionIndex = content.lastIndexOf('rejections');
    assert.ok(registerIndex >= 0, 'integration.test.ts must have registration code');
    assert.ok(
      rejectionIndex > registerIndex,
      'Rejection checks must appear after registration in integration.test.ts',
    );
  });

  it('has rejection checks after agent activation', () => {
    const activateIndex = content.indexOf('activate');
    assert.ok(activateIndex >= 0, 'integration.test.ts must have activation code');
    // Verify rejection checks exist somewhere after activation
    const remainingContent = content.slice(activateIndex);
    assert.ok(
      remainingContent.includes('rejections'),
      'Rejection checks must appear after activation code',
    );
  });

  it('has assertNoRejections helper function', () => {
    assert.ok(
      content.includes('assertNoRejections'),
      'integration.test.ts must define or use assertNoRejections helper',
    );
  });

  it('uses client.getRejections for integration with BridgeClient', () => {
    assert.ok(
      content.includes('client.getRejections'),
      'integration.test.ts must use client.getRejections({ fiberId }) pattern',
    );
  });

  it('has retry logic that handles rejections differently from network failures', () => {
    assert.ok(
      /rejected.*break|break.*rejected|rejected\s*\)/m.test(content),
      'integration.test.ts retry logic must distinguish rejected fibers from network failures',
    );
  });

  it('documents rejection checking pattern in comments', () => {
    assert.ok(
      /\/\*[\s\S]*rejection[\s\S]*\*\/|\/\/.*rejection.*check/i.test(content),
      'integration.test.ts must document rejection checking pattern in comments',
    );
  });

  it('includes indexer health check for service availability', () => {
    assert.ok(
      /indexer.*health|health.*indexer/i.test(content),
      'integration.test.ts must validate indexer service availability',
    );
  });

  it('has sufficient rejection assertion coverage', () => {
    const assertions = (content.match(/assert\.strictEqual\(.*rejections.*\.length.*,\s*0/gi) || []).length;
    assert.ok(
      assertions >= 3,
      `integration.test.ts must have at least 3 rejection assertions, found: ${assertions}`,
    );
  });

  it('has detailed error messages in rejection assertions', () => {
    const hasDetailedErrors = /assert.*rejections[\s\S]{0,300}fiberId/i.test(content) ||
                              /assert.*rejections[\s\S]{0,300}error/i.test(content);
    assert.ok(
      hasDetailedErrors,
      'Rejection assertions must include detailed error messages with fiberId',
    );
  });
});
