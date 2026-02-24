/**
 * ResponseTimeTracker
 *
 * Sliding-window response time tracker for the bridge health endpoint.
 * Records request durations (ms) and exposes p50/p95/p99 percentiles.
 *
 * Design:
 *  - Circular buffer: at most MAX_SAMPLES entries to bound memory
 *  - 5-minute sliding window: samples older than WINDOW_MS are ignored
 *  - Returns null percentiles when no data exists (cold start / quiet period)
 *  - Zero runtime dependencies (Node.js stdlib only)
 */

const DEFAULT_MAX_SAMPLES = 1000;           // Upper bound on stored samples
const DEFAULT_WINDOW_MS  = 5 * 60 * 1000;  // 5-minute sliding window

interface Sample {
  ts: number;     // timestamp (Date.now())
  durationMs: number;
}

export interface PercentileResult {
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export interface TrackerOptions {
  /** Maximum number of samples to retain. Default: 1000 */
  maxSamples?: number;
  /** Sliding window duration in ms. Default: 300000 (5 min) */
  windowMs?: number;
  /** Clock function for timestamps. Default: Date.now. Inject for testing. */
  now?: () => number;
}

export class ResponseTimeTracker {
  private readonly samples: Sample[] = [];
  private readonly maxSamples: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: TrackerOptions = {}) {
    this.maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  /** Record a completed request's duration in milliseconds. */
  record(durationMs: number): void {
    if (this.samples.length >= this.maxSamples) {
      // Evict oldest entry (FIFO)
      this.samples.shift();
    }
    this.samples.push({ ts: this.now(), durationMs });
  }

  /**
   * Compute p50/p95/p99 from samples within the sliding window.
   * Returns null values when the window is empty (cold start or no recent traffic).
   */
  percentiles(): PercentileResult {
    const cutoff  = this.now() - this.windowMs;
    const recent  = this.samples
      .filter(s => s.ts >= cutoff)
      .map(s => s.durationMs)
      .sort((a, b) => a - b);

    if (recent.length === 0) {
      return { p50: null, p95: null, p99: null };
    }

    return {
      p50: this.percentile(recent, 50),
      p95: this.percentile(recent, 95),
      p99: this.percentile(recent, 99),
    };
  }

  /**
   * Number of samples currently in the buffer.
   * Note: includes expired samples that haven't been evicted yet.
   * These are filtered out by `percentiles()` but remain in the buffer
   * until displaced by new `record()` calls.
   */
  get size(): number {
    return this.samples.length;
  }

  /** Clear all samples (useful in tests). */
  clear(): void {
    this.samples.length = 0;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Nearest-rank percentile on a pre-sorted array.
   * Returns the value at position ceil(p/100 * n) - 1 (0-indexed).
   */
  private percentile(sorted: number[], p: number): number {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }
}

/** Singleton used by the bridge server and middleware. */
export const responseTimeTracker = new ResponseTimeTracker();
