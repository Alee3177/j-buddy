import * as functions from "firebase-functions";
import { LlmRequest, LlmResponse, SuccessResponse } from "../models/types";
import { configSecret } from "../config";
import { LlmBatchCompletion, LlmService, LlmStreamCompletion } from "./llmService";

// Shared generation policy for both batch (chatCompletion) and streaming
// (streamCompletion) requests. Kept identical across both so Tier-2/batch
// evaluation reflects the same Gemini behavior as the production streaming
// path used by the Chrome extension.
const GEMINI_MAX_TOKENS = 16384;
const GEMINI_THINKING_BUDGET = 512; // Specific token limit (0 to 24,576)
const GEMINI_INCLUDE_THOUGHTS = false; // Returns model's reasoning steps

function geminiThinkingConfig() {
  return {
    google: {
      thinking_config: {
        thinking_budget: GEMINI_THINKING_BUDGET,
        include_thoughts: GEMINI_INCLUDE_THOUGHTS,
      },
    },
  };
}

export class GeminiLlmService implements LlmService {
  private apiUrl: string;
  private apiKey: string;
  private model: string;

  constructor() {
    const config = configSecret.value();
    this.apiUrl = config.gemini.api_url;
    this.apiKey = config.gemini.api_key;
    this.model = config.gemini.model;

    if (!this.apiKey) {
      throw new Error("Gemini API key not found in JAPANESE_ALCHEMY_CONFIG secret");
    }
  }

  async streamCompletion(systemPrompt: string, content: string): Promise<LlmStreamCompletion> {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: content },
    ];

    const payload: LlmRequest = {
      messages,
      model: this.model,
      temperature: 0.1,
      max_tokens: GEMINI_MAX_TOKENS,
      stream: true,
      stream_options: { include_usage: true },
      extra_body: geminiThinkingConfig(),
    };

    functions.logger.info("Calling Gemini API (streaming)", {
      model: this.model,
      messagesCount: messages.length,
    });

    const response = await fetch(`${this.apiUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      functions.logger.error("Gemini API Error (streaming)", {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      throw new functions.https.HttpsError(
        "internal",
        `Gemini API error: ${response.status} ${response.statusText}`
      );
    }

    return { response, requestedModel: this.model };
  }

  async chatCompletion(systemPrompt: string, content: string): Promise<LlmBatchCompletion> {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: content },
    ];

    const payload: LlmRequest = {
      messages,
      model: this.model,
      temperature: 0.1,
      max_tokens: GEMINI_MAX_TOKENS,
      extra_body: geminiThinkingConfig(),
    };

    functions.logger.info("Calling Gemini API", {
      model: this.model,
      messagesCount: messages.length,
    });

    const response = await fetch(`${this.apiUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      functions.logger.error("Gemini API Error", {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      throw new functions.https.HttpsError(
        "internal",
        `Gemini API error: ${response.status} ${response.statusText}`
      );
    }

    functions.logger.info("Gemini API Success");
    const data = await response.json() as LlmResponse;

    const result: SuccessResponse = {
      success: true,
      data: data.choices[0].message.content,
      timestamp: Date.now(),
    };

    return {
      response: result,
      requestedModel: this.model,
      usage: data.usage,
      responseModel: data.model,
      finishReason: data.choices[0].finish_reason,
    };
  }
}
