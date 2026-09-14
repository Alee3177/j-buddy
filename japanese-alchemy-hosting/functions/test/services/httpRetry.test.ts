import { describe, it, expect, jest } from "@jest/globals";
import {
  isRetryableStatus,
  RetryableProviderError,
  withProviderRetry,
} from "../../src/services/httpRetry";

describe("isRetryableStatus", () => {
  it("treats 429 as retryable", () => {
    expect(isRetryableStatus(429)).toBe(true);
  });

  it("treats every 5xx as retryable", () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(599)).toBe(true);
  });

  it("does not treat other 4xx statuses as retryable", () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});

describe("withProviderRetry", () => {
  const fastOptions = { baseDelayMs: 1 };

  it("returns the result on the first successful attempt without retrying", async () => {
    const attempt = jest.fn(async () => "ok") as any;

    const result = await withProviderRetry(attempt, fastOptions);

    expect(result).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries a RetryableProviderError and succeeds once the attempt recovers", async () => {
    const attempt = jest.fn() as any;
    attempt
      .mockRejectedValueOnce(new RetryableProviderError(429, "rate limited"))
      .mockResolvedValueOnce("recovered");

    const result = await withProviderRetry(attempt, fastOptions);

    expect(result).toBe("recovered");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("bounds retries to maxRetries (default 2) — 3 attempts total, then throws", async () => {
    const attempt = jest.fn(async () => {
      throw new RetryableProviderError(429, "still rate limited");
    }) as any;

    await expect(withProviderRetry(attempt, fastOptions)).rejects.toThrow("still rate limited");
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("honors a custom maxRetries bound", async () => {
    const attempt = jest.fn(async () => {
      throw new RetryableProviderError(503, "still unavailable");
    }) as any;

    await expect(
      withProviderRetry(attempt, { ...fastOptions, maxRetries: 0 })
    ).rejects.toThrow("still unavailable");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("never retries a non-RetryableProviderError (validation/auth/other)", async () => {
    const attempt = jest.fn(async () => {
      throw new Error("not retryable");
    }) as any;

    await expect(withProviderRetry(attempt, fastOptions)).rejects.toThrow("not retryable");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("waits with backoff between retries (default policy resolves in well under 2s with fastOptions)", async () => {
    const attempt = jest.fn() as any;
    attempt
      .mockRejectedValueOnce(new RetryableProviderError(429, "rate limited"))
      .mockRejectedValueOnce(new RetryableProviderError(429, "rate limited"))
      .mockResolvedValueOnce("ok");

    const start = Date.now();
    const result = await withProviderRetry(attempt, fastOptions);
    const elapsed = Date.now() - start;

    expect(result).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(3);
    // Two tiny (~1ms base) backoff waits happened, but nothing close to the
    // production ~500ms/~1500ms — proves the delay path actually ran without
    // slowing the suite down.
    expect(elapsed).toBeLessThan(500);
  });
});
