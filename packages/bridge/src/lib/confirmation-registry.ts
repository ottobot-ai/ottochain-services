/**
 * ConfirmationRegistry
 *
 * Push-based fiber confirmation registry.
 *
 * When a bridge route submits a transaction to ML0 it registers a pending
 * waiter here.  When the indexer processes the resulting ML0 snapshot it
 * calls POST /internal/indexer-notify, which resolves the waiter.
 *
 * This eliminates polling from the happy path: callers get a definitive
 * answer (confirmed state + ordinal) within milliseconds of the indexer
 * finishing, instead of waiting up to TIMEOUT_MS for a polling loop to
 * catch up.
 *
 * A per-waiter safety timeout ensures callers are never left hanging if
 * the indexer callback is never received.
 */

export interface FiberConfirmation {
  fiberId: string;
  /** Current state as indexed from ML0 */
  currentState: string;
  /** ML0 snapshot ordinal at which the fiber was observed */
  ordinal: number;
  /** Bridge-mapped fiber status string */
  status: string;
}

interface PendingWaiter {
  resolve: (conf: FiberConfirmation) => void;
  reject: (err: Error) => void;
  /** Absolute timestamp (Date.now()) after which the waiter expires */
  expiresAt: number;
  /** Node.js timer handle — cleared on resolution */
  timer: ReturnType<typeof setTimeout>;
}

class ConfirmationRegistry {
  private readonly waiters = new Map<string, PendingWaiter>();

  /**
   * Register interest in a fiber confirmation.
   *
   * Returns a Promise that resolves with the first confirmation payload
   * received for `fiberId`, or rejects after `timeoutMs`.
   *
   * Multiple callers for the same fiberId are supported: each gets its own
   * independent Promise resolved by the same notification event.
   *
   * @param fiberId   - UUID of the fiber to wait for
   * @param timeoutMs - Maximum wait in milliseconds (default: 120 000)
   */
  register(fiberId: string, timeoutMs = 120_000): Promise<FiberConfirmation> {
    return new Promise<FiberConfirmation>((resolve, reject) => {
      // Cancel any previous waiter for this fiberId (e.g. retry scenario)
      this.cancel(fiberId);

      const expiresAt = Date.now() + timeoutMs;

      const timer = setTimeout(() => {
        this.waiters.delete(fiberId);
        reject(new Error(`Push confirmation timeout after ${timeoutMs}ms for fiber ${fiberId}`));
      }, timeoutMs);

      // Allow the process to exit even if this timer is pending
      if (typeof timer === 'object' && 'unref' in timer) {
        timer.unref();
      }

      this.waiters.set(fiberId, { resolve, reject, expiresAt, timer });
    });
  }

  /**
   * Notify the registry that a fiber has been indexed.
   * Resolves any pending waiter for this fiberId.
   *
   * @returns true if a waiter was found and resolved, false if no one was waiting
   */
  notify(confirmation: FiberConfirmation): boolean {
    const waiter = this.waiters.get(confirmation.fiberId);
    if (!waiter) return false;

    clearTimeout(waiter.timer);
    this.waiters.delete(confirmation.fiberId);
    waiter.resolve(confirmation);
    return true;
  }

  /**
   * Cancel a pending waiter without resolving it.
   * Used for cleanup / retry scenarios.
   */
  cancel(fiberId: string): void {
    const waiter = this.waiters.get(fiberId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.waiters.delete(fiberId);
    }
  }

  /** Number of currently waiting callers (useful for monitoring). */
  get size(): number {
    return this.waiters.size;
  }

  /** Pending fiber IDs (for debugging / health endpoints). */
  pendingIds(): string[] {
    return Array.from(this.waiters.keys());
  }
}

/** Singleton — shared across all bridge routes. */
export const confirmationRegistry = new ConfirmationRegistry();
export { ConfirmationRegistry };
