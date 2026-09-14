export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

// P8-C1.5: max 2 retries after the initial attempt (3 attempts total),
// ~500ms then ~1500ms backoff — matches the observed live 429 pressure from
// zh/en requests now needing two LLM calls (translation + analysis) instead
// of one.
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_BASE_DELAY_MS = 500;

/**
 * Thrown by a provider-call attempt for a transient HTTP failure (429 rate
 * limit, or any 5xx) — the ONLY error type `withProviderRetry` retries.
 * Validation errors, auth/config errors, unsupported-language, the
 * translated-output ceiling, and any non-retryable 4xx are never this type,
 * so they are never retried — they propagate on the very first attempt,
 * exactly as before this change.
 */
export class RetryableProviderError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RetryableProviderError";
    this.status = status;
  }
}

/** 429 (rate limited) or any 5xx (transient provider-side failure). */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// retryNumber 1 -> ~baseDelayMs (500ms default), retryNumber 2 -> ~3x
// baseDelayMs (1500ms default) — matches the "~500ms then ~1500ms" spec.
// Small jitter (up to 20% of baseDelayMs) avoids concurrent requests all
// retrying on the exact same tick.
function backoffDelayMs(retryNumber: number, baseDelayMs: number): number {
  const exponential = baseDelayMs * (2 * retryNumber - 1);
  const jitter = Math.random() * baseDelayMs * 0.2;
  return exponential + jitter;
}

/**
 * Runs `attempt()` up to `maxRetries + 1` times total. Retries ONLY when
 * `attempt()` throws a `RetryableProviderError` — any other thrown error
 * propagates immediately, un-retried, on the first failure. Bounded: never
 * more than `maxRetries` retries (default 2), with backoff between attempts
 * and no delay after the final attempt. Never an unlimited/unbounded retry.
 */
export async function withProviderRetry<T>(
  attempt: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  for (let retryNumber = 0; ; retryNumber += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof RetryableProviderError) || retryNumber >= maxRetries) {
        throw error;
      }
      await sleep(backoffDelayMs(retryNumber + 1, baseDelayMs));
    }
  }
}
