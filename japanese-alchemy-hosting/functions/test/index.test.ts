const mockOnCall = jest.fn((optsOrHandler: unknown, maybeHandler?: unknown) => {
  const [opts, handler] =
    typeof optsOrHandler === "function"
      ? [{}, optsOrHandler]
      : [optsOrHandler as Record<string, unknown>, maybeHandler];
  return { __mockCallable: true, opts, handler };
});
const mockOnRequest = jest.fn();

const mockConfigSecret = { __mockSecret: "JAPANESE_ALCHEMY_CONFIG" };

jest.mock("firebase-admin", () => ({ initializeApp: jest.fn() }));
jest.mock("firebase-functions/v2/https", () => ({
  onCall: (...args: unknown[]) => (mockOnCall as any)(...args),
  onRequest: (...args: unknown[]) => mockOnRequest(...args),
}));
jest.mock("../src/config", () => ({ configSecret: mockConfigSecret }));
jest.mock("../src/runtimeOptions", () => ({ explainRuntimeOptions: {} }));
jest.mock("../src/v1/explainCallable", () => ({ explainHandler: jest.fn() }));
jest.mock("../src/v1/explainStreamCallableHandler", () => ({
  explainStreamCallableHandler: jest.fn(),
}));
jest.mock("../src/v1/saveItemsCallable", () => ({ saveItemsHandler: jest.fn() }));

import { explainHandler } from "../src/v1/explainCallable";
import { explainStreamCallableHandler } from "../src/v1/explainStreamCallableHandler";
import { saveItemsHandler } from "../src/v1/saveItemsCallable";
import * as functions from "../src/index";

/**
 * The deploy-time secret binding for a given handler, found by matching
 * mockOnCall's recorded calls by HANDLER IDENTITY rather than call order or
 * export name — so this stays valid regardless of how index.ts orders its
 * onCall() calls or which overload (options+handler vs. handler-only) a given
 * export uses.
 */
function secretsBoundTo(handler: unknown): unknown {
  const call = mockOnCall.mock.calls.find(([optsOrHandler, maybeHandler]) =>
    (typeof optsOrHandler === "function" ? optsOrHandler : maybeHandler) === handler
  );
  if (!call) throw new Error("handler was never passed to onCall()");
  const optsOrHandler = call[0];
  const opts = typeof optsOrHandler === "function" ? {} : (optsOrHandler as Record<string, unknown>);
  return opts.secrets;
}

describe("managed analysis function exports", () => {
  test("exposes callable streaming without the retired raw SSE route", () => {
    expect(functions).toHaveProperty("explainStreamCallable");
    expect(functions).not.toHaveProperty("explainStream");
    expect(mockOnRequest).not.toHaveBeenCalled();
  });
});

describe("JAPANESE_ALCHEMY_CONFIG secret binding contract (P7.2-C)", () => {
  test("explain binds configSecret (genuinely calls the LLM provider)", () => {
    expect(secretsBoundTo(explainHandler)).toEqual([mockConfigSecret]);
  });

  test("explainStreamCallable binds configSecret (genuinely calls the LLM provider)", () => {
    expect(secretsBoundTo(explainStreamCallableHandler)).toEqual([mockConfigSecret]);
  });

  test("saveItems does NOT bind configSecret, so it deploys independently of JAPANESE_ALCHEMY_CONFIG", () => {
    expect(secretsBoundTo(saveItemsHandler)).toBeUndefined();
  });

  test("saveItems remains an exported HTTPS callable", () => {
    expect(functions).toHaveProperty("saveItems");
    const wasRegisteredAsCallable = mockOnCall.mock.calls.some(
      ([optsOrHandler, maybeHandler]) =>
        (typeof optsOrHandler === "function" ? optsOrHandler : maybeHandler) === saveItemsHandler
    );
    expect(wasRegisteredAsCallable).toBe(true);
    expect(mockOnRequest).not.toHaveBeenCalled();
  });
});
