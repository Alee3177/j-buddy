/**
 * Japanese Reader v0.4 — P4.3 Firestore rules tests for `users/{uid}/review_cards`.
 *
 * Runs against the Firestore emulator via `@firebase/rules-unit-testing`. It is
 * EXCLUDED from the default `vitest run` (see vitest.config.mts) and executed by
 * `npm run test:rules`, which CI wraps in `firebase emulators:exec`. It CANNOT
 * run on a machine without Java / the emulator.
 *
 * Rules under test: japanese-alchemy-hosting/firestore.rules
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const RULES_PATH = fileURLToPath(
  new URL('../../japanese-alchemy-hosting/firestore.rules', import.meta.url)
);

const OWNER = 'alice';
const OTHER = 'mallory';
const CARD_ID = 'dm9jYWJ8Y2FyZHxr'; // any base64url-charset string
const cardPath = (uid: string) => `users/${uid}/review_cards/${CARD_ID}`;

function validCard(overrides: Record<string, unknown> = {}) {
  return {
    id: CARD_ID,
    userId: OWNER,
    lexicalKey: 'vocab|改善|かいぜん',
    type: 'vocab',
    state: 'learning',
    dueAt: 1_700_000_000_000,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    lastRating: null,
    lastReviewedAt: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    surface: '{改善|かいぜん}',
    reading: 'かいぜん',
    meaning: '使變得更好',
    sourceSentence: '制度を改善する。',
    sourceUrl: 'https://example.com/a',
    sourceAnalysisId: 'page-1',
    sourceLearningItemId: 'li-1',
    ...overrides,
  };
}

let testEnv: RulesTestEnvironment;
const ownerDb = () => testEnv.authenticatedContext(OWNER).firestore() as unknown as Firestore;
const otherDb = () => testEnv.authenticatedContext(OTHER).firestore() as unknown as Firestore;
const anonDb = () => testEnv.unauthenticatedContext().firestore() as unknown as Firestore;

async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as unknown as Firestore, path), data);
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-japanese-alchemy',
    firestore: { rules: readFileSync(RULES_PATH, 'utf8') },
  });
});
afterAll(async () => {
  // Unset if beforeAll failed (e.g. run without the emulator).
  if (testEnv) {
    await testEnv.cleanup();
  }
});
beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('review_cards — read', () => {
  it('1. owner can read their own review card', async () => {
    await seed(cardPath(OWNER), validCard());
    await assertSucceeds(getDoc(doc(ownerDb(), cardPath(OWNER))));
  });

  it('2. unauthenticated read is denied', async () => {
    await seed(cardPath(OWNER), validCard());
    await assertFails(getDoc(doc(anonDb(), cardPath(OWNER))));
  });

  it('3. another user cannot read the card', async () => {
    await seed(cardPath(OWNER), validCard());
    await assertFails(getDoc(doc(otherDb(), cardPath(OWNER))));
  });
});

describe('review_cards — create', () => {
  it('4. valid owner create is allowed', async () => {
    await assertSucceeds(setDoc(doc(ownerDb(), cardPath(OWNER)), validCard()));
  });

  it('5. create with a mismatched userId is denied', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), cardPath(OWNER)), validCard({ userId: OTHER }))
    );
  });

  it('6. create with id != document path is denied', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), cardPath(OWNER)), validCard({ id: 'not-the-path' }))
    );
  });

  it('7. invalid type is denied', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), cardPath(OWNER)), validCard({ type: 'sentence' }))
    );
  });

  it('8. invalid state is denied', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), cardPath(OWNER)), validCard({ state: 'archived' }))
    );
  });

  it('9. invalid lastRating is denied', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), cardPath(OWNER)), validCard({ lastRating: 2 }))
    );
  });

  it('10. negative reps / lapses / intervalDays are denied', async () => {
    await assertFails(setDoc(doc(ownerDb(), cardPath(OWNER)), validCard({ reps: -1 })));
    await assertFails(setDoc(doc(ownerDb(), cardPath(OWNER)), validCard({ lapses: -1 })));
    await assertFails(
      setDoc(doc(ownerDb(), cardPath(OWNER)), validCard({ intervalDays: -3 }))
    );
    await assertFails(
      setDoc(doc(ownerDb(), cardPath(OWNER)), validCard({ intervalDays: 1.5 }))
    );
  });

  it('11. an extra field is denied', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), cardPath(OWNER)), validCard({ hacked: true }))
    );
  });

  it('12. a missing required field is denied', async () => {
    const { lexicalKey, ...withoutLexicalKey } = validCard();
    void lexicalKey;
    await assertFails(setDoc(doc(ownerDb(), cardPath(OWNER)), withoutLexicalKey));
  });

  it('13. a non-owner create is denied', async () => {
    await assertFails(
      setDoc(doc(otherDb(), cardPath(OWNER)), validCard({ userId: OWNER }))
    );
  });

  it('accepts null reading / meaning / sourceUrl / lastRating*', async () => {
    await assertSucceeds(
      setDoc(
        doc(ownerDb(), cardPath(OWNER)),
        validCard({ reading: null, meaning: null, sourceUrl: null })
      )
    );
  });
});

describe('review_cards — update', () => {
  const scheduleOnly = {
    state: 'review',
    dueAt: 1_700_100_000_000,
    intervalDays: 1,
    reps: 1,
    lapses: 0,
    lastRating: 3,
    lastReviewedAt: 1_700_050_000_000,
    updatedAt: 1_700_050_000_000,
  };

  it('14. a valid scheduling-only update is allowed', async () => {
    await seed(cardPath(OWNER), validCard());
    await assertSucceeds(updateDoc(doc(ownerDb(), cardPath(OWNER)), scheduleOnly));
  });

  it('15. changing surface is denied', async () => {
    await seed(cardPath(OWNER), validCard());
    await assertFails(
      updateDoc(doc(ownerDb(), cardPath(OWNER)), { ...scheduleOnly, surface: 'x' })
    );
  });

  it('16. changing lexicalKey is denied', async () => {
    await seed(cardPath(OWNER), validCard());
    await assertFails(
      updateDoc(doc(ownerDb(), cardPath(OWNER)), { ...scheduleOnly, lexicalKey: 'vocab|x|' })
    );
  });

  it('17. changing userId is denied', async () => {
    await seed(cardPath(OWNER), validCard());
    await assertFails(
      updateDoc(doc(ownerDb(), cardPath(OWNER)), { ...scheduleOnly, userId: OTHER })
    );
  });

  it('18. changing createdAt is denied', async () => {
    await seed(cardPath(OWNER), validCard());
    await assertFails(
      updateDoc(doc(ownerDb(), cardPath(OWNER)), { ...scheduleOnly, createdAt: 1 })
    );
  });

  it('19. adding an arbitrary field is denied', async () => {
    await seed(cardPath(OWNER), validCard());
    await assertFails(
      updateDoc(doc(ownerDb(), cardPath(OWNER)), { ...scheduleOnly, note: 'hi' })
    );
  });

  it('20. invalid scheduling values are denied', async () => {
    await seed(cardPath(OWNER), validCard());
    await assertFails(
      updateDoc(doc(ownerDb(), cardPath(OWNER)), { ...scheduleOnly, state: 'suspended' })
    );
    await assertFails(
      updateDoc(doc(ownerDb(), cardPath(OWNER)), { ...scheduleOnly, lastRating: 9 })
    );
    await assertFails(
      updateDoc(doc(ownerDb(), cardPath(OWNER)), { ...scheduleOnly, reps: -2 })
    );
  });

  it('21. a non-owner update is denied', async () => {
    await seed(cardPath(OWNER), validCard());
    await assertFails(updateDoc(doc(otherDb(), cardPath(OWNER)), scheduleOnly));
  });
});

describe('review_cards — delete', () => {
  it('22. delete is denied even for the owner (no remove-from-review UX)', async () => {
    await seed(cardPath(OWNER), validCard());
    await assertFails(deleteDoc(doc(ownerDb(), cardPath(OWNER))));
  });
});

describe('regression — other user subcollections unaffected', () => {
  it('23. owner can still create + read + delete their own learning_items', async () => {
    const path = `users/${OWNER}/learning_items/li-x`;
    await assertSucceeds(setDoc(doc(ownerDb(), path), { id: 'li-x', anything: 1 }));
    await assertSucceeds(getDoc(doc(ownerDb(), path)));
    await assertSucceeds(deleteDoc(doc(ownerDb(), path)));
    await assertFails(getDoc(doc(otherDb(), path)));
  });

  it('24. owner can still create + read + delete their own analysis_pages', async () => {
    const path = `users/${OWNER}/analysis_pages/page-x`;
    await assertSucceeds(setDoc(doc(ownerDb(), path), { rendered_markdown: '# x' }));
    await assertSucceeds(getDoc(doc(ownerDb(), path)));
    await assertSucceeds(deleteDoc(doc(ownerDb(), path)));
    await assertFails(setDoc(doc(otherDb(), path), { rendered_markdown: '# y' }));
  });

  it('25. shared collections stay publicly readable and client-unwritable', async () => {
    await seed('shared_vocabularies/sv-1', { term: '日本語', createdAt: 1 });
    await assertSucceeds(getDoc(doc(anonDb(), 'shared_vocabularies/sv-1')));
    await assertFails(
      setDoc(doc(ownerDb(), 'shared_vocabularies/sv-2'), { term: 'x', createdAt: 1 })
    );
  });

  it('an undeclared future user subcollection is read-allowed but write-denied', async () => {
    const path = `users/${OWNER}/future_thing/f-1`;
    await seed(path, { foo: 1 });
    await assertSucceeds(getDoc(doc(ownerDb(), path)));
    await assertFails(setDoc(doc(ownerDb(), path), { foo: 2 }));
  });
});

// Belt-and-suspenders: the rules file loads without a compile error (the
// emulator would reject a malformed ruleset in beforeAll).
it('rules file loaded into the emulator', () => {
  expect(testEnv).toBeDefined();
});
