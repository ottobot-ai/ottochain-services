// Corporate Governance Routes
// Uses OttoChain metagraph state machines for on-chain corporate governance
// Core types: entity, board, shareholders, securities

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { 
  submitTransaction, 
  getStateMachine, 
  getCheckpoint, 
  keyPairFromPrivateKey,
  getFiberSequenceNumber,
  type StateMachineDefinition,
  type CreateStateMachine,
  type TransitionStateMachine,
  type FiberOrdinal,
} from '../metagraph.js';
import { getCorporateDefinition, EntityType } from '@ottochain/sdk/apps/corporate';
import { toProtoDefinition } from '@ottochain/sdk';

// ============================================================================
// Corporate State Machine Definitions (from SDK)
// ============================================================================

const CORPORATE_ENTITY_DEFINITION = toProtoDefinition(getCorporateDefinition('entity'));
const CORPORATE_BOARD_DEFINITION = toProtoDefinition(getCorporateDefinition('board'));
const CORPORATE_SHAREHOLDERS_DEFINITION = toProtoDefinition(getCorporateDefinition('shareholders'));
const CORPORATE_SECURITIES_DEFINITION = toProtoDefinition(getCorporateDefinition('securities'));

export const corporateRoutes: RouterType = Router();

// ============================================================================
// Request Schemas
// ============================================================================

const ENTITY_TYPES = [
  EntityType.ENTITY_TYPE_C_CORP,
  EntityType.ENTITY_TYPE_S_CORP,
  EntityType.ENTITY_TYPE_B_CORP,
  EntityType.ENTITY_TYPE_LLC,
  EntityType.ENTITY_TYPE_LP,
  EntityType.ENTITY_TYPE_LLP,
] as const;
const EntityTypeSchema = z.enum(ENTITY_TYPES);

const IncorporateRequestSchema = z.object({
  privateKey: z.string().length(64),
  legalName: z.string().min(1),
  entityType: EntityTypeSchema,
  jurisdiction: z.object({
    state: z.string().length(2),
    country: z.string().default('USA'),
  }),
  registeredAgent: z.object({
    name: z.string().min(1),
    address: z.object({
      street: z.string(),
      city: z.string(),
      state: z.string().length(2),
      zip: z.string(),
    }),
    email: z.string().email().optional(),
  }),
  incorporators: z.array(z.object({
    name: z.string().min(1),
    address: z.object({
      street: z.string(),
      city: z.string(),
      state: z.string().length(2),
      zip: z.string(),
    }),
  })).min(1),
  shareStructure: z.object({
    classes: z.array(z.object({
      className: z.string(),
      authorized: z.number().int().positive(),
      parValue: z.number().nonnegative(),
      votingRights: z.boolean().default(true),
      votesPerShare: z.number().default(1),
    })).min(1),
  }),
  fiscalYearEnd: z.string().regex(/^\d{2}-\d{2}$/).default('12-31'),
});

const ElectDirectorRequestSchema = z.object({
  privateKey: z.string().length(64),
  entityId: z.string().uuid(),
  boardId: z.string().uuid().optional(),
  directorId: z.string().uuid().optional(),
  name: z.string().min(1),
  email: z.string().email().optional(),
  termStart: z.string(),
  termEnd: z.string(),
  class: z.enum(['CLASS_I', 'CLASS_II', 'CLASS_III', 'UNCLASSIFIED']).optional(),
  isIndependent: z.boolean().default(false),
  electionResolutionRef: z.string().uuid(),
  isFillingVacancy: z.boolean().default(false),
});

const BoardMeetingRequestSchema = z.object({
  privateKey: z.string().length(64),
  entityId: z.string().uuid(),
  boardId: z.string().uuid().optional(),
  action: z.enum(['call', 'open', 'adjourn', 'record_attendance']),
  meetingType: z.enum(['REGULAR', 'SPECIAL', 'ANNUAL', 'ORGANIZATIONAL']).optional(),
  scheduledDate: z.string().optional(),
  location: z.string().optional(),
  isVirtual: z.boolean().optional(),
  agenda: z.array(z.string()).optional(),
  chairPresiding: z.string().optional(),
  directorId: z.string().optional(),
  present: z.boolean().optional(),
  minutesRef: z.string().optional(),
  resolutionsPassed: z.array(z.string()).optional(),
});

