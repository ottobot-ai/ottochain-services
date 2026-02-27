/**
 * TDD Tests for Identity Event Name Alignment
 * 
 * These tests verify that traffic-gen uses the correct event names
 * that match the state machine definition (event-oriented, not action-oriented).
 * 
 * Groups:
 * - T4.x: getAvailableAgentEvents alignment (4 tests)
 * - T5.x: selection.ts weight alignment (3 tests) 
 * - T6.x: workflows.ts alignment (1 test)
 * 
 * @see docs/design/identity-domain-stack-fixes-spec.md
 */

import { describe, it, expect } from 'vitest';
import { getAvailableAgentEvents } from '../simulator.js';
import { computeTransitionWeights, generateEventData } from '../selection.js';
import { AGENT_WORKFLOWS } from '../workflows.js';
import type { Agent } from '../types.js';

describe('Identity Event Names Alignment', () => {
  describe('getAvailableAgentEvents alignment', () => {
    const mockActiveAgent = { state: 'ACTIVE' } as any;
    
    it('T4.1: ACTIVE state returns receive_vouch not submit_attestation', () => {
      const events = getAvailableAgentEvents(mockActiveAgent);
      
      // This should FAIL initially because simulator returns submit_attestation
      expect(events).toContain('receive_vouch');
      expect(events).not.toContain('submit_attestation');
    });

    it('T4.2: ACTIVE state returns receive_violation not submit_violation', () => {
      const events = getAvailableAgentEvents(mockActiveAgent);
      
      // This should FAIL initially because simulator returns submit_violation
      expect(events).toContain('receive_violation');
      expect(events).not.toContain('submit_violation');
    });

    it('T4.3: ACTIVE state returns challenge not file_challenge', () => {
      const events = getAvailableAgentEvents(mockActiveAgent);
      
      // This should FAIL initially because simulator returns file_challenge
      expect(events).toContain('challenge');
      expect(events).not.toContain('file_challenge');
    });

    it('T4.4: ACTIVE state includes receive_completion', () => {
      const events = getAvailableAgentEvents(mockActiveAgent);
      
      // This should FAIL initially because simulator doesn't distinguish 
      // between receive_vouch and receive_completion
      expect(events).toContain('receive_completion');
    });
  });

  describe('selection.ts weight alignment', () => {
    const mockAgent: Agent = {
      address: 'test-address',
      privateKey: 'test-private-key',
      fiberId: null,
      state: 'ACTIVE',
      fitness: { individual: 0.5, collaborative: 0.5, total: 0.5, reputation: 50, completionRate: 0.8, networkCentrality: 0.3 },
      meta: { platform: 'test', riskTolerance: 0.3 }
    } as unknown as Agent;

    it('T5.1: receive_vouch has weight defined', () => {
      const weights = computeTransitionWeights(mockAgent, {
        generation: 1, temperature: 1.0, marketHealth: 0.8,
        activityThreshold: 0.3, mutationRate: 0.05
      });
      
      // This should FAIL initially because computeTransitionWeights still uses submit_attestation
      expect(weights.receive_vouch).toBeDefined();
      expect(weights.submit_attestation).toBeUndefined();
    });

    it('T5.2: receive_violation has weight defined', () => {
      const weights = computeTransitionWeights(mockAgent, {
        generation: 1, temperature: 1.0, marketHealth: 0.8,
        activityThreshold: 0.3, mutationRate: 0.05
      });
      
      // This should FAIL initially because computeTransitionWeights still uses submit_violation  
      expect(weights.receive_violation).toBeDefined();
      expect(weights.submit_violation).toBeUndefined();
    });

    it('T5.3: challenge has weight defined', () => {
      const weights = computeTransitionWeights(mockAgent, {
        generation: 1, temperature: 1.0, marketHealth: 0.8,
        activityThreshold: 0.3, mutationRate: 0.05
      });
      
      // This should FAIL initially because computeTransitionWeights still uses file_challenge
      expect(weights.challenge).toBeDefined();
      expect(weights.file_challenge).toBeUndefined();
    });
  });

  describe('workflows.ts alignment', () => {
    it('T6.1: ACTIVE→CHALLENGED uses challenge event', () => {
      const workflow = AGENT_WORKFLOWS.find(
        w => w.from === 'ACTIVE' && w.to === 'CHALLENGED'
      );
      
      expect(workflow).toBeDefined();
      
      // This should FAIL initially because workflows.ts still uses file_challenge
      expect(workflow!.event).toBe('challenge');
    });
  });

  describe('generateEventData alignment', () => {
    const mockAgent: Agent = {
      address: 'test-address',
      privateKey: 'test-private-key',
      fiberId: null,
      state: 'ACTIVE',
      fitness: { individual: 0.5, collaborative: 0.5, total: 0.5, reputation: 50, completionRate: 0.8, networkCentrality: 0.3 },
      meta: { platform: 'test', riskTolerance: 0.3 }
    } as unknown as Agent;

    it('T7.1: generateEventData handles receive_vouch', () => {
      // This should FAIL initially because generateEventData still uses submit_attestation
      expect(() => generateEventData(mockAgent, 'receive_vouch')).not.toThrow();
      
      const data = generateEventData(mockAgent, 'receive_vouch');
      expect(data).toBeDefined();
    });

    it('T7.2: generateEventData handles receive_violation', () => {
      // This should FAIL initially because generateEventData still uses submit_violation
      expect(() => generateEventData(mockAgent, 'receive_violation')).not.toThrow();
      
      const data = generateEventData(mockAgent, 'receive_violation');
      expect(data).toBeDefined();
    });

    it('T7.3: generateEventData handles challenge', () => {
      // This should FAIL initially because generateEventData still uses file_challenge
      expect(() => generateEventData(mockAgent, 'challenge')).not.toThrow();
      
      const data = generateEventData(mockAgent, 'challenge');
      expect(data).toBeDefined();
    });

    it('T7.4: generateEventData rejects old event names', () => {
      // These should all fail/throw because the old events shouldn't be supported
      expect(() => generateEventData(mockAgent, 'submit_attestation')).toThrow();
      expect(() => generateEventData(mockAgent, 'submit_violation')).toThrow();
      expect(() => generateEventData(mockAgent, 'file_challenge')).toThrow();
    });
  });
});