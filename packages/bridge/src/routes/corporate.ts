// Corporate Governance Routes
// Uses OttoChain metagraph state machines for on-chain corporate governance
// Covers: entity formation, board, shareholders, officers, securities, compliance

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { 
  submitTransaction, 
  getStateMachine, 
  getCheckpoint, 
  keyPairFromPrivateKey,
  type StateMachineDefinition,
  type CreateStateMachine,
  type TransitionStateMachine,
  type FiberOrdinal,
} from '../metagraph.js';
import { getCorporateDefinition } from '@ottochain/sdk/apps/corporate';

// ============================================================================
// Corporate State Machine Definitions (from SDK)
// ============================================================================

const CORPORATE_ENTITY_DEFINITION = getCorporateDefinition('Entity');
const CORPORATE_BOARD_DEFINITION = getCorporateDefinition('Board');
const CORPORATE_SHAREHOLDERS_DEFINITION = getCorporateDefinition('Shareholders');
const CORPORATE_OFFICERS_DEFINITION = getCorporateDefinition('Officers');
const CORPORATE_SECURITIES_DEFINITION = getCorporateDefinition('Securities');
const CORPORATE_COMPLIANCE_DEFINITION = getCorporateDefinition('Compliance');
const CORPORATE_PROXY_DEFINITION = getCorporateDefinition('Proxy');
const CORPORATE_RESOLUTION_DEFINITION = getCorporateDefinition('Resolution');

export const corporateRoutes: RouterType = Router();

// ============================================================================
// Request Schemas
// ============================================================================

// Entity Management
const EntityTypeSchema = z.enum(['C_CORP', 'S_CORP', 'B_CORP', 'LLC', 'LP', 'LLP']);

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

const AmendCharterRequestSchema = z.object({
  privateKey: z.string().length(64),
  entityId: z.string().uuid(),
  amendmentType: z.enum(['NAME_CHANGE', 'SHARE_AUTHORIZATION', 'PURPOSE_CHANGE', 'OTHER']),
  description: z.string().min(1),
  resolutionRef: z.string().uuid(),
  effectiveDate: z.string(),
  newLegalName: z.string().optional(),
  newShareAuthorization: z.object({
    className: z.string(),
    newAuthorized: z.number().int().positive(),
  }).optional(),
});

// Board Operations
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
  // For call
  meetingType: z.enum(['REGULAR', 'SPECIAL', 'ANNUAL', 'ORGANIZATIONAL']).optional(),
  scheduledDate: z.string().optional(),
  location: z.string().optional(),
  isVirtual: z.boolean().optional(),
  agenda: z.array(z.string()).optional(),
  // For open
  chairPresiding: z.string().optional(),
  // For record_attendance
  directorId: z.string().optional(),
  present: z.boolean().optional(),
  // For adjourn
  minutesRef: z.string().optional(),
  resolutionsPassed: z.array(z.string()).optional(),
});

const BoardResolutionRequestSchema = z.object({
  privateKey: z.string().length(64),
  entityId: z.string().uuid(),
  title: z.string().min(1),
  category: z.enum([
    'OFFICER_APPOINTMENT', 'OFFICER_REMOVAL', 'STOCK_ISSUANCE', 'DIVIDEND_DECLARATION',
    'CONTRACT_APPROVAL', 'BANKING', 'CHARTER_AMENDMENT', 'BYLAW_AMENDMENT',
    'MERGER_ACQUISITION', 'DISSOLUTION', 'COMMITTEE_ACTION', 'COMPENSATION',
    'AUDIT', 'GENERAL', 'OTHER'
  ]),
  resolvedText: z.string().min(1),
  boardId: z.string().uuid().optional(),
  meetingId: z.string().uuid().optional(),
});

const WrittenConsentRequestSchema = z.object({
  privateKey: z.string().length(64),
  entityId: z.string().uuid(),
  resolutionId: z.string().uuid(),
  consent: z.enum(['FOR', 'AGAINST', 'ABSTAIN']),
});

// Shareholder Operations
const ShareholderMeetingRequestSchema = z.object({
  privateKey: z.string().length(64),
  entityId: z.string().uuid(),
  action: z.enum(['schedule_annual', 'schedule_special', 'set_record_date', 'open', 'open_polls', 'close_polls', 'certify']),
  // For scheduling
  scheduledDate: z.string().optional(),
  fiscalYear: z.number().int().optional(),
  location: z.object({
    physical: z.string().optional(),
    virtualUrl: z.string().optional(),
  }).optional(),
  purpose: z.string().optional(), // For special meetings
  // For set_record_date
  recordDate: z.string().optional(),
  // For open
  chairPerson: z.string().optional(),
  secretaryPresent: z.string().optional(),
  initialQuorumCount: z.number().int().optional(),
  // For certify
  results: z.array(z.object({
    agendaItemId: z.string(),
    result: z.enum(['APPROVED', 'REJECTED']),
  })).optional(),
  minutesRef: z.string().optional(),
});