const IssueSharesRequestSchema = z.object({
  privateKey: z.string().length(64),
  entityId: z.string().uuid(),
  shareClass: z.string(),
  shareCount: z.number().int().positive(),
  holderId: z.string(),
  holderName: z.string(),
  holderType: z.enum(['INDIVIDUAL', 'ENTITY', 'TRUST']),
  issuanceDate: z.string(),
  issuancePrice: z.number().nonnegative().optional(),
  form: z.enum(['CERTIFICATED', 'BOOK_ENTRY', 'DRS']).default('BOOK_ENTRY'),
  boardResolutionRef: z.string().uuid(),
  consideration: z.object({
    type: z.enum(['CASH', 'PROPERTY', 'SERVICES', 'DEBT_CONVERSION', 'STOCK_CONVERSION']),
    value: z.number(),
    description: z.string().optional(),
  }),
  isRestricted: z.boolean().default(false),
  restrictionType: z.array(z.string()).optional(),
  exemptionUsed: z.string().optional(),
});

const TransferSharesRequestSchema = z.object({
  privateKey: z.string().length(64),
  securityId: z.string().uuid(),
  toHolderId: z.string(),
  toHolderName: z.string(),
  toHolderType: z.enum(['INDIVIDUAL', 'ENTITY', 'TRUST']),
  transferType: z.enum(['SALE', 'GIFT', 'INHERITANCE', 'INTERNAL']),
  transferDate: z.string(),
  pricePerShare: z.number().nonnegative().optional(),
});

const ShareholderMeetingRequestSchema = z.object({
  privateKey: z.string().length(64),
  entityId: z.string().uuid(),
  action: z.enum(['schedule_annual', 'schedule_special', 'set_record_date', 'open', 'open_polls', 'close_polls', 'certify']),
  scheduledDate: z.string().optional(),
  fiscalYear: z.number().int().optional(),
  location: z.object({
    physical: z.string().optional(),
    virtualUrl: z.string().optional(),
  }).optional(),
  purpose: z.string().optional(),
  recordDate: z.string().optional(),
  chairPerson: z.string().optional(),
  secretaryPresent: z.string().optional(),
  initialQuorumCount: z.number().int().optional(),
  results: z.array(z.object({
    agendaItemId: z.string(),
    result: z.enum(['APPROVED', 'REJECTED']),
  })).optional(),
  minutesRef: z.string().optional(),
});

// ============================================================================
// Entity Management Routes
// ============================================================================

/**
 * Incorporate a new corporate entity
 * Creates: entity fiber + board fiber (core governance)
 * POST /corporate/incorporate
 */
