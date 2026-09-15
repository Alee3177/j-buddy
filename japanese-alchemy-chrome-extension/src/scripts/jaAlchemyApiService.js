// Import Firebase Functions
import { httpsCallable } from 'firebase/functions';
import { firebaseApp, firebaseFunctions } from './firebaseApp.js';
import { buildRequestBody } from './requestBody.js';
import { DEV_TEST_TRANSLATION_PROFILE_ID } from './devTranslationProfile.js';

class JaAlchemyApiService {
  constructor() {
    // Shared with authService.js via firebaseApp.js — same App/Functions
    // instance, so httpsCallable auto-attaches the ID token from whatever
    // currentUser authService established on this SAME Auth instance.
    this.app = firebaseApp;
    this.functions = firebaseFunctions;
  }

  /**
   * Generate response using Firebase callable function
   * @param {string} selectedText - The text to analyze
   * @param {string} promptVersion - The prompt version ("v1" or "v2")
   * @param {{ before?: string, after?: string }} [context] - surrounding page context
   * @param {"natural"|"news"|"business"} [translationStyle] - P8-C2: only affects zh/en source text
   * @param {string} [translationProfileId] - P8-D2: only affects zh/en source text; production
   *   callers never pass this (falls back to the dev-only test hook, default null)
   * @returns {Promise<Object>} Analysis result
   */
  async generateResponse(selectedText, promptVersion = "v2", context, translationStyle, translationProfileId) {
    try {
      console.log('[Firebase API] Calling explain function with:', {
        content: selectedText.substring(0, 100) + '...',
        prompt: promptVersion
      });

      const resolvedProfileId = translationProfileId ?? DEV_TEST_TRANSLATION_PROFILE_ID ?? undefined;
      const explainCallable = httpsCallable(this.functions, 'explain');
      const result = await explainCallable(
        buildRequestBody(selectedText, promptVersion, context, translationStyle, resolvedProfileId)
      );

      /*
      result.data structure:

      export interface SuccessResponse {
        success: boolean;
        data?: any;
        timestamp?: number;
      }
      */
      console.log('[Firebase API] Explain function response:', result.data.data);
      return result.data.data;
    } catch (error) {
      console.error('[Firebase API] Explain function error:', error);
      
      // Extract error details from Firebase error
      const errorMessage = error.message || error.code || 'Unknown error occurred';
      throw new Error(`Firebase explain 函式失敗：${errorMessage}`);
    }
  }

