/**
 * Bridge Client Script Method Tests
 * 
 * TDD tests for script oracle methods that need to be added to BridgeClient.
 * These methods are required for script oracle integration in traffic generation.
 * 
 * Tests WILL FAIL until BridgeClient is updated with script oracle support.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BridgeClient } from '../src/bridge-client.js';

// Mock fetch for HTTP requests
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('BridgeClient Script Oracle Methods', () => {
  let client: BridgeClient;
  const bridgeUrl = 'http://localhost:3030';
  const ml0Url = 'http://localhost:9200';

  beforeEach(() => {
    vi.clearAllMocks();
    client = new BridgeClient({ bridgeUrl, ml0Url });
  });

  describe('registerScript', () => {
    it('should register a new script oracle', async () => {
      const mockResponse = {
        ok: true,
        status: 201,
        json: vi.fn().mockResolvedValue({
          scriptId: 'script-uuid-123',
          owner: 'DAG1234567890abcdef',
          name: 'EscrowScript',
          hash: 'tx-hash-456'
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      const result = await client.registerScript({
        privateKey: 'a'.repeat(64),
        name: 'EscrowScript',
        description: 'Automated escrow release script',
        program: {
          'if': [
            { '>': [{ var: 'state.depositAmount' }, 0] },
            { var: 'inputs.shouldRelease' },
            false
          ]
        },
        initialState: {
          depositAmount: 0,
          isReleased: false
        },
        accessControl: {
          invokers: [], // Anyone can invoke
          owners: ['DAG1234567890abcdef']
        }
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${bridgeUrl}/script/register`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"name":"EscrowScript"')
        })
      );

      expect(result).toEqual({
        scriptId: 'script-uuid-123',
        owner: 'DAG1234567890abcdef',
        name: 'EscrowScript',
        hash: 'tx-hash-456'
      });
    });

    it('should handle script registration errors', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({
          error: 'Invalid JSON Logic program',
          details: ['Invalid operator: unsupported']
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      await expect(
        client.registerScript({
          privateKey: 'a'.repeat(64),
          name: 'BadScript',
          program: { 'invalid_op': ['bad'] },
        })
      ).rejects.toThrow('Invalid JSON Logic program');
    });

    it('should support optional parameters', async () => {
      const mockResponse = {
        ok: true,
        status: 201,
        json: vi.fn().mockResolvedValue({
          scriptId: 'script-uuid-456',
          owner: 'DAG1234567890abcdef',
          name: 'VotingScript',
          hash: 'tx-hash-789'
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      await client.registerScript({
        privateKey: 'b'.repeat(64),
        name: 'VotingScript',
        program: { 'if': [true, 'approved', 'rejected'] },
        fiberId: 'custom-script-id-123',
        metadata: {
          version: '1.0.0',
          author: 'traffic-generator'
        }
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${bridgeUrl}/script/register`,
        expect.objectContaining({
          body: expect.stringMatching(/custom-script-id-123/)
        })
      );
    });
  });

  describe('invokeScript', () => {
    it('should invoke script with inputs and context', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          invocationId: 'invoke-uuid-789',
          scriptId: 'script-uuid-123',
          caller: 'DAG1234567890abcdef',
          hash: 'invoke-hash-abc'
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      const result = await client.invokeScript({
        privateKey: 'c'.repeat(64),
        scriptId: 'script-uuid-123',
        inputs: {
          currentState: 'PENDING',
          fiberData: { amount: 100, recipient: 'DAG9876543210fedcba' },
          shouldRelease: true
        },
        context: {
          fiberType: 'scriptEscrow',
          generationId: 42
        }
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${bridgeUrl}/script/invoke`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"scriptId":"script-uuid-123"')
        })
      );

      expect(result).toEqual({
        invocationId: 'invoke-uuid-789',
        scriptId: 'script-uuid-123',
        caller: 'DAG1234567890abcdef',
        hash: 'invoke-hash-abc'
      });
    });

    it('should handle script invocation errors', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({
          error: 'Script not found'
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      await expect(
        client.invokeScript({
          privateKey: 'c'.repeat(64),
          scriptId: 'non-existent-script',
          inputs: { test: true }
        })
      ).rejects.toThrow('Script not found');
    });

    it('should support optional context parameter', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          invocationId: 'invoke-uuid-abc',
          scriptId: 'script-uuid-123',
          caller: 'DAG1234567890abcdef',
          hash: 'invoke-hash-def'
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      await client.invokeScript({
        privateKey: 'd'.repeat(64),
        scriptId: 'script-uuid-123',
        inputs: { decision: 'approve' }
        // No context provided
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.context).toBeUndefined();
    });
  });

  describe('getScript', () => {
    it('should fetch script by ID', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          scriptId: 'script-uuid-123',
          metadata: {
            name: 'EscrowScript',
            description: 'Automated escrow release',
            createdAt: '2026-03-06T05:00:00Z'
          },
          program: {
            'if': [{ var: 'inputs.shouldRelease' }, 'release', 'hold']
          },
          stateData: {
            depositAmount: 100,
            isReleased: false
          },
          lastInvocation: {
            invocationId: 'invoke-uuid-789',
            result: {
              nextEvent: 'release_funds',
              nextState: 'RELEASED',
              shouldTransition: true
            },
            timestamp: 1709719200000
          }
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      const result = await client.getScript('script-uuid-123');

      expect(mockFetch).toHaveBeenCalledWith(
        `${bridgeUrl}/script/script-uuid-123`,
        expect.objectContaining({
          method: 'GET'
        })
      );

      expect(result).toEqual(expect.objectContaining({
        scriptId: 'script-uuid-123',
        metadata: expect.objectContaining({
          name: 'EscrowScript'
        }),
        lastInvocation: expect.objectContaining({
          result: expect.objectContaining({
            nextEvent: 'release_funds',
            shouldTransition: true
          })
        })
      }));
    });

    it('should handle script not found', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({
          error: 'Script not found'
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      await expect(
        client.getScript('non-existent-script')
      ).rejects.toThrow('Script not found');
    });
  });

  describe('getScriptResult', () => {
    it('should fetch last invocation result for script', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          scriptId: 'script-uuid-123',
          name: 'EscrowScript',
          lastInvocation: {
            invocationId: 'invoke-uuid-789',
            result: {
              nextEvent: 'release_funds',
              nextState: 'RELEASED',
              shouldTransition: true,
              confidence: 0.95
            },
            inputs: {
              currentState: 'PENDING',
              shouldRelease: true
            },
            timestamp: 1709719200000
          },
          state: {
            depositAmount: 100,
            isReleased: false
          }
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      const result = await client.getScriptResult('script-uuid-123');

      expect(mockFetch).toHaveBeenCalledWith(
        `${bridgeUrl}/script/script-uuid-123/result`,
        expect.objectContaining({
          method: 'GET'
        })
      );

      expect(result).toEqual(expect.objectContaining({
        scriptId: 'script-uuid-123',
        name: 'EscrowScript',
        lastInvocation: expect.objectContaining({
          result: expect.objectContaining({
            nextEvent: 'release_funds',
            shouldTransition: true
          })
        })
      }));
    });

    it('should handle script with no invocations', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          scriptId: 'script-uuid-456',
          name: 'NewScript',
          lastInvocation: null,
          state: {}
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      const result = await client.getScriptResult('script-uuid-456');
      expect(result.lastInvocation).toBeNull();
    });
  });

  describe('listScripts', () => {
    it('should list scripts with filters', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          total: 3,
          offset: 0,
          limit: 10,
          count: 3,
          scripts: {
            'script-uuid-123': {
              metadata: { name: 'EscrowScript' },
              accessControl: { owners: ['DAG1234567890abcdef'] }
            },
            'script-uuid-456': {
              metadata: { name: 'VotingScript' },
              accessControl: { owners: ['DAG9876543210fedcba'] }
            },
            'script-uuid-789': {
              metadata: { name: 'ApprovalScript' },
              accessControl: { owners: ['DAG1234567890abcdef'] }
            }
          }
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      const result = await client.listScripts({
        owner: 'DAG1234567890abcdef',
        limit: 10,
        offset: 0
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${bridgeUrl}/script?owner=DAG1234567890abcdef&limit=10&offset=0`,
        expect.objectContaining({
          method: 'GET'
        })
      );

      expect(result).toEqual(expect.objectContaining({
        total: 3,
        count: 3,
        scripts: expect.any(Object)
      }));
    });

    it('should support optional filters', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          total: 5,
          offset: 0,
          limit: 100,
          count: 5,
          scripts: {}
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      await client.listScripts();

      expect(mockFetch).toHaveBeenCalledWith(
        `${bridgeUrl}/script`,
        expect.objectContaining({
          method: 'GET'
        })
      );
    });

    it('should filter by name when provided', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          total: 1,
          offset: 0,
          limit: 100,
          count: 1,
          scripts: {
            'script-uuid-123': {
              metadata: { name: 'EscrowScript' }
            }
          }
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      await client.listScripts({ name: 'Escrow' });

      expect(mockFetch).toHaveBeenCalledWith(
        `${bridgeUrl}/script?name=Escrow`,
        expect.objectContaining({
          method: 'GET'
        })
      );
    });
  });

  describe('updateScript', () => {
    it('should update script properties', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          scriptId: 'script-uuid-123',
          updatedFields: ['program', 'metadata'],
          hash: 'update-hash-abc'
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      const result = await client.updateScript('script-uuid-123', {
        privateKey: 'e'.repeat(64),
        program: {
          'if': [{ '>': [{ var: 'state.amount' }, 50] }, 'release', 'hold']
        },
        metadata: {
          version: '1.1.0',
          lastUpdated: '2026-03-06T05:30:00Z'
        }
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${bridgeUrl}/script/script-uuid-123/update`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"version":"1.1.0"')
        })
      );

      expect(result).toEqual({
        scriptId: 'script-uuid-123',
        updatedFields: ['program', 'metadata'],
        hash: 'update-hash-abc'
      });
    });

    it('should handle unauthorized update attempts', async () => {
      const mockResponse = {
        ok: false,
        status: 403,
        json: vi.fn().mockResolvedValue({
          error: 'Not authorized to update this script'
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      await expect(
        client.updateScript('script-uuid-123', {
          privateKey: 'f'.repeat(64),
          program: { 'new': 'program' }
        })
      ).rejects.toThrow('Not authorized to update this script');
    });
  });
});