const ShareholderVoteRequestSchema = z.object({
  privateKey: z.string().length(64),
  meetingId: z.string().uuid(),
  agendaItemId: z.string(),
  shareholderId: z.string(),
  shareClass: z.string(),
  votesFor: z.number().int().default(0),
  votesAgainst: z.number().int().default(0),
  votesAbstain: z.number().int().default(0),
  votesWithhold: z.number().int().default(0),
  viaProxy: z.boolean().default(false),
});

const ProxyRequestSchema = z.object({
  privateKey: z.string().length(64),
  entityId: z.string().uuid(),
  action: z.enum(['grant', 'revoke', 'use']),
  // For grant
  grantorId: z.string().optional(),
  grantorName: z.string().optional(),
  grantorShares: z.array(z.object({
    shareClass: z.string(),
    shares: z.number().int().positive(),
    votes: z.number().int().positive(),
  })).optional(),
  holderId: z.string().optional(),
  holderName: z.string().optional(),
  meetingId: z.string().uuid().optional(),
  expirationDate: z.string().optional(),
  votingInstructions: z.array(z.object({
    agendaItemId: z.string(),
    instruction: z.enum(['FOR', 'AGAINST', 'ABSTAIN', 'DISCRETIONARY']),
  })).optional(),
  // For revoke/use
  proxyId: z.string().uuid().optional(),
});

// Officer Operations
const AppointOfficerRequestSchema = z.object({
  privateKey: z.string().length(64),
  entityId: z.string().uuid(),
  name: z.string().min(1),
  title: z.enum([
    'CEO', 'PRESIDENT', 'COO', 'CFO', 'CTO', 'CLO', 'SECRETARY', 'TREASURER',
    'VP', 'SVP', 'EVP', 'GENERAL_COUNSEL', 'CONTROLLER',
    'ASSISTANT_SECRETARY', 'ASSISTANT_TREASURER', 'OTHER'
  ]),
  customTitle: z.string().optional(),
  appointedDate: z.string(),
  appointmentResolutionRef: z.string().uuid(),
  reportsTo: z.string().uuid().optional(),
  authorityLevel: z.enum(['FULL', 'LIMITED', 'SPECIFIC']).default('LIMITED'),
  spendingLimit: z.number().optional(),
  isInterim: z.boolean().default(false),
});

const RemoveOfficerRequestSchema = z.object({
  privateKey: z.string().length(64),
  entityId: z.string().uuid(),
  officerId: z.string().uuid(),
  effectiveDate: z.string(),
  reason: z.enum(['WITH_CAUSE', 'WITHOUT_CAUSE', 'REORGANIZATION']),
  removalResolutionRef: z.string().uuid(),
});

// Securities Operations
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

// Compliance Operations
const FileComplianceRequestSchema = z.object({
  privateKey: z.string().length(64),
  entityId: z.string().uuid(),
  filingType: z.enum([
    'ANNUAL_REPORT', 'BIENNIAL_REPORT', 'FRANCHISE_TAX', 'STATEMENT_OF_INFORMATION',
    'REGISTERED_AGENT_UPDATE', 'BENEFICIAL_OWNERSHIP', 'OTHER'
  ]),
  jurisdiction: z.string().length(2),
  filedDate: z.string(),
  periodCovered: z.string(),
  confirmationNumber: z.string(),
  feePaid: z.number().nonnegative(),
  filedBy: z.string(),
  documentRef: z.string().optional(),
  nextDueDate: z.string().optional(),
});
// ============================================================================
// Entity Management Routes
// ============================================================================

/**
 * Incorporate a new corporate entity
 * POST /corporate/incorporate
 */
