/**
 * Market Workflows
 * 
 * State machine definition for market fibers:
 * - Prediction markets: create → open → commits → close → oracle resolution → finalize
 * - Auctions: create → open → bids → close → winner determination → finalize
 * - Crowdfunding: create → open → pledges → close → threshold check → settle/refund
 * - Group buys: create → open → orders → close → threshold check → settle/refund
 */

// ============================================================================
// Market State Machine Definition
// ============================================================================

export const MARKET_SM_DEFINITION = {
  metadata: {
    name: 'Market',
    description: 'Universal market state machine: predictions, auctions, crowdfunding, group buys',
    version: '1.0.0',
  },
  states: {
    PROPOSED: { id: 'PROPOSED', isFinal: false },
    OPEN: { id: 'OPEN', isFinal: false },
    CLOSED: { id: 'CLOSED', isFinal: false },
    RESOLVING: { id: 'RESOLVING', isFinal: false },
    SETTLED: { id: 'SETTLED', isFinal: true },
    REFUNDED: { id: 'REFUNDED', isFinal: true },
    CANCELLED: { id: 'CANCELLED', isFinal: true },
  },
  initialState: 'PROPOSED',
  transitions: [
    // PROPOSED transitions
    { eventName: 'open', from: 'PROPOSED', to: 'OPEN' },
    { eventName: 'cancel', from: 'PROPOSED', to: 'CANCELLED' },
    // OPEN transitions
    { eventName: 'commit', from: 'OPEN', to: 'OPEN' }, // Self-loop for commits
    { eventName: 'close', from: 'OPEN', to: 'CLOSED' },
    // CLOSED transitions
    { eventName: 'submit_resolution', from: 'CLOSED', to: 'RESOLVING' },
    { eventName: 'refund', from: 'CLOSED', to: 'REFUNDED' },
    // RESOLVING transitions
    { eventName: 'submit_resolution', from: 'RESOLVING', to: 'RESOLVING' }, // Additional oracles
    { eventName: 'finalize', from: 'RESOLVING', to: 'SETTLED' },
    { eventName: 'refund', from: 'RESOLVING', to: 'REFUNDED' },
    // SETTLED transitions (claims don't change state, just distribute)
    { eventName: 'claim', from: 'SETTLED', to: 'SETTLED' },
  ],
};

// ============================================================================
// Market Type Helpers
// ============================================================================

/**
 * Get available events for a market in a given state
 */
export function getAvailableMarketEvents(state: string): string[] {
  return MARKET_SM_DEFINITION.transitions
    .filter(t => t.from.value === state)
    .map(t => t.eventName);
}

/**
 * Check if a market state is final
 */
export function isMarketStateFinal(state: string): boolean {
  const stateInfo = MARKET_SM_DEFINITION.states[state as keyof typeof MARKET_SM_DEFINITION.states];
  return stateInfo?.isFinal ?? false;
}
