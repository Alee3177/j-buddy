import * as functions from "firebase-functions";
import { SaveItemsRequest, SaveItemsResponse } from "../models/types";
import { FirestoreService } from "../services/firestoreService";
import { deriveLearningItems } from "../models/learningItem";
import { logger } from "../utils/logger";
import { validateSaveItemsCounts } from "./requestValidation";

export async function saveItemsHandler(request: any): Promise<SaveItemsResponse> {
  logger.setContext(request);

  const data = request.data as SaveItemsRequest;
  const { analysis, userId } = data;

  if (!analysis) {
    logger.error("Invalid request: analysis is required");
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Analysis is required"
    );
  }

   const words = analysis.words || [];
   const grammars = analysis.grammars || [];
    const page = analysis.page;

  // P7.4 — reject an oversized item count before any Firestore write is
  // attempted (see requestValidation.ts for why).
  const countValidation = validateSaveItemsCounts(words, grammars);
  if (!countValidation.ok) {
    logger.warn(
      `Rejected oversized saveItems request: words=${words.length} grammars=${grammars.length}`
    );
    throw new functions.https.HttpsError(
      "invalid-argument",
      countValidation.error ?? "Invalid request"
    );
  }
   // v0.4 P1: a save is "shared" ONLY when the client explicitly sets
   // is_shared === true. Anything else is a personal save and is auth-gated
   // below — a malformed / spoofed is_shared can no longer route a personal
   // write around authentication.
   const isShared = analysis.is_shared === true;
   const metadata = analysis.metadata || {};

  // v0.4 P1 auth hardening — personal saves.
  //
  // saveItems runs on the Admin SDK, which bypasses Firestore security rules,
  // so the handler MUST authorize personal writes itself. Previously it trusted
  // the client-supplied `userId` verbatim, which let any caller write under an
  // arbitrary users/{uid} subtree. Now a personal save requires a Firebase Auth
  // context, and the target user is ALWAYS the authenticated uid (never the
  // client field). A present-but-mismatched `userId` is rejected outright as a
  // sign of a confused or malicious client.
  //
  // Shared saves are unchanged: still unauthenticated, still writing to the
  // public shared_* root collections, and never producing learning items.
  let personalUserId: string | null = null;
  if (!isShared) {
    const authUid: string | undefined = request.auth?.uid;
    if (!authUid) {
      logger.warn("Rejected unauthenticated personal save");
      throw new functions.https.HttpsError(
        "unauthenticated",
        "You must be signed in to save to your personal collection"
      );
    }
    if (userId != null && userId !== authUid) {
      logger.warn("Rejected personal save: userId does not match authenticated user");
      throw new functions.https.HttpsError(
        "permission-denied",
        "userId does not match the authenticated user"
      );
    }
    personalUserId = authUid;
  }

  logger.info(`saveItems received`, {
    userId: personalUserId || 'shared',
    is_shared: isShared,
    words_count: words.length,
    grammars_count: grammars.length,
    has_metadata: Object.keys(metadata).length > 0,
  });

  try {
    const firestoreService = new FirestoreService();

    // Personal writes target the authenticated uid; shared writes pass null so
    // the service routes them to the shared_* root collections.
    const writeUserId = isShared ? null : personalUserId;

    // Save vocabulary items
    const wordsSaved = await firestoreService.saveVocabulary(
      writeUserId,
      words,
      isShared,
      metadata
    );

    // Save grammar items
    const grammarsSaved = await firestoreService.saveGrammar(
      writeUserId,
      grammars,
      isShared,
      metadata
    );

    let pageSaved = false;
    let learningItemsCount = 0;

    if (page) {
      if (isShared) {
        pageSaved = await firestoreService.saveAnalysisPage(
          null,
          page,
          true,
          metadata
        );
      } else {
        // Personal path: page + derived learning items in one atomic batch.
        // One save = exactly one analysis_pages document. Learning items are
        // derived from the already-parsed structured_json (no markdown
        // reparse, no LLM call) and every item's sourceAnalysisId is the id of
        // the page written in the same batch.
        const now = Date.now();
        const result = await firestoreService.savePersonalAnalysisPage(
          personalUserId as string,
          page,
          metadata,
          (sourceAnalysisId) =>
            deriveLearningItems(
              page.structured_json ?? null,
              {
                sourceText: metadata.source_text ?? "",
                sourceUrl: metadata.source_url ?? null,
              },
              sourceAnalysisId,
              { userId: personalUserId as string, now }
            )
        );
        pageSaved = result.pageId != null;
        learningItemsCount = result.learningItemsCount;
      }
    }

    const response: SaveItemsResponse = {
      success: true,
      message: isShared
        ? "Items saved to shared collection"
        : "Items saved successfully",
      saved: {
        words_count: wordsSaved,
        grammars_count: grammarsSaved,
        page_saved: pageSaved,
        learning_items_count: learningItemsCount,
      },
    };

    logger.info(`Successfully saved items`, {
      userId: personalUserId || 'shared',
      is_shared: isShared,
      words_saved: wordsSaved,
      grammars_saved: grammarsSaved,
      learning_items_saved: learningItemsCount,
    });

    return response;
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    logger.error("Error in saveItems callable", error);
    throw new functions.https.HttpsError(
      "internal",
      error instanceof Error ? error.message : "Failed to save items"
    );
  }
}
