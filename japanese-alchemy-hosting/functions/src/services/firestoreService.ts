import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import {
  VocabularyItem,
  GrammarItem,
  AnalysisPageItem,
  StructuredAnalysis,
} from "../models/types";
import { LearningItem, NewLearningItem } from "../models/learningItem";

export class FirestoreService {
  private db: admin.firestore.Firestore;

  constructor() {
    this.db = admin.firestore();
  }

  async saveVocabulary(
    userId: string | null, 
    words: Array<{ term: string; [key: string]: any }>,
    isShared: boolean = false,
    metadata: any = {}
  ): Promise<number> {
    if (!words || words.length === 0) {
      return 0;
    }

    const batch = this.db.batch();
    // Determine collection path based on shared flag
    const vocabulariesRef = isShared 
      ? this.db.collection('shared_vocabularies')
      : this.db.collection(`users/${userId}/vocabularies`);
    const timestamp = Date.now();

    words.forEach((word) => {
      const docRef = vocabulariesRef.doc();
      const vocabularyItem: VocabularyItem = {
        term: word.term,
        detail: JSON.stringify(word),
        createdAt: timestamp,
      };
      // Add metadata if saving to shared collection
      if (isShared && Object.keys(metadata).length > 0) {
        (vocabularyItem as any).metadata = metadata;
      }
      batch.set(docRef, vocabularyItem);
    });

    await batch.commit();
    const logMessage = isShared 
      ? `Saved ${words.length} vocabulary items to shared collection`
      : `Saved ${words.length} vocabulary items for user ${userId}`;
    functions.logger.info(logMessage);
    return words.length;
  }

  async saveGrammar(
    userId: string | null, 
    grammars: Array<{ point: string; [key: string]: any }>,
    isShared: boolean = false,
    metadata: any = {}
  ): Promise<number> {
    if (!grammars || grammars.length === 0) {
      return 0;
    }

    const batch = this.db.batch();
    // Determine collection path based on shared flag
    const grammarsRef = isShared 
      ? this.db.collection('shared_grammars')
      : this.db.collection(`users/${userId}/grammars`);
    const timestamp = Date.now();

    grammars.forEach((grammar) => {
      const docRef = grammarsRef.doc();
      const grammarItem: GrammarItem = {
        point: grammar.point,
        explanation: JSON.stringify(grammar),
        createdAt: timestamp,
      };
      // Add metadata if saving to shared collection
      if (isShared && Object.keys(metadata).length > 0) {
        (grammarItem as any).metadata = metadata;
      }
      batch.set(docRef, grammarItem);
    });

    await batch.commit();
    const logMessage = isShared 
      ? `Saved ${grammars.length} grammar items to shared collection`
      : `Saved ${grammars.length} grammar items for user ${userId}`;
    functions.logger.info(logMessage);
    return grammars.length;
  }

  async getUserVocabularies(userId: string, limit?: number): Promise<VocabularyItem[]> {
    const query = this.db
      .collection(`users/${userId}/vocabularies`)
      .orderBy("createdAt", "desc")
      .limit(limit || 50);

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as VocabularyItem[];
  }

  async getUserGrammars(userId: string, limit?: number): Promise<GrammarItem[]> {
    const query = this.db
      .collection(`users/${userId}/grammars`)
      .orderBy("createdAt", "desc")
      .limit(limit || 50);

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as GrammarItem[];
  }

  async saveAnalysisPage(
    userId: string | null,
    page: { rendered_markdown: string; structured_json?: StructuredAnalysis },
    isShared: boolean = false,
    metadata: any = {}
  ): Promise<boolean> {
    if (!page || !page.rendered_markdown) {
      return false;
    }

    const pagesRef = isShared
      ? this.db.collection('shared_analysis_pages')
      : this.db.collection(`users/${userId}/analysis_pages`);
    const timestamp = Date.now();

    const pageItem: AnalysisPageItem = {
      rendered_markdown: page.rendered_markdown,
      source_text: metadata.source_text || '',
      source_url: metadata.source_url || '',
      saved_at: metadata.saved_at || new Date().toISOString(),
      createdAt: timestamp,
    };
    if (page.structured_json) {
      pageItem.structured_json = page.structured_json;
    }

    await pagesRef.add(pageItem);
    const logMessage = isShared
      ? `Saved analysis page to shared collection`
      : `Saved analysis page for user ${userId}`;
    functions.logger.info(logMessage);
    return true;
  }

  /**
   * Japanese Reader v0.4 P1 — personal save path only.
   *
   * Writes the immutable analysis page AND its derived LearningItem review
   * records in a SINGLE Firestore batch, so a save either lands both or neither
   * (see saveItemsCallable for the shared path, which still uses
   * saveAnalysisPage). The page document id is generated locally before the
   * commit and passed to `deriveItems` so every LearningItem's
   * `sourceAnalysisId` points at the exact page written in this same batch.
   *
   * Never touches a shared root collection. Callers must have already verified
   * that `userId` is the authenticated user.
   *
   * Batch size is 1 (page) + N (items); N is bounded by the analysed text's
   * vocab/grammar count (≪ the 500-write batch limit given the 500-char input
   * ceiling), so no chunking is needed.
   */
  async savePersonalAnalysisPage(
    userId: string,
    page: { rendered_markdown: string; structured_json?: StructuredAnalysis },
    metadata: any = {},
    deriveItems: (sourceAnalysisId: string) => NewLearningItem[]
  ): Promise<{ pageId: string | null; learningItemsCount: number }> {
    if (!page || !page.rendered_markdown) {
      return { pageId: null, learningItemsCount: 0 };
    }

    const batch = this.db.batch();

    const pageRef = this.db.collection(`users/${userId}/analysis_pages`).doc();
    const pageItem: AnalysisPageItem = {
      rendered_markdown: page.rendered_markdown,
      source_text: metadata.source_text || "",
      source_url: metadata.source_url || "",
      saved_at: metadata.saved_at || new Date().toISOString(),
      createdAt: Date.now(),
    };
    if (page.structured_json) {
      pageItem.structured_json = page.structured_json;
    }
    batch.set(pageRef, pageItem);

    const items = deriveItems(pageRef.id);
    const learningItemsRef = this.db.collection(`users/${userId}/learning_items`);
    for (const item of items) {
      const itemRef = learningItemsRef.doc();
      // The stored document's `id` field IS the Firestore document id.
      const stored: LearningItem = { ...item, id: itemRef.id };
      batch.set(itemRef, stored);
    }

    await batch.commit();

    functions.logger.info(
      `Saved analysis page + ${items.length} learning item(s) for user ${userId}`
    );
    return { pageId: pageRef.id, learningItemsCount: items.length };
  }
}
