/**
 * Script Oracle Workflows
 *
 * Defines JSON Logic programs and traffic-generator lifecycles for the three
 * canonical script oracle types:
 *
 *   escrowScript   — evaluates whether an escrow release condition is met
 *   votingScript   — tallies votes and determines the winning option
 *   approvalScript — routes an item through an approval threshold
 *
 * Each workflow registers a script on-chain, invokes it INVOKE_COUNT times
 * with varied inputs, then is retired.  The in-process "state machine" is
 * tracked by the orchestrator; the on-chain side uses CreateScript /
 * InvokeScript metagraph ops via the /script/* bridge routes.
 */

// ============================================================================
// Lifecycle constants
// ============================================================================

/** Number of invocations before a script oracle fiber is retired. */
export const SCRIPT_INVOKE_COUNT = 4;

// ============================================================================
// JSON Logic programs
// ============================================================================

/**
 * Escrow release condition:
 *   Release when deposited amount >= required amount AND both parties confirmed.
 */
export const ESCROW_SCRIPT_PROGRAM: Record<string, unknown> = {
  if: [
    {
      and: [
        { '>=': [{ var: 'amount' }, { var: 'required' }] },
        { '==': [{ var: 'depositorConfirmed' }, true] },
        { '==': [{ var: 'beneficiaryConfirmed' }, true] },
      ],
    },
    { result: 'RELEASE', message: 'Escrow conditions met — releasing funds.' },
    { result: 'HOLD', message: 'Escrow conditions not yet met.' },
  ],
};

/**
 * Voting tally script:
 *   Given an array of {option, weight} vote objects, returns the winning option.
 */
export const VOTING_SCRIPT_PROGRAM: Record<string, unknown> = {
  reduce: [
    { var: 'votes' },
    {
      if: [
        {
          '>': [
            { '+': [{ var: 'accumulator.weight' }, { var: 'current.weight' }] },
            { var: 'accumulator.weight' },
          ],
        },
        { option: { var: 'current.option' }, weight: { var: 'current.weight' } },
        { var: 'accumulator' },
      ],
    },
    { option: '', weight: 0 },
  ],
};

/**
 * Approval routing script:
 *   Returns 'APPROVED' when yes-votes / total-votes >= threshold,
 *   else returns 'PENDING' or 'REJECTED'.
 */
export const APPROVAL_SCRIPT_PROGRAM: Record<string, unknown> = {
  if: [
    { '>=': [{ '/': [{ var: 'yesVotes' }, { var: 'totalVotes' }] }, { var: 'threshold' }] },
    { result: 'APPROVED', ratio: { '/': [{ var: 'yesVotes' }, { var: 'totalVotes' }] } },
    {
      if: [
        { '<': [{ var: 'remainingVotes' }, { '-': [{ '*': [{ var: 'totalVotes' }, { var: 'threshold' }] }, { var: 'yesVotes' }] }] },
        { result: 'REJECTED', ratio: { '/': [{ var: 'yesVotes' }, { var: 'totalVotes' }] } },
        { result: 'PENDING', ratio: { '/': [{ var: 'yesVotes' }, { var: 'totalVotes' }] } },
      ],
    },
  ],
};

// ============================================================================
// Input generators
// ============================================================================

/** Generate a random set of inputs for the escrow script. */
export function generateEscrowInputs(): Record<string, unknown> {
  const required = 100;
  const amount = Math.floor(Math.random() * 150) + 50; // 50..200
  return {
    amount,
    required,
    depositorConfirmed: Math.random() > 0.3,
    beneficiaryConfirmed: Math.random() > 0.3,
  };
}

/** Generate a random set of inputs for the voting tally script. */
export function generateVotingInputs(options = ['YES', 'NO', 'ABSTAIN']): Record<string, unknown> {
  const votes = options.map(option => ({
    option,
    weight: Math.floor(Math.random() * 100) + 1,
  }));
  return { votes };
}

/** Generate a random set of inputs for the approval routing script. */
export function generateApprovalInputs(): Record<string, unknown> {
  const totalVotes = Math.floor(Math.random() * 20) + 5;
  const yesVotes = Math.floor(Math.random() * totalVotes);
  const remainingVotes = Math.floor(Math.random() * 5);
  return {
    yesVotes,
    totalVotes,
    remainingVotes,
    threshold: 0.6,
  };
}

// ============================================================================
// Type helpers
// ============================================================================

/** Maps a script oracle fiber type to its JSON Logic program. */
export const SCRIPT_PROGRAMS: Record<string, Record<string, unknown>> = {
  escrowScript: ESCROW_SCRIPT_PROGRAM,
  votingScript: VOTING_SCRIPT_PROGRAM,
  approvalScript: APPROVAL_SCRIPT_PROGRAM,
};

/** Maps a script oracle fiber type to its input generator. */
export const SCRIPT_INPUT_GENERATORS: Record<string, () => Record<string, unknown>> = {
  escrowScript: generateEscrowInputs,
  votingScript: generateVotingInputs,
  approvalScript: generateApprovalInputs,
};

/** Human-readable names for each script type. */
export const SCRIPT_NAMES: Record<string, string> = {
  escrowScript: 'Escrow Release Condition',
  votingScript: 'Vote Tally Oracle',
  approvalScript: 'Approval Router',
};

/** Human-readable descriptions for each script type. */
export const SCRIPT_DESCRIPTIONS: Record<string, string> = {
  escrowScript: 'Evaluates whether an escrow release condition is met',
  votingScript: 'Tallies votes and determines the winning option',
  approvalScript: 'Routes an item through an approval threshold',
};
