import * as admin from "firebase-admin";
import { onCall } from "firebase-functions/v2/https";

// Initialize Firebase Admin (only once)
admin.initializeApp();

// Import handler functions and secret
import { explainHandler } from "./v1/explainCallable";
import { explainStreamCallableHandler } from "./v1/explainStreamCallableHandler";
import { saveItemsHandler } from "./v1/saveItemsCallable";
import { configSecret } from "./config";
import { explainRuntimeOptions } from "./runtimeOptions";

// Create and export callable functions with v2 API
// The configSecret object is passed to the secrets parameter.
// LLM-backed callables share cost-ceiling runtime options (see
// runtimeOptions.ts); saveItems is auth-gated and not LLM-backed, so it is
// left on defaults. saveItems never reads configSecret (no getConfig() call
// in its handler), so it intentionally does NOT bind it — that keeps it
// deployable independently of JAPANESE_ALCHEMY_CONFIG.
export const explain = onCall(
  { ...explainRuntimeOptions, secrets: [configSecret] },
  explainHandler
);

export const explainStreamCallable = onCall(
  { ...explainRuntimeOptions, timeoutSeconds: 120, secrets: [configSecret] },
  explainStreamCallableHandler
);

export const saveItems = onCall(saveItemsHandler);
