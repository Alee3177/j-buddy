// Import Firebase Functions
import { httpsCallable } from 'firebase/functions';
import { firebaseApp, firebaseFunctions } from './firebaseApp.js';
import { buildRequestBody } from './requestBody.js';

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
   * @returns {Promise<Object>} Analysis result
   */
  async generateResponse(selectedText, promptVersion = "v2", context) {
    try {
      console.log('[Firebase API] Calling explain function with:', {
        content: selectedText.substring(0, 100) + '...',
        prompt: promptVersion
      });

      const explainCallable = httpsCallable(this.functions, 'explain');
      const result = await explainCallable(
        buildRequestBody(selectedText, promptVersion, context)
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
   * @param {{ signal?: AbortSignal }} [options] - cancellation options for the callable request
   */
  async generateResponseStream(selectedText, promptVersion, context, onChunk, onDone, onError, { signal } = {}) {
    let fullText = '';
    try {
      if (signal?.aborted) {
        return;
      }

      console.log('[Firebase API] Calling explainStreamCallable with:', {
        content: selectedText.substring(0, 100) + '...',
        prompt: promptVersion
      });

      const explainStreamCallable = httpsCallable(this.functions, 'explainStreamCallable');
      const { stream, data } = await explainStreamCallable.stream(
        buildRequestBody(selectedText, promptVersion, context),
        { signal }
      );
      // Firebase rejects both stream and data when an AbortSignal cancels the
      // request. Attach a handler now because the stream can reject first.
      void data.catch(() => {});

      for await (const chunk of stream) {
        if (signal?.aborted) {
          return;
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
