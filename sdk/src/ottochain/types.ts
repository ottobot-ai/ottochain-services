/**
 * Ottochain-specific type definitions
 *
 * TypeScript interfaces mirroring the Scala domain model for ottochain metagraphs.
 * These types represent the on-chain state, fiber records, log entries, and message formats.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Primitive / value types
// ---------------------------------------------------------------------------

/**
 * Fiber sequence number (non-negative integer).
 * Serializes as a plain number in JSON.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/fiber/FiberOrdinal.scala
 */
export type FiberOrdinal = number;

/**
 * Snapshot ordinal from the Constellation framework.
 * Serializes as `{ value: number }` in JSON.
 */
export interface SnapshotOrdinal {
  value: number;
}

/**
 * State identifier for state machines.
 * Serializes as `{ value: string }` in JSON.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/fiber/StateId.scala
 */
export interface StateId {
  value: string;
}

/**
 * Constellation network address (DAG address string).
 */
export type Address = string;

/**
 * Hash value from the Constellation framework.
 * Serializes as `{ value: string }` in JSON.
 */
export interface HashValue {
  value: string;
}

/**
 * JSON logic value - arbitrary JSON data used for state data and payloads.
 */
export type JsonLogicValue = unknown;

/**
 * JSON logic expression - a JsonLogic program definition.
 */
export type JsonLogicExpression = unknown;

// ---------------------------------------------------------------------------
// Fiber status
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a fiber.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/fiber/FiberStatus.scala
 */
export type FiberStatus = 'Active' | 'Archived' | 'Failed';

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

/**
 * Access control policy for script oracles.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/fiber/AccessControlPolicy.scala
 */
export type AccessControlPolicy =
  | { Public: Record<string, never> }
  | { Whitelist: { addresses: Address[] } }
  | { FiberOwned: { fiberId: string } };

// ---------------------------------------------------------------------------
// State machine definition
// ---------------------------------------------------------------------------

/**
 * Definition of a state machine's structure and transitions.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/fiber/StateMachineDefinition.scala
 */
export interface StateMachineDefinition {
  states: Record<string, unknown>;
  initialState: StateId;
  transitions: unknown[];
  metadata?: JsonLogicValue;
}

// ---------------------------------------------------------------------------
// Log entries (FiberLogEntry)
// ---------------------------------------------------------------------------

/**
 * Event emitted by a state machine transition trigger.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/fiber/EmittedEvent.scala
 */
export interface EmittedEvent {
  name: string;
  data: JsonLogicValue;
  destination?: string;
}

/**
 * Receipt of a state machine event processing.
 * Emitted as a FiberLogEntry after each TransitionStateMachine.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/fiber/FiberLogEntry.scala
 */
export interface EventReceipt {
  fiberId: string;
  sequenceNumber: FiberOrdinal;
  eventName: string;
  ordinal: SnapshotOrdinal;
  fromState: StateId;
  toState: StateId;
  success: boolean;
  gasUsed: number;
  triggersFired: number;
  errorMessage?: string;
  sourceFiberId?: string;
  emittedEvents: EmittedEvent[];
}

/**
 * Log entry for a script oracle invocation.
 * Emitted as a FiberLogEntry after each InvokeScriptOracle.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/fiber/FiberLogEntry.scala
 */
export interface OracleInvocation {
  fiberId: string;
  method: string;
  args: JsonLogicValue;
  result: JsonLogicValue;
  gasUsed: number;
  invokedAt: SnapshotOrdinal;
  invokedBy: Address;
}

/**
 * Union type for all fiber log entries.
 * The runtime JSON is discriminated by the presence of type-specific fields.
 */
export type FiberLogEntry = EventReceipt | OracleInvocation;

// ---------------------------------------------------------------------------
// Fiber records
// ---------------------------------------------------------------------------

/**
 * On-chain record for a state machine fiber.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/Records.scala
 */
export interface StateMachineFiberRecord {
  fiberId: string;
  creationOrdinal: SnapshotOrdinal;
  previousUpdateOrdinal: SnapshotOrdinal;
  latestUpdateOrdinal: SnapshotOrdinal;
  definition: StateMachineDefinition;
  currentState: StateId;
  stateData: JsonLogicValue;
  stateDataHash: HashValue;
  sequenceNumber: FiberOrdinal;
  owners: Address[];
  status: FiberStatus;
  lastReceipt?: EventReceipt;
  parentFiberId?: string;
  childFiberIds: string[];
}

