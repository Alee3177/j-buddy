import { describe, it, expect } from "@jest/globals";
import {
  normalizeSharedSourceText,
  sharedPageContentHash,
} from "../../src/utils/sharedContentFingerprint";

describe("normalizeSharedSourceText", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeSharedSourceText("  hello  ")).toBe("hello");
  });

  it("collapses internal whitespace runs (spaces, tabs, newlines) to a single space", () => {
    expect(normalizeSharedSourceText("hello\t\n  world")).toBe("hello world");
  });

  it("preserves semantic (non-whitespace) characters exactly", () => {
    expect(normalizeSharedSourceText("美國Prismacolor Premier色鉛筆")).toBe(
      "美國Prismacolor Premier色鉛筆"
    );
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeSharedSourceText("   \n\t  ")).toBe("");
  });
});

describe("sharedPageContentHash", () => {
  it("returns a 64-char hex SHA-256 digest for non-empty text", () => {
    const hash = sharedPageContentHash("こんにちは");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same text", () => {
    expect(sharedPageContentHash("同じテキスト")).toBe(
      sharedPageContentHash("同じテキスト")
    );
  });

  it("produces the same hash for whitespace-only differences", () => {
    expect(sharedPageContentHash("hello   world")).toBe(
      sharedPageContentHash("  hello world  ")
    );
    expect(sharedPageContentHash("hello\nworld")).toBe(
      sharedPageContentHash("hello world")
    );
  });

  it("produces a different hash for genuinely different text", () => {
    expect(sharedPageContentHash("hello world")).not.toBe(
      sharedPageContentHash("hello world!")
    );
  });

  it("returns null for undefined, null, empty, or whitespace-only input", () => {
    expect(sharedPageContentHash(undefined)).toBeNull();
    expect(sharedPageContentHash(null)).toBeNull();
    expect(sharedPageContentHash("")).toBeNull();
    expect(sharedPageContentHash("   ")).toBeNull();
  });

  it("never embeds the raw source text in the hash (one-way)", () => {
    const secret = "私だけの秘密のテキスト";
    const hash = sharedPageContentHash(secret);
    expect(hash).not.toContain(secret);
  });
});
