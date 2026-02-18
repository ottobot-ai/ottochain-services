// Integration tests for Governance Bridge API routes
// Tests all governance operations following existing bridge patterns

import request from 'supertest';
import express from 'express';
import { governanceRoutes } from '../governance.js';

// Mock the metagraph functions
jest.mock('../../metagraph.js', () => ({
  submitTransaction: jest.fn(() => Promise.resolve({ hash: 'mock-hash-123' })),
  getStateMachine: jest.fn(),
  getCheckpoint: jest.fn(),
  keyPairFromPrivateKey: jest.fn(() => ({ address: 'mock-address-123' })),
  getFiberSequenceNumber: jest.fn(() => Promise.resolve(1)),
}));

// Mock the SDK functions
jest.mock('@ottochain/sdk/apps/governance', () => ({
  getDAODefinition: jest.fn(() => ({ mock: 'definition' })),
  getGovernanceDefinition: jest.fn(() => ({ mock: 'definition' })),
}));

const app = express();
app.use(express.json());
app.use('/governance', governanceRoutes);

describe('Governance Bridge API', () => {
  const mockPrivateKey = 'a'.repeat(64);
  const mockDAO = {
    id: '12345678-1234-1234-1234-123456789012',
    currentState: { value: 'ACTIVE' },
    stateData: {
      schema: 'Governance',
      name: 'Test DAO',
      description: 'Test description',
      proposal: null,
      votes: {},
      delegations: {},
      status: 'ACTIVE',
      metadata: {
        createdBy: 'mock-address-123',
        createdAt: '2024-01-01T00:00:00Z'
      }
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /governance/proposals', () => {
    it('should create a new proposal successfully', async () => {
      const { getStateMachine } = require('../../metagraph.js');
      getStateMachine.mockResolvedValue(mockDAO);

      const response = await request(app)
        .post('/governance/proposals')
        .send({
          privateKey: mockPrivateKey,
          daoId: '12345678-1234-1234-1234-123456789012',
          title: 'Test Proposal',
          description: 'Test description',
          actionType: 'treasury-spend',
          payload: { amount: 1000 }
        });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        daoId: '12345678-1234-1234-1234-123456789012',
        title: 'Test Proposal',
        status: 'PROPOSED',
        proposer: 'mock-address-123',
        hash: 'mock-hash-123'
      });
      expect(response.body.proposalId).toBeDefined();
    });

    it('should fail when DAO is not in ACTIVE state', async () => {
      const { getStateMachine } = require('../../metagraph.js');
      getStateMachine.mockResolvedValue({
        ...mockDAO,
        currentState: { value: 'VOTING' }
      });

      const response = await request(app)
        .post('/governance/proposals')
        .send({
          privateKey: mockPrivateKey,
          daoId: '12345678-1234-1234-1234-123456789012',
          title: 'Test Proposal'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('not in Active state');
    });
  });

  describe('POST /governance/proposals/:id/submit', () => {
    it('should submit proposal for discussion', async () => {
      const { getCheckpoint } = require('../../metagraph.js');
      getCheckpoint.mockResolvedValue({
        state: {
          stateMachines: {
            '12345678-1234-1234-1234-123456789012': {
              ...mockDAO,
              currentState: { value: 'PROPOSED' },
              stateData: {
                ...mockDAO.stateData,
                proposal: {
                  id: 'proposal-123',
                  title: 'Test Proposal',
                  proposer: 'mock-address-123',
                  createdAt: '2024-01-01T00:00:00Z'
                }
              }
            }
          }
        }
      });

      const response = await request(app)
        .post('/governance/proposals/proposal-123/submit')
        .send({
          privateKey: mockPrivateKey
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        proposalId: 'proposal-123',
        daoId: '12345678-1234-1234-1234-123456789012',
        status: 'DISCUSSION',
        submittedBy: 'mock-address-123',
        hash: 'mock-hash-123'
      });
    });

    it('should return 404 for non-existent proposal', async () => {
      const { getCheckpoint } = require('../../metagraph.js');
      getCheckpoint.mockResolvedValue({
        state: { stateMachines: {} }
      });

      const response = await request(app)
        .post('/governance/proposals/non-existent/submit')
        .send({
          privateKey: mockPrivateKey
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Proposal not found');
    });
  });

  describe('POST /governance/proposals/:id/vote', () => {
    it('should cast vote on proposal', async () => {
      const { getCheckpoint } = require('../../metagraph.js');
      getCheckpoint.mockResolvedValue({
        state: {
          stateMachines: {
            '12345678-1234-1234-1234-123456789012': {
              ...mockDAO,
              currentState: { value: 'VOTING' },
              stateData: {
                ...mockDAO.stateData,
                schema: 'Governance',
                proposal: {
                  id: 'proposal-123',
                  title: 'Test Proposal',
                  proposer: 'mock-address-123',
                  createdAt: '2024-01-01T00:00:00Z'
                }
              }
            }
          }
        }
      });

      const response = await request(app)
        .post('/governance/proposals/proposal-123/vote')
        .send({
          privateKey: mockPrivateKey,
          vote: 'For',
          weight: 5
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        proposalId: 'proposal-123',
        daoId: '12345678-1234-1234-1234-123456789012',
        voter: 'mock-address-123',
        action: 'voted For',
        weight: 5,
        hash: 'mock-hash-123'
      });
    });

    it('should handle multisig signing', async () => {
      const { getCheckpoint } = require('../../metagraph.js');
      getCheckpoint.mockResolvedValue({
        state: {
          stateMachines: {
            '12345678-1234-1234-1234-123456789012': {
              currentState: { value: 'PENDING' },
              stateData: {
                schema: 'MultisigDAO',
                proposal: {
                  id: 'proposal-123',
                  title: 'Test Proposal',
                  proposer: 'mock-address-123',
                  createdAt: '2024-01-01T00:00:00Z'
                }
              }
            }
          }
        }
      });

      const response = await request(app)
        .post('/governance/proposals/proposal-123/vote')
        .send({
          privateKey: mockPrivateKey,
          vote: 'For'
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        proposalId: 'proposal-123',
        voter: 'mock-address-123',
        action: 'signed'
      });
    });
  });

  describe('POST /governance/proposals/:id/queue', () => {
    it('should queue proposal for execution', async () => {
      const { getCheckpoint } = require('../../metagraph.js');
      getCheckpoint.mockResolvedValue({
        state: {
          stateMachines: {
            '12345678-1234-1234-1234-123456789012': {
              currentState: { value: 'VOTING' },
              stateData: {
                proposal: {
                  id: 'proposal-123',
                  title: 'Test Proposal'
                }
              }
            }
          }
        }
      });

      const response = await request(app)
        .post('/governance/proposals/proposal-123/queue')
        .send({
          privateKey: mockPrivateKey
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        proposalId: 'proposal-123',
        status: 'QUEUED',
        queuedBy: 'mock-address-123',
        hash: 'mock-hash-123'
      });
    });
  });

  describe('POST /governance/proposals/:id/execute', () => {
    it('should execute proposal', async () => {
      const { getCheckpoint } = require('../../metagraph.js');
      getCheckpoint.mockResolvedValue({
        state: {
          stateMachines: {
            '12345678-1234-1234-1234-123456789012': {
              currentState: { value: 'PENDING' },
              stateData: {
                schema: 'Governance',
                proposal: {
                  id: 'proposal-123',
                  title: 'Test Proposal'
                }
              }
            }
          }
        }
      });

      const response = await request(app)
        .post('/governance/proposals/proposal-123/execute')
        .send({
          privateKey: mockPrivateKey
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        proposalId: 'proposal-123',
        status: 'EXECUTED',
        executor: 'mock-address-123',
        hash: 'mock-hash-123'
      });
    });

    it('should provide hint for TokenDAO queue requirement', async () => {
      const { getCheckpoint } = require('../../metagraph.js');
      getCheckpoint.mockResolvedValue({
        state: {
          stateMachines: {
            '12345678-1234-1234-1234-123456789012': {
              currentState: { value: 'VOTING' },
              stateData: {
                schema: 'TokenDAO',
                proposal: {
                  id: 'proposal-123',
                  title: 'Test Proposal'
                }
              }
            }
          }
        }
      });

      const response = await request(app)
        .post('/governance/proposals/proposal-123/execute')
        .send({
          privateKey: mockPrivateKey
        });

      expect(response.status).toBe(400);
      expect(response.body.hint).toContain('Call /governance/proposals/:id/queue first');
    });
  });

  describe('GET /governance/proposals/:id', () => {
    it('should get current proposal details', async () => {
      const { getCheckpoint } = require('../../metagraph.js');
      getCheckpoint.mockResolvedValue({
        state: {
          stateMachines: {
            '12345678-1234-1234-1234-123456789012': {
              currentState: { value: 'VOTING' },
              stateData: {
                proposal: {
                  id: 'proposal-123',
                  title: 'Test Proposal',
                  description: 'Test description',
                  proposer: 'mock-address-123',
                  actionType: 'treasury-spend',
                  payload: { amount: 1000 },
                  createdAt: '2024-01-01T00:00:00Z'
                },
                votes: {
                  'voter-1': { choice: 'for', weight: 3, timestamp: '2024-01-02T00:00:00Z' }
                }
              }
            }
          }
        }
      });

      const response = await request(app)
        .get('/governance/proposals/proposal-123');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: 'proposal-123',
        daoId: '12345678-1234-1234-1234-123456789012',
        title: 'Test Proposal',
        description: 'Test description',
        status: 'VOTING',
        proposer: 'mock-address-123',
        actionType: 'treasury-spend',
        payload: { amount: 1000 },
        votes: {
          'voter-1': { choice: 'for', weight: 3, timestamp: '2024-01-02T00:00:00Z' }
        }
      });
    });

    it('should find historical proposals', async () => {
      const { getCheckpoint } = require('../../metagraph.js');
      getCheckpoint.mockResolvedValue({
        state: {
          stateMachines: {
            '12345678-1234-1234-1234-123456789012': {
              stateData: {
                proposal: null,
                executedProposals: [
                  {
                    id: 'proposal-123',
                    title: 'Executed Proposal',
                    status: 'EXECUTED'
                  }
                ]
              }
            }
          }
        }
      });

      const response = await request(app)
        .get('/governance/proposals/proposal-123');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: 'proposal-123',
        title: 'Executed Proposal',
        status: 'EXECUTED'
      });
    });
  });

  describe('GET /governance/voting-power/:address', () => {
    it('should calculate voting power for TokenDAO', async () => {
      const { getStateMachine } = require('../../metagraph.js');
      getStateMachine.mockResolvedValue({
        stateData: {
          schema: 'TokenDAO',
          balances: {
            'test-address': 1000,
            'delegator-1': 500,
            'delegator-2': 300
          },
          delegations: {
            'delegator-1': {
              delegateTo: 'test-address',
              weight: 500,
              timestamp: '2024-01-01T00:00:00Z'
            },
            'delegator-2': {
              delegateTo: 'test-address',
              weight: 300,
              timestamp: '2024-01-02T00:00:00Z'
            }
          }
        }
      });

      const response = await request(app)
        .get('/governance/voting-power/test-address')
        .query({ daoId: '12345678-1234-1234-1234-123456789012' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        address: 'test-address',
        daoId: '12345678-1234-1234-1234-123456789012',
        directPower: 1000,
        delegatedPower: 800,
        totalPower: 1800,
        delegations: [
          { from: 'delegator-1', weight: 500 },
          { from: 'delegator-2', weight: 300 }
        ]
      });
    });

    it('should calculate voting power for MultisigDAO', async () => {
      const { getStateMachine } = require('../../metagraph.js');
      getStateMachine.mockResolvedValue({
        stateData: {
          schema: 'MultisigDAO',
          signers: ['signer-1', 'signer-2', 'test-address']
        }
      });

      const response = await request(app)
        .get('/governance/voting-power/test-address')
        .query({ daoId: '12345678-1234-1234-1234-123456789012' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        address: 'test-address',
        daoId: '12345678-1234-1234-1234-123456789012',
        directPower: 1,
        delegatedPower: 0,
        totalPower: 1
      });
    });

    it('should require daoId parameter', async () => {
      const response = await request(app)
        .get('/governance/voting-power/test-address');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('daoId query parameter is required');
    });
  });

  describe('GET /governance/treasury', () => {
    it('should get treasury status for TokenDAO', async () => {
      const { getStateMachine } = require('../../metagraph.js');
      getStateMachine.mockResolvedValue({
        stateData: {
          schema: 'TokenDAO',
          name: 'Test DAO',
          tokenId: 'token-123',
          balances: {
            'holder-1': 1000,
            'holder-2': 500,
            'holder-3': 300
          }
        }
      });

      const response = await request(app)
        .get('/governance/treasury')
        .query({ daoId: '12345678-1234-1234-1234-123456789012' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('daoId', '12345678-1234-1234-1234-123456789012');
      expect(response.body).toHaveProperty('stateData');
      expect(response.body.stateData).toHaveProperty('balances');
      expect(response.body.lastUpdated).toBeDefined();
    });

    it('should require daoId parameter', async () => {
      const response = await request(app)
        .get('/governance/treasury');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('daoId query parameter is required');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid private key format', async () => {
      const response = await request(app)
        .post('/governance/proposals')
        .send({
          privateKey: 'invalid-key',
          daoId: '12345678-1234-1234-1234-123456789012',
          title: 'Test'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should handle DAO not found', async () => {
      const { getStateMachine } = require('../../metagraph.js');
      getStateMachine.mockResolvedValue(null);

      const response = await request(app)
        .post('/governance/proposals')
        .send({
          privateKey: mockPrivateKey,
          daoId: '00000000-0000-0000-0000-000000000000', // Valid UUID format, but doesn't exist
          title: 'Test'
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('DAO not found');
    });

    it('should handle transaction submission errors', async () => {
      const { getStateMachine, submitTransaction } = require('../../metagraph.js');
      getStateMachine.mockResolvedValue(mockDAO);
      submitTransaction.mockRejectedValue(new Error('Network error'));

      const response = await request(app)
        .post('/governance/proposals')
        .send({
          privateKey: mockPrivateKey,
          daoId: '11111111-1111-1111-1111-111111111111', // Valid UUID format
          title: 'Test'
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Network error');
    });
  });
});