corporateRoutes.post('/incorporate', async (req, res) => {
  try {
    const input = IncorporateRequestSchema.parse(req.body);
    const keyPair = keyPairFromPrivateKey(input.privateKey);
    const creatorAddress = keyPair.address;

    const entityId = randomUUID();
    const boardId = randomUUID();
    const officersId = randomUUID();
    const complianceId = randomUUID();

    // Calculate total authorized shares
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
          incorporators: input.incorporators.map((inc, idx) => ({
            ...inc,
            signatureDate: new Date().toISOString().split('T')[0],
          })),
          shareStructure: {
            classes: input.shareStructure.classes.map((cls, idx) => ({
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
          // Cross-references
          boardId,
          officersId,
          complianceId,
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
            authorized: 3, // Default
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

    // Create officers fiber
    const officersMessage = {
      CreateStateMachine: {
        fiberId: officersId,
        definition: CORPORATE_OFFICERS_DEFINITION,
        initialData: {
          schema: 'CorporateOfficers',
          officersInstanceId: officersId,
          entityId,
          officers: [],
          vacantPositions: ['CEO', 'CFO', 'SECRETARY'],
          createdAt: new Date().toISOString(),
        },
        parentFiberId: entityId,
      },
    };

    // Create compliance fiber
    const complianceMessage = {
      CreateStateMachine: {
        fiberId: complianceId,
        definition: CORPORATE_COMPLIANCE_DEFINITION,
        initialData: {
          schema: 'CorporateCompliance',
          complianceId,
          entityId,
          jurisdiction: input.jurisdiction,
          registeredAgents: [{
            jurisdiction: input.jurisdiction.state,
            agentName: input.registeredAgent.name,
            agentAddress: input.registeredAgent.address,
            effectiveDate: new Date().toISOString().split('T')[0],
            isThirdParty: false,
          }],
          filingCalendar: [],
          deficiencies: [],
          filingHistory: [],
          goodStandingCertificates: [],
          complianceScore: {
            overallStatus: 'GREEN',
            openDeficiencies: 0,
            overdueFilings: 0,
            upcomingDeadlines30Days: 0,
            lastAssessedDate: new Date().toISOString().split('T')[0],
          },
          createdAt: new Date().toISOString(),
        },
        parentFiberId: entityId,
      },
    };

    console.log(`[corporate/incorporate] Creating ${input.entityType}: ${input.legalName}`);
    console.log(`  Entity: ${entityId}`);
    console.log(`  Board: ${boardId}`);
    console.log(`  Officers: ${officersId}`);
    console.log(`  Compliance: ${complianceId}`);
    console.log(`  Creator: ${creatorAddress}`);

    // Submit all fibers
    const results = await Promise.all([
      submitTransaction(entityMessage, input.privateKey),
      submitTransaction(boardMessage, input.privateKey),
      submitTransaction(officersMessage, input.privateKey),
      submitTransaction(complianceMessage, input.privateKey),
    ]);

    res.status(201).json({
      entityId,
      boardId,
      officersId,
      complianceId,
      legalName: input.legalName,
      entityType: input.entityType,
      jurisdiction: input.jurisdiction,
      creator: creatorAddress,
      hashes: results.map(r => r.hash),
      message: 'Corporate entity created in INCORPORATING state. File with state to transition to ACTIVE.',
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
 * Amend the charter/articles of incorporation
 * POST /corporate/amend-charter
 */
corporateRoutes.post('/amend-charter', async (req, res) => {
  try {
    const input = AmendCharterRequestSchema.parse(req.body);
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const state = await getStateMachine(input.entityId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
    } | null;

    if (!state) {
      return res.status(404).json({ error: 'Corporate entity not found' });
    }

    if (state.currentState?.value !== 'ACTIVE') {
      return res.status(400).json({
        error: 'Entity must be in ACTIVE state to amend charter',
        currentState: state.currentState?.value,
      });
    }

    const amendmentId = randomUUID();

    const message = {
      TransitionStateMachine: {
        fiberId: input.entityId,
        eventName: 'amend_charter',
        payload: {
          agent: callerAddress,
          amendmentId,
          description: input.description,
          amendmentType: input.amendmentType,
          resolutionRef: input.resolutionRef,
          effectiveDate: input.effectiveDate,
          newLegalName: input.newLegalName,
          newShareAuthorization: input.newShareAuthorization,
        },
        targetSequenceNumber: state.sequenceNumber ?? 0,
      },
    };

    console.log(`[corporate/amend-charter] ${callerAddress} amending ${input.entityId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      entityId: input.entityId,
      amendmentId,
      amendmentType: input.amendmentType,
      hash: result.hash,
      message: 'Charter amendment recorded',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/amend-charter] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Amendment failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get corporate entity state
 * GET /corporate/:entityId
 */
corporateRoutes.get('/:entityId', async (req, res) => {
  try {
    const state = await getStateMachine(req.params.entityId);
    if (!state) {
      return res.status(404).json({ error: 'Corporate entity not found' });
    }
    res.json(state);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Query failed';
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// Board Operations Routes
// ============================================================================

/**
 * Elect a director
 * POST /corporate/:entityId/board/elect
 */
corporateRoutes.post('/:entityId/board/elect', async (req, res) => {
  try {
    const input = ElectDirectorRequestSchema.parse({ ...req.body, entityId: req.params.entityId });
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    // Get entity to find board ID
    const entityState = await getStateMachine(input.entityId) as {
      stateData?: { boardId?: string };
    } | null;

    if (!entityState) {
      return res.status(404).json({ error: 'Corporate entity not found' });
    }

    const boardId = input.boardId ?? entityState.stateData?.boardId;
    if (!boardId) {
      return res.status(400).json({ error: 'Board ID not found. Provide boardId or ensure entity has associated board.' });
    }

    const boardState = await getStateMachine(boardId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
    } | null;

    if (!boardState) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const directorId = input.directorId ?? randomUUID();

    const message = {
      TransitionStateMachine: {
        fiberId: boardId,
        eventName: 'elect_director',
        payload: {
          agent: callerAddress,
          directorId,
          name: input.name,
          email: input.email,
          termStart: input.termStart,
          termEnd: input.termEnd,
          class: input.class ?? 'UNCLASSIFIED',
          isIndependent: input.isIndependent,
          electionResolutionRef: input.electionResolutionRef,
          isFillingVacancy: input.isFillingVacancy,
        },
        targetSequenceNumber: boardState.sequenceNumber ?? 0,
      },
    };

    console.log(`[corporate/board/elect] Electing ${input.name} to board ${boardId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      entityId: input.entityId,
      boardId,
      directorId,
      name: input.name,
      hash: result.hash,
      message: 'Director elected',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/board/elect] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Election failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Board meeting operations (call, open, adjourn, record_attendance)
 * POST /corporate/:entityId/board/meeting
 */
corporateRoutes.post('/:entityId/board/meeting', async (req, res) => {
  try {
    const input = BoardMeetingRequestSchema.parse({ ...req.body, entityId: req.params.entityId });
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const entityState = await getStateMachine(input.entityId) as {
      stateData?: { boardId?: string };
    } | null;

    if (!entityState) {
      return res.status(404).json({ error: 'Corporate entity not found' });
    }

    const boardId = input.boardId ?? entityState.stateData?.boardId;
    if (!boardId) {
      return res.status(400).json({ error: 'Board ID not found' });
    }

    const boardState = await getStateMachine(boardId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
    } | null;

    if (!boardState) {
      return res.status(404).json({ error: 'Board not found' });
    }

    let eventName: string;
    let payload: Record<string, unknown>;

    switch (input.action) {
      case 'call':
        eventName = 'call_meeting';
        payload = {
          agent: callerAddress,
          meetingId: randomUUID(),
          type: input.meetingType ?? 'REGULAR',
          scheduledDate: input.scheduledDate,
          location: input.location,
          isVirtual: input.isVirtual ?? false,
          noticeDate: new Date().toISOString().split('T')[0],
          agenda: input.agenda ?? [],
        };
        break;

      case 'record_attendance':
        eventName = 'record_attendance';
        payload = {
          agent: callerAddress,
          directorId: input.directorId,
          present: input.present ?? true,
          arrivedAt: new Date().toISOString(),
        };
        break;

      case 'open':
        eventName = 'open_meeting';
        payload = {
          agent: callerAddress,
          openedAt: new Date().toISOString(),
          chairPresiding: input.chairPresiding,
        };
        break;

      case 'adjourn':
        eventName = 'adjourn';
        payload = {
          agent: callerAddress,
          closedAt: new Date().toISOString(),
          minutesRef: input.minutesRef,
          resolutionsPassed: input.resolutionsPassed ?? [],
        };
        break;

      default:
        return res.status(400).json({ error: `Unknown action: ${input.action}` });
    }

    const message = {
      TransitionStateMachine: {
        fiberId: boardId,
        eventName,
        payload,
        targetSequenceNumber: boardState.sequenceNumber ?? 0,
      },
    };

    console.log(`[corporate/board/meeting] ${input.action} on board ${boardId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      entityId: input.entityId,
      boardId,
      action: input.action,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/board/meeting] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Meeting action failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Pass a board resolution
 * POST /corporate/:entityId/board/resolution
 */
corporateRoutes.post('/:entityId/board/resolution', async (req, res) => {
  try {
    const input = BoardResolutionRequestSchema.parse({ ...req.body, entityId: req.params.entityId });
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const resolutionId = randomUUID();
    const resolutionNumber = `${new Date().getFullYear()}-B-${Date.now().toString(36).toUpperCase()}`;

    const message = {
      CreateStateMachine: {
        fiberId: resolutionId,
        definition: CORPORATE_RESOLUTION_DEFINITION,
        initialData: {
          schema: 'CorporateResolution',
          resolutionId,
          entityId: input.entityId,
          resolutionNumber,
          title: input.title,
          resolutionType: 'BOARD_RESOLUTION',
          category: input.category,
          proposedDate: new Date().toISOString().split('T')[0],
          proposedBy: {
            type: 'DIRECTOR',
            personId: callerAddress,
            name: callerAddress,
          },
          resolvedText: input.resolvedText,
          approvalRequirements: {
            approverType: 'BOARD',
            threshold: 'MAJORITY_PRESENT',
            quorumRequired: true,
          },
          meetingRef: input.meetingId ? {
            meetingType: 'BOARD_MEETING',
            meetingId: input.meetingId,
          } : null,
          voting: {
            votes: [],
          },
          attachments: [],
          createdAt: new Date().toISOString(),
        },
        parentFiberId: input.entityId,
      },
    };

    console.log(`[corporate/board/resolution] Creating resolution ${resolutionNumber}`);

    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      resolutionId,
      resolutionNumber,
      entityId: input.entityId,
      title: input.title,
      hash: result.hash,
      message: 'Resolution created in DRAFT state',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/board/resolution] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Resolution creation failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Written consent (unanimous or majority)
 * POST /corporate/:entityId/board/consent
 */
corporateRoutes.post('/:entityId/board/consent', async (req, res) => {
  try {
    const input = WrittenConsentRequestSchema.parse({ ...req.body, entityId: req.params.entityId });
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const resolutionState = await getStateMachine(input.resolutionId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
    } | null;

    if (!resolutionState) {
      return res.status(404).json({ error: 'Resolution not found' });
    }

    const message = {
      TransitionStateMachine: {
        fiberId: input.resolutionId,
        eventName: 'cast_vote',
        payload: {
          voterId: callerAddress,
          voterName: callerAddress,
          voterType: 'DIRECTOR',
          vote: input.consent,
        },
        targetSequenceNumber: resolutionState.sequenceNumber ?? 0,
      },
    };

    console.log(`[corporate/board/consent] ${callerAddress} consenting to ${input.resolutionId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      resolutionId: input.resolutionId,
      voter: callerAddress,
      consent: input.consent,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/board/consent] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Consent failed';
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// Shareholder Operations Routes
// ============================================================================

/**
 * Shareholder meeting operations
 * POST /corporate/:entityId/shareholders/meeting
 */
corporateRoutes.post('/:entityId/shareholders/meeting', async (req, res) => {
  try {
    const input = ShareholderMeetingRequestSchema.parse({ ...req.body, entityId: req.params.entityId });
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    // For scheduling, create a new meeting fiber
    if (input.action === 'schedule_annual' || input.action === 'schedule_special') {
      const meetingId = randomUUID();

      const message = {
        CreateStateMachine: {
          fiberId: meetingId,
          definition: CORPORATE_SHAREHOLDERS_DEFINITION,
          initialData: {
            schema: 'ShareholdersMeeting',
            meetingId,
            entityId: input.entityId,
            meetingType: input.action === 'schedule_annual' ? 'ANNUAL' : 'SPECIAL',
            fiscalYear: input.fiscalYear,
            scheduledDate: input.scheduledDate,
            location: input.location,
            calledBy: {
              type: 'BOARD',
            },
            eligibleVoters: [],
            quorumRequirements: {
              type: 'SHARES_REPRESENTED',
              threshold: 0.5,
              sharesRequired: 0,
              sharesRepresented: 0,
              quorumMet: false,
            },
            agenda: [],
            votes: [],
            voteTallies: [],
            createdAt: new Date().toISOString(),
          },
          parentFiberId: input.entityId,
        },
      };

      console.log(`[corporate/shareholders/meeting] Scheduling ${input.action === 'schedule_annual' ? 'annual' : 'special'} meeting`);

      const result = await submitTransaction(message, input.privateKey);

      return res.status(201).json({
        meetingId,
        entityId: input.entityId,
        meetingType: input.action === 'schedule_annual' ? 'ANNUAL' : 'SPECIAL',
        scheduledDate: input.scheduledDate,
        hash: result.hash,
      });
    }

    // For other actions, we need an existing meeting
    // Get most recent meeting for this entity (simplified - in production would need query)
    return res.status(400).json({
      error: `Action ${input.action} requires meetingId in request body`,
      hint: 'Use schedule_annual or schedule_special to create a meeting first',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/shareholders/meeting] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Meeting action failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Cast shareholder vote
 * POST /corporate/:entityId/shareholders/vote
 */
corporateRoutes.post('/:entityId/shareholders/vote', async (req, res) => {
  try {
    const input = ShareholderVoteRequestSchema.parse(req.body);
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const meetingState = await getStateMachine(input.meetingId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
    } | null;

    if (!meetingState) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (meetingState.currentState?.value !== 'VOTING') {
      return res.status(400).json({
        error: 'Polls are not open',
        currentState: meetingState.currentState?.value,
      });
    }

    const voteId = randomUUID();

    const message = {
      TransitionStateMachine: {
        fiberId: input.meetingId,
        eventName: 'cast_vote',
        payload: {
          voteId,
          agendaItemId: input.agendaItemId,
          voterId: callerAddress,
          shareholderId: input.shareholderId,
          shareClass: input.shareClass,
          votesFor: input.votesFor,
          votesAgainst: input.votesAgainst,
          votesAbstain: input.votesAbstain,
          votesWithhold: input.votesWithhold,
          viaProxy: input.viaProxy,
        },
        targetSequenceNumber: meetingState.sequenceNumber ?? 0,
      },
    };

    console.log(`[corporate/shareholders/vote] ${callerAddress} voting on ${input.agendaItemId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      meetingId: input.meetingId,
      voteId,
      agendaItemId: input.agendaItemId,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/shareholders/vote] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Vote failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Proxy operations (grant, revoke, use)
 * POST /corporate/:entityId/shareholders/proxy
 */
corporateRoutes.post('/:entityId/shareholders/proxy', async (req, res) => {
  try {
    const input = ProxyRequestSchema.parse({ ...req.body, entityId: req.params.entityId });
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    if (input.action === 'grant') {
      const proxyId = randomUUID();

      const totalVotes = input.grantorShares?.reduce((sum, s) => sum + s.votes, 0) ?? 0;

      const message = {
        CreateStateMachine: {
          fiberId: proxyId,
          definition: CORPORATE_PROXY_DEFINITION,
          initialData: {
            schema: 'CorporateProxy',
            proxyId,
            entityId: input.entityId,
            grantorId: input.grantorId ?? callerAddress,
            grantorName: input.grantorName,
            grantorShares: input.grantorShares,
            totalVotes,
            holderId: input.holderId,
            holderName: input.holderName,
            proxyType: input.meetingId ? 'SPECIFIC_MEETING' : 'GENERAL',
            scope: {
              meetingId: input.meetingId,
              votingInstructions: input.votingInstructions ?? [],
              discretionaryAuthority: true,
            },
            grantDate: new Date().toISOString().split('T')[0],
            effectiveDate: new Date().toISOString().split('T')[0],
            expirationDate: input.expirationDate ?? new Date(Date.now() + 330 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 11 months
            revocability: {
              isRevocable: true,
            },
            createdAt: new Date().toISOString(),
          },
          parentFiberId: input.entityId,
        },
      };

      console.log(`[corporate/shareholders/proxy] Granting proxy from ${input.grantorId} to ${input.holderId}`);

      const result = await submitTransaction(message, input.privateKey);

      return res.status(201).json({
        proxyId,
        entityId: input.entityId,
        grantorId: input.grantorId ?? callerAddress,
        holderId: input.holderId,
        totalVotes,
        hash: result.hash,
      });
    }

    // For revoke/use, need proxyId
    if (!input.proxyId) {
      return res.status(400).json({ error: 'proxyId required for revoke/use actions' });
    }

    const proxyState = await getStateMachine(input.proxyId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
    } | null;

    if (!proxyState) {
      return res.status(404).json({ error: 'Proxy not found' });
    }

    const eventName = input.action === 'revoke' ? 'revoke' : 'use';

    const message = {
      TransitionStateMachine: {
        fiberId: input.proxyId,
        eventName,
        payload: { agent: callerAddress },
        targetSequenceNumber: proxyState.sequenceNumber ?? 0,
      },
    };

    console.log(`[corporate/shareholders/proxy] ${input.action} proxy ${input.proxyId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      proxyId: input.proxyId,
      action: input.action,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/shareholders/proxy] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Proxy action failed';
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// Officer Operations Routes
// ============================================================================

/**
 * Appoint an officer
 * POST /corporate/:entityId/officers/appoint
 */
corporateRoutes.post('/:entityId/officers/appoint', async (req, res) => {
  try {
    const input = AppointOfficerRequestSchema.parse({ ...req.body, entityId: req.params.entityId });
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const entityState = await getStateMachine(input.entityId) as {
      stateData?: { officersId?: string };
    } | null;

    if (!entityState) {
      return res.status(404).json({ error: 'Corporate entity not found' });
    }

    const officersId = entityState.stateData?.officersId;
    if (!officersId) {
      return res.status(400).json({ error: 'Officers fiber not found for entity' });
    }

    const officersState = await getStateMachine(officersId) as {
      sequenceNumber?: number;
    } | null;

    if (!officersState) {
      return res.status(404).json({ error: 'Officers state machine not found' });
    }

    const officerId = randomUUID();
    const personId = randomUUID();

    const message = {
      TransitionStateMachine: {
        fiberId: officersId,
        eventName: 'appoint_officer',
        payload: {
          agent: callerAddress,
          officerId,
          personId,
          name: input.name,
          title: input.title,
          customTitle: input.customTitle,
          appointedDate: input.appointedDate,
          appointmentResolutionRef: input.appointmentResolutionRef,
          reportsTo: input.reportsTo,
          authorityLevel: input.authorityLevel,
          spendingLimit: input.spendingLimit,
          isInterim: input.isInterim,
        },
        targetSequenceNumber: officersState.sequenceNumber ?? 0,
      },
    };

    console.log(`[corporate/officers/appoint] Appointing ${input.name} as ${input.title}`);

    const result = await submitTransaction(message, input.privateKey);

    res.status(201).json({
      entityId: input.entityId,
      officersId,
      officerId,
      name: input.name,
      title: input.title,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/officers/appoint] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Appointment failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Remove an officer
 * POST /corporate/:entityId/officers/remove
 */
corporateRoutes.post('/:entityId/officers/remove', async (req, res) => {
  try {
    const input = RemoveOfficerRequestSchema.parse({ ...req.body, entityId: req.params.entityId });
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const entityState = await getStateMachine(input.entityId) as {
      stateData?: { officersId?: string };
    } | null;

    if (!entityState) {
      return res.status(404).json({ error: 'Corporate entity not found' });
    }

    const officersId = entityState.stateData?.officersId;
    if (!officersId) {
      return res.status(400).json({ error: 'Officers fiber not found for entity' });
    }

    const officersState = await getStateMachine(officersId) as {
      sequenceNumber?: number;
    } | null;

    if (!officersState) {
      return res.status(404).json({ error: 'Officers state machine not found' });
    }

    const message = {
      TransitionStateMachine: {
        fiberId: officersId,
        eventName: 'remove_officer',
        payload: {
          agent: callerAddress,
          officerId: input.officerId,
          effectiveDate: input.effectiveDate,
          reason: input.reason,
          removalResolutionRef: input.removalResolutionRef,
        },
        targetSequenceNumber: officersState.sequenceNumber ?? 0,
      },
    };

    console.log(`[corporate/officers/remove] Removing officer ${input.officerId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      entityId: input.entityId,
      officerId: input.officerId,
      reason: input.reason,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/officers/remove] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Removal failed';
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// Securities Routes
// ============================================================================

/**
 * Issue shares
 * POST /corporate/:entityId/securities/issue
 */
corporateRoutes.post('/:entityId/securities/issue', async (req, res) => {
  try {
    const input = IssueSharesRequestSchema.parse({ ...req.body, entityId: req.params.entityId });
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    // Verify entity exists and is active
    const entityState = await getStateMachine(input.entityId) as {
      currentState?: { value: string };
      stateData?: { shareStructure?: { classes?: Array<{ classId: string; className: string; parValue: number }> } };
    } | null;

    if (!entityState) {
      return res.status(404).json({ error: 'Corporate entity not found' });
    }

    if (entityState.currentState?.value !== 'ACTIVE') {
      return res.status(400).json({
        error: 'Entity must be in ACTIVE state to issue shares',
        currentState: entityState.currentState?.value,
      });
    }

    // Find share class
    const shareClass = entityState.stateData?.shareStructure?.classes?.find(
      c => c.className === input.shareClass || c.classId === input.shareClass
    );

    if (!shareClass) {
      return res.status(400).json({
        error: `Share class ${input.shareClass} not found`,
        availableClasses: entityState.stateData?.shareStructure?.classes?.map(c => c.className),
      });
    }

    const securityId = randomUUID();

    const message = {
      CreateStateMachine: {
        fiberId: securityId,
        definition: CORPORATE_SECURITIES_DEFINITION,
        initialData: {
          schema: 'CorporateSecurities',
          securityId,
          entityId: input.entityId,
          shareClass: shareClass.classId,
          shareClassName: shareClass.className,
          shareCount: input.shareCount,
          parValue: shareClass.parValue,
          form: input.form,
          transferHistory: [],
          corporateActions: [],
          createdAt: new Date().toISOString(),
        },
        parentFiberId: input.entityId,
      },
    };

    console.log(`[corporate/securities/issue] Creating security fiber ${securityId}`);

    // First create the security fiber
    const createResult = await submitTransaction(message, input.privateKey);

    // Then transition to ISSUED
    const securityState = await getStateMachine(securityId) as { sequenceNumber?: number } | null;

    const issueMessage = {
      TransitionStateMachine: {
        fiberId: securityId,
        eventName: 'issue_shares',
        payload: {
          agent: callerAddress,
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
        },
        targetSequenceNumber: securityState?.sequenceNumber ?? 0,
      },
    };

    const issueResult = await submitTransaction(issueMessage, input.privateKey);

    res.status(201).json({
      securityId,
      entityId: input.entityId,
      shareClass: shareClass.className,
      shareCount: input.shareCount,
      holderId: input.holderId,
      holderName: input.holderName,
      hashes: [createResult.hash, issueResult.hash],
      message: 'Shares issued',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/securities/issue] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Issuance failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Transfer shares
 * POST /corporate/:entityId/securities/transfer
 */
corporateRoutes.post('/:entityId/securities/transfer', async (req, res) => {
  try {
    const input = TransferSharesRequestSchema.parse(req.body);
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const securityState = await getStateMachine(input.securityId) as {
      sequenceNumber?: number;
      currentState?: { value: string };
      stateData?: { holder?: { holderId?: string } };
    } | null;

    if (!securityState) {
      return res.status(404).json({ error: 'Security not found' });
    }

    if (securityState.currentState?.value !== 'ISSUED') {
      return res.status(400).json({
        error: 'Security must be in ISSUED state to transfer',
        currentState: securityState.currentState?.value,
      });
    }

    const transferId = randomUUID();

    // Initiate transfer
    const initiateMessage = {
      TransitionStateMachine: {
        fiberId: input.securityId,
        eventName: 'initiate_transfer',
        payload: {
          agent: callerAddress,
          transferId,
          toHolderId: input.toHolderId,
          toHolderName: input.toHolderName,
          toHolderType: input.toHolderType,
          transferType: input.transferType,
          transferDate: input.transferDate,
          pricePerShare: input.pricePerShare,
        },
        targetSequenceNumber: securityState.sequenceNumber ?? 0,
      },
    };

    console.log(`[corporate/securities/transfer] Initiating transfer ${transferId}`);

    const initiateResult = await submitTransaction(initiateMessage, input.privateKey);

    // Complete transfer
    const updatedState = await getStateMachine(input.securityId) as { sequenceNumber?: number } | null;

    const completeMessage = {
      TransitionStateMachine: {
        fiberId: input.securityId,
        eventName: 'complete_transfer',
        payload: {
          agent: callerAddress,
          toHolderId: input.toHolderId,
          toHolderName: input.toHolderName,
          toHolderType: input.toHolderType,
          completedDate: input.transferDate,
        },
        targetSequenceNumber: updatedState?.sequenceNumber ?? 0,
      },
    };

    const completeResult = await submitTransaction(completeMessage, input.privateKey);

    res.json({
      securityId: input.securityId,
      transferId,
      toHolderId: input.toHolderId,
      toHolderName: input.toHolderName,
      hashes: [initiateResult.hash, completeResult.hash],
      message: 'Transfer completed',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/securities/transfer] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Transfer failed';
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// Compliance Routes
// ============================================================================

/**
 * File a compliance report
 * POST /corporate/:entityId/compliance/file
 */
corporateRoutes.post('/:entityId/compliance/file', async (req, res) => {
  try {
    const input = FileComplianceRequestSchema.parse({ ...req.body, entityId: req.params.entityId });
    const callerAddress = keyPairFromPrivateKey(input.privateKey).address;

    const entityState = await getStateMachine(input.entityId) as {
      stateData?: { complianceId?: string };
    } | null;

    if (!entityState) {
      return res.status(404).json({ error: 'Corporate entity not found' });
    }

    const complianceId = entityState.stateData?.complianceId;
    if (!complianceId) {
      return res.status(400).json({ error: 'Compliance fiber not found for entity' });
    }

    const complianceState = await getStateMachine(complianceId) as {
      sequenceNumber?: number;
    } | null;

    if (!complianceState) {
      return res.status(404).json({ error: 'Compliance state machine not found' });
    }

    const filingId = randomUUID();

    const message = {
      TransitionStateMachine: {
        fiberId: complianceId,
        eventName: 'file_annual_report',
        payload: {
          agent: callerAddress,
          filingId,
          filingType: input.filingType,
          jurisdiction: input.jurisdiction,
          filedDate: input.filedDate,
          periodCovered: input.periodCovered,
          confirmationNumber: input.confirmationNumber,
          feePaid: input.feePaid,
          filedBy: input.filedBy,
          documentRef: input.documentRef,
          nextDueDate: input.nextDueDate,
        },
        targetSequenceNumber: complianceState.sequenceNumber ?? 0,
      },
    };

    console.log(`[corporate/compliance/file] Filing ${input.filingType} for ${input.entityId}`);

    const result = await submitTransaction(message, input.privateKey);

    res.json({
      entityId: input.entityId,
      complianceId,
      filingId,
      filingType: input.filingType,
      confirmationNumber: input.confirmationNumber,
      hash: result.hash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[corporate/compliance/file] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Filing failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get compliance status
 * GET /corporate/:entityId/compliance
 */
corporateRoutes.get('/:entityId/compliance', async (req, res) => {
  try {
    const entityState = await getStateMachine(req.params.entityId) as {
      stateData?: { complianceId?: string };
    } | null;

    if (!entityState) {
      return res.status(404).json({ error: 'Corporate entity not found' });
    }

    const complianceId = entityState.stateData?.complianceId;
    if (!complianceId) {
      return res.status(400).json({ error: 'Compliance fiber not found for entity' });
    }

    const complianceState = await getStateMachine(complianceId);
    if (!complianceState) {
      return res.status(404).json({ error: 'Compliance state machine not found' });
    }

    res.json(complianceState);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Query failed';
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// List Routes
// ============================================================================

/**
 * List all corporate entities
 * GET /corporate
 */
corporateRoutes.get('/', async (_req, res) => {
  try {
    const checkpoint = await getCheckpoint() as {
      state: {
        stateMachines: Record<string, {
          stateData?: { schema?: string };
          definition?: { metadata?: { name?: string } };
        }>;
      };
    };

    const entities: Record<string, unknown> = {};
    const corporateSchemas = ['CorporateEntity'];

    for (const [fiberId, sm] of Object.entries(checkpoint.state.stateMachines ?? {})) {
      const schema = sm.stateData?.schema;
      const defName = sm.definition?.metadata?.name;

      if (
        corporateSchemas.includes(schema ?? '') ||
        corporateSchemas.includes(defName ?? '')
      ) {
        entities[fiberId] = sm;
      }
    }

    res.json({
      count: Object.keys(entities).length,
      entities,
    });
  } catch (err) {
    console.error('[corporate/list] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'List failed';
    res.status(500).json({ error: errorMessage });
  }
});
