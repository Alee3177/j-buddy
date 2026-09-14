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

  // v0.4 P1 auth hardening (personal saves), extended P7.4 to shared saves.
  //
  // saveItems runs on the Admin SDK, which bypasses Firestore security rules,
  // so the handler MUST authorize every write itself. Previously it trusted
  // the client-supplied `userId` verbatim for personal saves, which let any
  // caller write under an arbitrary users/{uid} subtree — now the target user
  // is ALWAYS the authenticated uid (never the client field), and a
  // present-but-mismatched `userId` is rejected outright as a sign of a
  // confused or malicious client.
  //
  // P7.4: shared saves were unauthenticated, which let anyone repeatedly call
  // saveItems(is_shared=true) and spam the public shared_* collections /
  // generate Firestore write cost with no rate limit at all (unlike
  // explain/explainStreamCallable, which are public but rate-limited).
  // Publication now requires the SAME Firebase Auth context as a personal
  // save — this keeps analysis itself (explain/explainStreamCallable) public,
  // but any write via saveItems, personal or shared, requires a signed-in
  // caller. Shared documents remain publicly READABLE per firestore.rules
  // (unchanged) and are still written anonymously (no author uid is stored on
  // the document) — only the ability to invoke the write is now auth-gated.
  const authUid: string | undefined = request.auth?.uid;
  if (!authUid) {
    logger.warn(`Rejected unauthenticated ${isShared ? "shared" : "personal"} save`);
    throw new functions.https.HttpsError(
      "unauthenticated",
      isShared
        ? "You must be signed in to share items with other learners"
        : "You must be signed in to save to your personal collection"
    );
  }
  if (userId != null && userId !== authUid) {
    logger.warn("Rejected save: userId does not match authenticated user");
    throw new functions.https.HttpsError(
      "permission-denied",
      "userId does not match the authenticated user"
    );
  }
  const personalUserId: string | null = isShared ? null : authUid;

  logger.info(`saveItems received`, {
    userId: personalUserId || 'shared',
    is_shared: isShared,
    words_count: words.length,
    grammars_count: grammars.length,
    has_metadata: Object.keys(metadata).length > 0,
  });

  try {
    const firestoreService = new FirestoreService();

    if (isShared) {
      // P7.4 — shared-collection deduplication. The page save (if any) is
      // attempted FIRST so its dedup result is known before touching
      // shared_vocabularies/shared_grammars: when the page already exists
      // (same normalized source text), the vocab/grammar for THIS save are
      // skipped too, rather than left as duplicates "orphaned" from a page
      // that was never (re)created. A save with no page at all has no
      // source-text identity to dedupe against and keeps its original
      // (non-deduplicated) behavior.
      let pageSaved = false;
      let alreadyExists = false;
      if (page) {
        const pageResult = await firestoreService.saveAnalysisPage(
          null,
          page,
          true,
          metadata
        );
        pageSaved = pageResult.saved;
        alreadyExists = pageResult.alreadyExists;
      }

      let wordsSaved = 0;
      let grammarsSaved = 0;
      if (!alreadyExists) {
        wordsSaved = await firestoreService.saveVocabulary(
          null,
          words,
          true,
          metadata
        );
        grammarsSaved = await firestoreService.saveGrammar(
          null,
          grammars,
          true,
          metadata
        );
      }

      const response: SaveItemsResponse = {
        success: true,
        message: alreadyExists
          ? "This analysis already exists in the shared collection"
          : "Items saved to shared collection",
        alreadyExists,
        saved: {
          words_count: wordsSaved,
          grammars_count: grammarsSaved,
          page_saved: pageSaved,
          learning_items_count: 0,
        },
      };

      logger.info(`Successfully processed shared save`, {
        already_exists: alreadyExists,
        words_saved: wordsSaved,
        grammars_saved: grammarsSaved,
        page_saved: pageSaved,
      });

      return response;
    }

    // Personal path — unchanged (not deduplicated in this phase).
    const wordsSaved = await firestoreService.saveVocabulary(
      personalUserId,
      words,
      false,
      metadata
    );

    const grammarsSaved = await firestoreService.saveGrammar(
      personalUserId,
      grammars,
      false,
      metadata
    );

    let pageSaved = false;
    let learningItemsCount = 0;

    if (page) {
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

    const response: SaveItemsResponse = {
      success: true,
      message: "Items saved successfully",
      saved: {
        words_count: wordsSaved,
        grammars_count: grammarsSaved,
        page_saved: pageSaved,
        learning_items_count: learningItemsCount,
      },
    };

    logger.info(`Successfully saved items`, {
      userId: personalUserId,
      is_shared: false,
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
