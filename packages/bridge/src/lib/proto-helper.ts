import type { StateMachineDefinition } from '../metagraph.js';

/**
 * Extract only proto-compatible fields from an SDK FiberAppDefinition.
 * Strips SDK-only fields (createSchema, stateSchema, eventSchemas).
 * 
 * TODO: Replace with toProtoDefinition() from SDK once available in 2.2.0
 */
export function toProtoDefinition(def: any): StateMachineDefinition {
  return {
    states: def.states,
    initialState: def.initialState,
    transitions: def.transitions,
    metadata: def.metadata,
  };
}