  /**
   * Generate response using Firebase callable streaming
   * @param {string} selectedText - The text to analyze
   * @param {string} promptVersion - The prompt version ("v1" or "v2")
   * @param {{ before?: string, after?: string }} [context] - surrounding page context
   * @param {function} onChunk - Callback invoked with each text chunk
   * @param {function} onDone - Callback invoked with the full accumulated text after callable success
   * @param {function} onError - Callback invoked with an error message on failure
   * @param {{
   *   signal?: AbortSignal,
   *   onStatus?: (status: string) => void,
   *   onPreStage?: (preStage: { detectedLanguage: string, originalContent: string, analysisContent: string, translated: boolean, translationStyle: string, translationProfileId?: string, translationProfileVersion?: string }) => void,
   *   translationStyle?: "natural"|"news"|"business",
   *   translationProfileId?: string,
   * }} [options] - cancellation options for the callable request. `onStatus` (P8-B) is invoked for a
   *   non-content status marker the callable can send ahead of analysis (currently only "translating",
   *   emitted once when non-Japanese source text is being translated before analysis begins) — it never
   *   fires for the Japanese fast path. `onPreStage` (P8-C1) is invoked once, after translation completes
   *   and before analysis streaming begins, with the full multilingual pre-stage contract — also never
   *   fires for the Japanese fast path (translated === false is never sent over the wire at all).
   *   `translationStyle` (P8-C2) and `translationProfileId` (P8-D2) ride here rather than as positional
   *   parameters, matching onStatus/onPreStage, so existing positional call sites are unaffected; both
   *   only ever affect zh/en source text. The public sidepanel UI never sets `translationProfileId` — see
   *   scripts/devTranslationProfile.js for the dev-only test hook used when this option is omitted.
   */
  async generateResponseStream(
    selectedText, promptVersion, context, onChunk, onDone, onError,
    { signal, onStatus, onPreStage, translationStyle, translationProfileId } = {}
  ) {
    let fullText = '';
    try {
      if (signal?.aborted) {
        return;
      }

      console.log('[Firebase API] Calling explainStreamCallable with:', {
        content: selectedText.substring(0, 100) + '...',
        prompt: promptVersion
      });

      const resolvedProfileId = translationProfileId ?? DEV_TEST_TRANSLATION_PROFILE_ID ?? undefined;
      const explainStreamCallable = httpsCallable(this.functions, 'explainStreamCallable');
      const { stream, data } = await explainStreamCallable.stream(
        buildRequestBody(selectedText, promptVersion, context, translationStyle, resolvedProfileId),
        { signal }
      );
      // Firebase rejects both stream and data when an AbortSignal cancels the
      // request. Attach a handler now because the stream can reject first.
      void data.catch(() => {});

      for await (const chunk of stream) {
        if (signal?.aborted) {
          return;
        }
        // P8-B: a status marker (currently only "translating") carries no
        // analysis content — surface it via onStatus, then fall through to
        // the empty-content check below so it is never appended/rendered as
        // analysis text.
        if (chunk?.status) {
          onStatus?.(chunk.status);
        }
        // P8-C1: the one-shot pre-stage contract (also empty-content) —
        // surface it via onPreStage so the UI can present the generated
        // Japanese translation without re-deriving it.
        if (chunk?.preStage) {
          onPreStage?.(chunk.preStage);
        }
        if (!chunk?.content) continue;
        console.log('[Firebase API] Received chunk:', chunk.content);
        fullText += chunk.content;
        onChunk(chunk.content, fullText);
      }

      const result = await data;
      if (signal?.aborted) {
        return;
      }
      if (!result?.success) {
        onError(result?.error || '未知的串流錯誤');
        return;
      }

      onDone(fullText);
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') {
        return;
      }
      console.error('[Firebase API] Stream error:', error);
      onError(error.message || '串流請求失敗');
    }
  }

  /**
   * Save analysis to Firestore using Firebase callable function
   * @param {Object} analysis - Analysis object with words and grammars
   * @param {string|null} userId - Optional user ID (null for shared collections)
   * @returns {Promise<Object>} Response with saved counts
   */
  async saveAnalysis(analysis, userId = null) {
    try {
      console.log('[Firebase API] Calling saveItems function with:', {
        user_id: userId || 'shared',
        is_shared: analysis.is_shared,
        words_count: analysis.words?.length || 0,
        grammars_count: analysis.grammars?.length || 0
      });

      const saveItemsCallable = httpsCallable(this.functions, 'saveItems');
      const result = await saveItemsCallable({
        userId: userId,
        analysis: analysis
      });

      console.log('[Firebase API] SaveItems function response:', result.data);

      if (!result.data || !result.data.success) {
        throw new Error(result.data?.message || '儲存操作失敗');
      }

      return {
        success: true,
        words_count: result.data.saved?.words_count || 0,
        grammars_count: result.data.saved?.grammars_count || 0,
        message: result.data.message || 'Analysis saved successfully',
        // P7.4: true only for a shared save whose content already existed in
        // the shared collection (deduplicated server-side) — not an error.
        alreadyExists: result.data.alreadyExists === true
      };
    } catch (error) {
      console.error('[Firebase API] SaveItems function error:', error);
      
      // Handle specific Firebase errors
      // P7.4: saveItems requires sign-in for BOTH personal and shared saves
      // (previously only personal saves were auth-gated) — give a friendly,
      // save-kind-specific message for either, instead of the raw callable
      // error text.
      if (error.code === 'unauthenticated' || error.message?.includes('unauthenticated')) {
        throw new Error(
          analysis.is_shared
            ? '您必須先登入，才能與他人分享項目。'
            : '您必須先登入，才能將項目儲存至私人收藏。'
        );
      }
      
      // Extract error details
      const errorMessage = error.message || error.code || 'Unknown error occurred';
      throw new Error(`Firebase saveItems 函式失敗：${errorMessage}`);
    }
  }
}

// Export the service. Consumed by a direct ES import in sidepanel.js — no
// longer a window global; jaAlchemyApiService is only ever bundled as part
// of the sidepanel entry now (see webpack.config.js), so there is no other
// context that needs it.
export default JaAlchemyApiService;