/**
 * On-chain record for a script oracle fiber.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/Records.scala
 */
export interface ScriptOracleFiberRecord {
  fiberId: string;
  creationOrdinal: SnapshotOrdinal;
  latestUpdateOrdinal: SnapshotOrdinal;
  scriptProgram: JsonLogicExpression;
  stateData?: JsonLogicValue;
  stateDataHash?: HashValue;
  accessControl: AccessControlPolicy;
  sequenceNumber: FiberOrdinal;
  owners: Address[];
  status: FiberStatus;
  lastInvocation?: OracleInvocation;
}

/**
 * Union type for all fiber records.
 */
export type FiberRecord = StateMachineFiberRecord | ScriptOracleFiberRecord;

// ---------------------------------------------------------------------------
// On-chain state
// ---------------------------------------------------------------------------

/**
 * Commit hash for a single fiber in the on-chain state.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/OnChain.scala
 */
export interface FiberCommit {
  recordHash: HashValue;
  stateDataHash?: HashValue;
  sequenceNumber: FiberOrdinal;
}

/**
 * Full on-chain state of the ottochain metagraph.
 *
 * - `fiberCommits`: Map of fiber UUID → commit hashes (lightweight proof)
 * - `latestLogs`: Map of fiber UUID → log entries from the current ordinal (ephemeral)
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/OnChain.scala
 */
export interface OnChain {
  fiberCommits: Record<string, FiberCommit>;
  latestLogs: Record<string, FiberLogEntry[]>;
}

// ---------------------------------------------------------------------------
// Calculated state (queryable via ML0 custom routes)
// ---------------------------------------------------------------------------

/**
 * Full calculated state of the metagraph (served by ML0 /v1/ endpoints).
 *
 * Contains the materialized view of all fiber records, queryable by fiber type.
 */
export interface CalculatedState {
  stateMachines: Record<string, StateMachineFiberRecord>;
  scriptOracles: Record<string, ScriptOracleFiberRecord>;
}

// ---------------------------------------------------------------------------
// Message types (OttochainMessage / DataUpdate payloads)
// ---------------------------------------------------------------------------

/**
 * Create a new state machine fiber.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/Updates.scala
 */
export interface CreateStateMachine {
  fiberId: string;
  definition: StateMachineDefinition;
  initialData: JsonLogicValue;
  parentFiberId?: string;
}

/**
 * Trigger a state machine transition.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/Updates.scala
 */
export interface TransitionStateMachine {
  fiberId: string;
  eventName: string;
  payload: JsonLogicValue;
  targetSequenceNumber: FiberOrdinal;
}

/**
 * Archive a state machine fiber.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/Updates.scala
 */
export interface ArchiveStateMachine {
  fiberId: string;
  targetSequenceNumber: FiberOrdinal;
}

/**
 * Create a new script oracle fiber.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/Updates.scala
 */
export interface CreateScriptOracle {
  fiberId: string;
  scriptProgram: JsonLogicExpression;
  initialState?: JsonLogicValue;
  accessControl: AccessControlPolicy;
}

/**
 * Invoke a script oracle.
 *
 * @see modules/models/src/main/scala/xyz/kd5ujc/schema/Updates.scala
 */
export interface InvokeScriptOracle {
  fiberId: string;
  method: string;
  args: JsonLogicValue;
  targetSequenceNumber: FiberOrdinal;
}

/**
 * Union type for all ottochain messages (DataUpdate payloads).
 *
 * JSON is wrapped as `{ MessageName: { ...fields } }` where MessageName
 * is the class name (e.g., `{ CreateStateMachine: { fiberId: "...", ... } }`).
 */
export type OttochainMessage =
  | { CreateStateMachine: CreateStateMachine }
  | { TransitionStateMachine: TransitionStateMachine }
  | { ArchiveStateMachine: ArchiveStateMachine }
  | { CreateScriptOracle: CreateScriptOracle }
  | { InvokeScriptOracle: InvokeScriptOracle };