corporateRoutes.post('/incorporate', async (req, res) => {
  try {
    const input = IncorporateRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);
    const creatorAddress = keyPair.address;

    const entityId = randomUUID();
    const boardId = randomUUID();

    const totalAuthorized = input.shareStructure.classes.reduce((sum, c) => sum + c.authorized, 0);

    // Create the corporate entity fiber
    const entityMessage = {
      CreateStateMachine: {
        fiberId: entityId,
        definition: CORPORATE_ENTITY_DEFINITION,
        initialData: {
          schema: 'CorporateEntity',
          entityId,
          legalName: input.legalName,
          entityType: input.entityType,
          jurisdiction: input.jurisdiction,
          registeredAgent: {
            ...input.registeredAgent,
            effectiveDate: new Date().toISOString().split('T')[0],
          },
          incorporators: input.incorporators.map((inc) => ({
            ...inc,
            signatureDate: new Date().toISOString().split('T')[0],
          })),
          shareStructure: {
            classes: input.shareStructure.classes.map((cls) => ({
              classId: randomUUID(),
              ...cls,
              issued: 0,
              outstanding: 0,
              treasury: 0,
            })),
            totalAuthorized,
            totalIssued: 0,
            totalOutstanding: 0,
          },
          fiscalYearEnd: input.fiscalYearEnd,
          charterAmendments: [],
          createdBy: creatorAddress,
          createdAt: new Date().toISOString(),
          boardId,
        },
        parentFiberId: null,
      },
    };

    // Create the board fiber
    const boardMessage = {
      CreateStateMachine: {
        fiberId: boardId,
        definition: CORPORATE_BOARD_DEFINITION,
        initialData: {
          schema: 'CorporateBoard',
          boardId,
          entityId,
          directors: [],
          seats: {
            authorized: 3,
            filled: 0,
            vacant: 3,
          },
          boardStructure: {
            isClassified: false,
            termYears: 1,
          },
          quorumRules: {
            type: 'MAJORITY',
            threshold: 0.5,
          },
          votingRules: {
            standardApproval: 'MAJORITY_PRESENT',
          },
          currentMeeting: null,
          meetingHistory: [],
          createdAt: new Date().toISOString(),
        },
        parentFiberId: entityId,
      },
    };

    console.log(`[corporate/incorporate] Creating ${input.entityType}: ${input.legalName}`);
    console.log(`  Entity: ${entityId}`);
    console.log(`  Board: ${boardId}`);
    console.log(`  Creator: ${creatorAddress}`);

    const results = await Promise.all([
      submitTransaction(entityMessage, input.privateKey),
      submitTransaction(boardMessage, input.privateKey),
    ]);

    res.status(201).json({
      entityId,
      boardId,
      legalName: input.legalName,
      entityType: input.entityType,
      jurisdiction: input.jurisdiction,
      creator: creatorAddress,
      hashes: results.map(r => r.hash),
      message: 'Corporate entity created in INCORPORATING state.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/incorporate] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Incorporation failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get entity state
 * GET /corporate/entity/:entityId
 */
corporateRoutes.get('/entity/:entityId', async (req, res) => {
  try {
    const { entityId } = req.params;
    const state = await getStateMachine(entityId);
    
    if (!state) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    res.json(state);
  } catch (err) {
    console.error('[corporate/entity] Error:', err);
    res.status(500).json({ error: 'Failed to get entity' });
  }
});

// ============================================================================
// Board Routes
// ============================================================================

/**
 * Elect a director
 * POST /corporate/board/elect
 */
corporateRoutes.post('/board/elect', async (req, res) => {
  try {
    const input = ElectDirectorRequestSchema.parse(req.body);
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    // Get entity to find boardId if not provided
    let boardId = input.boardId;
    if (!boardId) {
      const entityState = await getStateMachine(input.entityId) as {
        stateData?: { boardId?: string };
      } | null;
      boardId = entityState?.stateData?.boardId;
      if (!boardId) {
        return res.status(400).json({ error: 'boardId not found on entity' });
      }
    }

    const boardState = await getStateMachine(boardId) as {
      sequenceNumber?: number;
      currentState?: string;
    } | null;

    if (!boardState) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const directorId = input.directorId || randomUUID();
    const targetSequenceNumber = await getFiberSequenceNumber(boardId);

    const message = {
      TransitionStateMachine: {
        fiberId: boardId,
        eventName: 'elect_director',
        payload: {
          directorId,
          name: input.name,
          email: input.email,
          termStart: input.termStart,
          termEnd: input.termEnd,
          class: input.class ?? 'UNCLASSIFIED',
          isIndependent: input.isIndependent,
          electionResolutionRef: input.electionResolutionRef,
          isFillingVacancy: input.isFillingVacancy,
          electedBy: callerAddress,
          electedAt: new Date().toISOString(),
        },
        targetSequenceNumber,
      },
    };

    console.log(`[corporate/board/elect] Electing director ${input.name} to board ${boardId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      directorId,
      boardId,
      name: input.name,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/board/elect] Error:', err);
    res.status(500).json({ error: 'Failed to elect director' });
  }
});

/**
 * Board meeting operations
 * POST /corporate/board/meeting
 */
corporateRoutes.post('/board/meeting', async (req, res) => {
  try {
    const input = BoardMeetingRequestSchema.parse(req.body);
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    let boardId = input.boardId;
    if (!boardId) {
      const entityState = await getStateMachine(input.entityId) as {
        stateData?: { boardId?: string };
      } | null;
      boardId = entityState?.stateData?.boardId;
      if (!boardId) {
        return res.status(400).json({ error: 'boardId not found on entity' });
      }
    }

    const targetSequenceNumber = await getFiberSequenceNumber(boardId);
    
    let eventName: string;
    let payload: Record<string, unknown>;

    switch (input.action) {
      case 'call':
        eventName = 'call_meeting';
        payload = {
          meetingId: randomUUID(),
          meetingType: input.meetingType || 'REGULAR',
          scheduledDate: input.scheduledDate,
          location: input.location,
          isVirtual: input.isVirtual,
          agenda: input.agenda || [],
          calledBy: callerAddress,
        };
        break;
      case 'open':
        eventName = 'open_meeting';
        payload = {
          chairPresiding: input.chairPresiding,
          openedAt: new Date().toISOString(),
        };
        break;
      case 'record_attendance':
        eventName = 'record_attendance';
        payload = {
          directorId: input.directorId,
          present: input.present,
        };
        break;
      case 'adjourn':
        eventName = 'adjourn_meeting';
        payload = {
          minutesRef: input.minutesRef,
          resolutionsPassed: input.resolutionsPassed || [],
          adjournedAt: new Date().toISOString(),
        };
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    const message = {
      TransitionStateMachine: {
        fiberId: boardId,
        eventName,
        payload,
        targetSequenceNumber,
      },
    };

    console.log(`[corporate/board/meeting] ${input.action} for board ${boardId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      boardId,
      action: input.action,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/board/meeting] Error:', err);
    res.status(500).json({ error: 'Meeting operation failed' });
  }
});

/**
 * Get board state
 * GET /corporate/board/:boardId
 */
corporateRoutes.get('/board/:boardId', async (req, res) => {
  try {
    const { boardId } = req.params;
    const state = await getStateMachine(boardId);
    
    if (!state) {
      return res.status(404).json({ error: 'Board not found' });
    }

    res.json(state);
  } catch (err) {
    console.error('[corporate/board] Error:', err);
    res.status(500).json({ error: 'Failed to get board' });
  }
});

// ============================================================================
// Shareholders Routes
// ============================================================================

/**
 * Create shareholders fiber for an entity
 * POST /corporate/shareholders/create
 */
corporateRoutes.post('/shareholders/create', async (req, res) => {
  try {
    const schema = z.object({
      privateKey: z.string().length(64),
      entityId: z.string().uuid(),
    });
    const input = schema.parse(req.body);
    
    const shareholdersId = randomUUID();
    
    const message = {
      CreateStateMachine: {
        fiberId: shareholdersId,
        definition: CORPORATE_SHAREHOLDERS_DEFINITION,
        initialData: {
          schema: 'CorporateShareholders',
          shareholdersId,
          entityId: input.entityId,
          shareholders: [],
          currentMeeting: null,
          meetingHistory: [],
          createdAt: new Date().toISOString(),
        },
        parentFiberId: input.entityId,
      },
    };

    console.log(`[corporate/shareholders/create] Creating for entity ${input.entityId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      shareholdersId,
      entityId: input.entityId,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/shareholders/create] Error:', err);
    res.status(500).json({ error: 'Failed to create shareholders fiber' });
  }
});

/**
 * Shareholder meeting operations
 * POST /corporate/shareholders/meeting
 */
corporateRoutes.post('/shareholders/meeting', async (req, res) => {
  try {
    const input = ShareholderMeetingRequestSchema.parse(req.body);
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    // Find or create shareholders fiber
    const entityState = await getStateMachine(input.entityId) as {
      stateData?: { shareholdersId?: string };
    } | null;
    
    const shareholdersId = entityState?.stateData?.shareholdersId;
    if (!shareholdersId) {
      return res.status(400).json({ error: 'shareholdersId not found - create shareholders fiber first' });
    }

    const targetSequenceNumber = await getFiberSequenceNumber(shareholdersId);
    
    let eventName: string;
    let payload: Record<string, unknown>;

    switch (input.action) {
      case 'schedule_annual':
        eventName = 'schedule_annual';
        payload = {
          meetingId: randomUUID(),
          scheduledDate: input.scheduledDate,
          fiscalYear: input.fiscalYear,
          location: input.location,
          scheduledBy: callerAddress,
        };
        break;
      case 'schedule_special':
        eventName = 'schedule_special';
        payload = {
          meetingId: randomUUID(),
          scheduledDate: input.scheduledDate,
          purpose: input.purpose,
          location: input.location,
          scheduledBy: callerAddress,
        };
        break;
      case 'open':
        eventName = 'open_meeting';
        payload = {
          chairPerson: input.chairPerson,
          secretaryPresent: input.secretaryPresent,
          initialQuorumCount: input.initialQuorumCount,
          openedAt: new Date().toISOString(),
        };
        break;
      case 'certify':
        eventName = 'certify_results';
        payload = {
          results: input.results,
          minutesRef: input.minutesRef,
          certifiedAt: new Date().toISOString(),
          certifiedBy: callerAddress,
        };
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    const message = {
      TransitionStateMachine: {
        fiberId: shareholdersId,
        eventName,
        payload,
        targetSequenceNumber,
      },
    };

    console.log(`[corporate/shareholders/meeting] ${input.action} for ${shareholdersId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      shareholdersId,
      action: input.action,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/shareholders/meeting] Error:', err);
    res.status(500).json({ error: 'Meeting operation failed' });
  }
});

// ============================================================================
// Securities Routes
// ============================================================================

/**
 * Create securities fiber for an entity
 * POST /corporate/securities/create
 */
corporateRoutes.post('/securities/create', async (req, res) => {
  try {
    const schema = z.object({
      privateKey: z.string().length(64),
      entityId: z.string().uuid(),
    });
    const input = schema.parse(req.body);
    
    const securitiesId = randomUUID();
    
    const message = {
      CreateStateMachine: {
        fiberId: securitiesId,
        definition: CORPORATE_SECURITIES_DEFINITION,
        initialData: {
          schema: 'CorporateSecurities',
          securitiesId,
          entityId: input.entityId,
          securities: [],
          transferHistory: [],
          createdAt: new Date().toISOString(),
        },
        parentFiberId: input.entityId,
      },
    };

    console.log(`[corporate/securities/create] Creating for entity ${input.entityId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      securitiesId,
      entityId: input.entityId,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/securities/create] Error:', err);
    res.status(500).json({ error: 'Failed to create securities fiber' });
  }
});

/**
 * Issue shares
 * POST /corporate/securities/issue
 */
corporateRoutes.post('/securities/issue', async (req, res) => {
  try {
    const input = IssueSharesRequestSchema.parse(req.body);
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const entityState = await getStateMachine(input.entityId) as {
      stateData?: { securitiesId?: string };
    } | null;
    
    const securitiesId = entityState?.stateData?.securitiesId;
    if (!securitiesId) {
      return res.status(400).json({ error: 'securitiesId not found - create securities fiber first' });
    }

    const targetSequenceNumber = await getFiberSequenceNumber(securitiesId);
    const securityId = randomUUID();

    const message = {
      TransitionStateMachine: {
        fiberId: securitiesId,
        eventName: 'issue',
        payload: {
          securityId,
          shareClass: input.shareClass,
          shareCount: input.shareCount,
          holderId: input.holderId,
          holderName: input.holderName,
          holderType: input.holderType,
          issuanceDate: input.issuanceDate,
          issuancePrice: input.issuancePrice,
          form: input.form,
          boardResolutionRef: input.boardResolutionRef,
          consideration: input.consideration,
          isRestricted: input.isRestricted,
          restrictionType: input.restrictionType,
          exemptionUsed: input.exemptionUsed,
          issuedBy: callerAddress,
        },
        targetSequenceNumber,
      },
    };

    console.log(`[corporate/securities/issue] Issuing ${input.shareCount} ${input.shareClass} shares`);

    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      securityId,
      securitiesId,
      shareClass: input.shareClass,
      shareCount: input.shareCount,
      holderId: input.holderId,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/securities/issue] Error:', err);
    res.status(500).json({ error: 'Failed to issue shares' });
  }
});

/**
 * Transfer shares
 * POST /corporate/securities/transfer
 */
corporateRoutes.post('/securities/transfer', async (req, res) => {
  try {
    const input = TransferSharesRequestSchema.parse(req.body);
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    // Get the security to find its parent securitiesId
    const securityState = await getStateMachine(input.securityId) as {
      stateData?: { securitiesId?: string };
      parentFiberId?: string;
    } | null;

    if (!securityState) {
      return res.status(404).json({ error: 'Security not found' });
    }

    const securitiesId = securityState.parentFiberId || securityState.stateData?.securitiesId;
    if (!securitiesId) {
      return res.status(400).json({ error: 'securitiesId not found on security' });
    }

    const targetSequenceNumber = await getFiberSequenceNumber(securitiesId);

    const message = {
      TransitionStateMachine: {
        fiberId: securitiesId,
        eventName: 'transfer',
        payload: {
          securityId: input.securityId,
          toHolderId: input.toHolderId,
          toHolderName: input.toHolderName,
          toHolderType: input.toHolderType,
          transferType: input.transferType,
          transferDate: input.transferDate,
          pricePerShare: input.pricePerShare,
          transferredBy: callerAddress,
        },
        targetSequenceNumber,
      },
    };

    console.log(`[corporate/securities/transfer] Transferring ${input.securityId} to ${input.toHolderId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      securityId: input.securityId,
      toHolderId: input.toHolderId,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/securities/transfer] Error:', err);
    res.status(500).json({ error: 'Failed to transfer shares' });
  }
});

/**
 * Get securities state
 * GET /corporate/securities/:securitiesId
 */
corporateRoutes.get('/securities/:securitiesId', async (req, res) => {
  try {
    const { securitiesId } = req.params;
    const state = await getStateMachine(securitiesId);
    
    if (!state) {
      return res.status(404).json({ error: 'Securities not found' });
    }

    res.json(state);
  } catch (err) {
    console.error('[corporate/securities] Error:', err);
    res.status(500).json({ error: 'Failed to get securities' });
  }
});
