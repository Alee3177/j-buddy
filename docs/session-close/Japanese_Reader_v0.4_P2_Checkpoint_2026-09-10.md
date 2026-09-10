# Japanese Reader v0.4 — P2 Checkpoint (COMPLETE WITH NOTES / NOT PUSHED)

**Date:** 2026-09-10
**Project:** J-Buddy → Language Agent / Japanese Reader
**Branch:** `feature/japanese-reader-v0.4`
**Scope of this document:** record the completed P0 + P1 + P2 state and the exact
resume point for the next session. Documentation only — no source/test changes,
no commit, no push, no deploy.

---

## 1. Final Git State

```text
branch          feature/japanese-reader-v0.4
HEAD            48a0aa5  test(reader): add learning items pipeline integration coverage
working tree    clean (nothing to commit)

main            fb56056  docs: close Japanese Reader v0.3 integration   (UNTOUCHED)
origin/main     fb56056  (identical to main)

feature/japanese-reader-v0.4 vs origin/main:  +5 ahead / 0 behind
push status     NOT PUSHED  (all 5 feature commits are local only)
```

- `main` has **not** been modified, merged into, or rebased.
- The feature branch has **no upstream tracking ref** and has never been pushed.
- No deploy, no Firestore migration, no backfill has been performed.

---

## 2. Phase Status

| Phase | Status | Summary |
|---|---|---|
| **P0** | **COMPLETE** | Pure model / extraction layer: `LearningItem` entity + `deriveLearningItems()` (deterministic, side-effect-free, no Firestore/LLM). vocab + grammar only; `status` always `NEW`; `reading`/`meaning` extracted only from explicit labelled lines; no dedup. |
| **P1** | **COMPLETE** | Personal `learning_items` persistence. Auth hardening: personal saves require `request.auth` and always write under the authenticated uid (never the client `userId`). `analysis_pages` doc + all derived `learning_items` written in **one atomic Firestore batch**; every item's `sourceAnalysisId` is the id of the page written in that same batch. Shared saves unchanged (still unauthenticated, still `shared_*`, still derive 0 items). |
| **P2.1** | **COMPLETE** | Direct Firestore **client** read. Query `users/{auth.uid}/learning_items`, `orderBy(createdAt desc)` + `orderBy(documentId() desc)`, `startAfter(createdAt, id)`. Cursor = `base64url(JSON.stringify({ createdAt, id }))`, fails closed on malformed input. Default page size **20**, max **100** (clamped, not rejected). Raw occurrence semantics — no kind filter, no grouping/dedup, no SRS. No `firestore.indexes.json` change. |
| **P2.2** | **COMPLETE** | Webapp **read-only** `學習項目` dashboard tab (signed-in only). Explicit `loading / empty / success / error` states. Vocabulary + grammar occurrence cards (type badge, furigana surface, reading, meaning, source sentence, safe source link, saved date). `載入更多` pagination via `nextCursor`; disabled while pending; double-click guarded; failure keeps loaded items. Auth-aware: sign-out clears the list, user switch resets cursor + reloads, stale in-flight responses discarded. No edit / delete / filter / search / SRS controls. |
| **P2.3** | **PASS WITH NOTES** | Deterministic P1→P2.1→P2.2 integration simulation (real modules across every seam; only the Firestore transport faked). **75/75** webapp tests, `tsc --noEmit` clean, changed-file lint clean, `next build` compile + TypeScript phases pass, no new regressions. Live Firebase/emulator smoke **NOT RUN** — see §8. |

---

## 3. Exact Commit Chain

```text
48a0aa5  test(reader): add learning items pipeline integration coverage   ← HEAD (P2.3)
e6702a9  feat(reader): add learning items webapp tab                       ← P2.2
df1641e  feat(reader): add learning items read service                     ← P2.1
25e1b44  feat(reader): persist personal learning items                     ← P1
cbdf6c3  feat(learning): add LearningItem extractor                        ← P0
fb56056  docs: close Japanese Reader v0.3 integration                      ← main / origin/main (base)
```

All five feature commits carry the `Co-Authored-By: Claude Sonnet 5` /
`Claude-Session:` trailers. No rebase, squash, or SHA rewrite.

---

## 4. P2 Architecture Summary

Full personal learning-items data flow (managed / personal save path):

```text
Chrome extension  ──saveItems({ analysis: { page: { structured_json }, metadata }, userId? })──►
                                                                                                │
  Firebase Functions (Admin SDK, onCall)                                                         ▼
    saveItemsCallable
      ├─ auth gate: personal save ⇒ require request.auth.uid; reject mismatched client userId
      └─ FirestoreService.savePersonalAnalysisPage(uid, page, metadata, deriveItems)
             │
             ├─ deriveLearningItems(structured_json, pageMeta, sourceAnalysisId, { userId, now })
             │        → NewLearningItem[]   (vocab then grammar, in input order, no dedup)
             │
             └─ ONE batch:  users/{uid}/analysis_pages/{pageId}        (immutable source artifact)
                            users/{uid}/learning_items/{autoId} × N    (stored doc: {...item, id})
                                    every item.sourceAnalysisId === pageId

  ── later, in the webapp ──────────────────────────────────────────────────────────────────────

  Next.js webapp (Firebase client SDK, browser)
    app/page.tsx  ──useLearningItemsFeed(user?.uid ?? null, !authLoading)──►
      lib/learningItemsFeed.ts
        ├─ runFirstPage / runNextPage  ──►  services/firestoreService.ts
        │                                     listLearningItems({ limit?, cursor? })
        │                                       query users/{auth.currentUser.uid}/learning_items
        │                                         orderBy(createdAt desc), orderBy(documentId() desc)
        │                                         [startAfter(cursor.createdAt, cursor.id)]
        │                                         limit(pageSize + 1)      ← +1 probes "has next page"
        │                                       → { items: LearningItem[], nextCursor: string | null }
        │
        └─ learningItemsFeedReducer  (RESET / FIRST_PAGE_* / NEXT_PAGE_*)
               → LearningItemsFeedState { phase, items, cursor, loadingMore, loadMoreFailed }
                     │
                     ▼
          components/LearningItemsPanel.tsx   (pure, read-only render)
                     │
                     ▼
          Webapp「學習項目」tab
```

Condensed:

```text
structured_json
  → deriveLearningItems()
  → savePersonalAnalysisPage()          (atomic: analysis_pages + learning_items)
  → users/{uid}/learning_items
  → listLearningItems()                 (direct client read, cursor-paginated)
  → useLearningItemsFeed()              (reducer + auth lifecycle)
  → LearningItemsPanel                  (read-only presentation)
  → Webapp「學習項目」tab
```

### Files owning each phase

| Concern | File |
|---|---|
| P0 model + extractor | `japanese-alchemy-hosting/functions/src/models/learningItem.ts` |
| P1 callable + auth gate | `japanese-alchemy-hosting/functions/src/v1/saveItemsCallable.ts` |
| P1 atomic batch write | `japanese-alchemy-hosting/functions/src/services/firestoreService.ts` (`savePersonalAnalysisPage`) |
| P1 response field | `japanese-alchemy-hosting/functions/src/models/types.ts` (`SaveItemsResponse.saved.learning_items_count`) |
| P2.1 read + cursor | `japanese-alchemy-webapp/services/firestoreService.ts` (`listLearningItems`, `encode/decodeLearningItemsCursor`) |
| P2.1 read model types | `japanese-alchemy-webapp/types/index.ts` (`LearningItem`, `LearningItemsCursor`, `ListLearningItemsOptions`, `ListLearningItemsResult`) |
| P2.2 feed state + hook | `japanese-alchemy-webapp/lib/learningItemsFeed.ts` |
| P2.2 presentation | `japanese-alchemy-webapp/components/LearningItemsPanel.tsx` |
| P2.2 tab wiring | `japanese-alchemy-webapp/app/page.tsx` |
| P2 test infra | `japanese-alchemy-webapp/vitest.config.mts` (mirrors the tsconfig `@/*` alias for Vitest) |
| P2.3 integration sim | `japanese-alchemy-webapp/test/learningItemsPipeline.integration.test.tsx` |

---

## 5. Security Model

| Property | Record |
|---|---|
| **Write identity** | Personal saves: `request.auth.uid` only. `saveItemsCallable` rejects an unauthenticated personal save (`unauthenticated`) and rejects a request whose client `userId` ≠ `request.auth.uid` (`permission-denied`). The Admin SDK bypasses rules, so the handler authorizes the write itself. |
| **Read identity** | `auth.currentUser.uid` only, read inside `listLearningItems()`. No `userId` parameter exists on the read API. A `null` current user throws **before any Firestore query**. |
| **Caller-supplied userId** | Not used on the personal read or write path. Present-but-mismatched `userId` on a personal save is an explicit rejection; the read API has no such field. |
| **Collection location** | `learning_items` live only under `users/{uid}/learning_items`. No root-level or collection-group `learning_items`. |
| **Shared learning_items** | Do **not** exist. `deriveLearningItems` runs only on the personal path; shared saves derive 0 items. There is no `shared_learning_items` collection and P2 exposes none. |
| **Firestore rules** | `match /users/{userId}/{document=**} { allow read, write: if isOwner(userId) }` already covers `learning_items`. **No rules change was made or is needed** for P2. |
| **P1 security audit** | Clean (recorded at P1 close). |

---

## 6. Pagination Contract

| Aspect | Value |
|---|---|
| Ordering | `orderBy('createdAt', 'desc')` then `orderBy(documentId(), 'desc')` |
| Why the doc-id key | Every item derived from one save shares an identical `createdAt`; the document-id tiebreak makes the page boundary stable. |
| Cursor encoding | `base64url(JSON.stringify({ createdAt, id }))` — the `createdAt` + `id` of the last returned item; contains no uid and no Firestore path |
| Cursor continuation | `startAfter(cursor.createdAt, cursor.id)` |
| Malformed cursor | Fails closed — `decodeLearningItemsCursor` throws `Invalid learning-items cursor`; no query is issued |
| Page size | default **20**, max **100** (over-max clamped, non-finite/≤0 → default) |
| "Has next page?" | Fetch `limit(pageSize + 1)`; `hasMore = fetched > pageSize`; return at most `pageSize` |
| `nextCursor` | encoded from the last returned item when `hasMore`, else `null` |
| Occurrence semantics | Raw — pages appended in returned order, **no client-side dedup**, no re-sort, no grouping by `lexicalKey` |
| UI control | `載入更多` button only; hidden when `nextCursor === null`; disabled while a request is pending. **No infinite scroll.** |
| Malformed persisted row | Skipped (not fabricated, not thrown) — a row must have a finite numeric `createdAt` and non-empty `id` to be returned. |

---

## 7. Test / Verification Summary

### P1 (recorded at P1 close)
- Hosting test suite: **331/331** passing in bounded/serial mode.
- Project code type errors: **0**.
- Security audit: clean.

### P2.1 (commit `df1641e`)
- Webapp tests: **33/33** (`services/firestoreService.test.ts` extended with 22 new cases: auth, path, cursor round-trip + malformed, default/max limit, ordering, pagination, empty, duplicate `lexicalKey`, `sourceAnalysisId` passthrough, no shared-collection access, query-failure propagation).
- `npx tsc --noEmit`: PASS.
- Changed-file `eslint`: PASS (0 problems).

### P2.2 (commit `e6702a9`)
- Webapp tests: **69/69** (36 new: reducer + async runners 13, `LearningItemsPanel` render 15, `useLearningItemsFeed` lifecycle 8).
- `npx tsc --noEmit`: PASS.
- Changed-file `eslint`: PASS (0 problems).
- `next build` compile + TypeScript phases: PASS.

### P2.3 (commit `48a0aa5`)
- Webapp tests: **75/75** (6 new integration tests in `test/learningItemsPipeline.integration.test.tsx`).
- Deterministic P1→P2.1→P2.2 integration simulation: **PASS** — real `deriveLearningItems` (imported from `japanese-alchemy-hosting`) → docs persisted as `savePersonalAnalysisPage` writes them → real `listLearningItems` (cursor round-trip, ordering, 3-page pagination, no dedup, final-page control hiding, empty state, signed-out rejection) → real `learningItemsFeedReducer` → real `LearningItemsPanel` render.
- `npx tsc --noEmit`: PASS (including the cross-package import).
- Changed-file `eslint`: PASS.
- `next build` compile + TypeScript phases: PASS.
- **No external API / network calls** — Firestore transport faked with an in-memory store that honours `orderBy` / `startAfter` / `limit`.

---

## 8. Known Notes / Deferred Items

### A. Live Firebase smoke — NOT RUN
Reasons (all environmental, none a code defect):
- `japanese-alchemy-webapp/.env.local` is **missing** (only `.env.local.example` present).
- All six `NEXT_PUBLIC_FIREBASE_*` variables are **missing** → the webapp cannot boot (`getAuth()` throws `auth/invalid-api-key` at module load).
- `firebase` CLI is **not installed** (global, webapp, hosting).
- **Java is not installed** → the Firestore emulator cannot run.
- The webapp `firebase.json` has **no `emulators` block** (only the hosting `firebase.json` does).

### B. Live checks explicitly deferred
- Real Firebase Auth resolution in a browser.
- Real Firestore security-rule enforcement (`permission-denied` on a foreign uid).
- Live composite-index `FAILED_PRECONDITION` confirmation.
- Real browser render of the `學習項目` tab.

### C. Current index conclusion
- **No composite index is expected** for the current P2 query. `orderBy(createdAt desc) + orderBy(documentId() desc)` on a subcollection uses only Firestore's built-in single-field + `__name__` indexes — structurally identical to the webapp's already-shipped `getUserVocabularies` / `getUserGrammars` subcollection reads, which run in production with no dedicated index.
- `firestore.indexes.json` was **not** modified.
- An emulator / live smoke to confirm this against real Firestore is still **recommended** before deploy.

### D. Pre-existing environment issues (NOT P2 regressions)
- `next build` static prerender fails without `.env.local` — identical failure signature on `fb56056` (base) and on every P2 commit.
- Whole-project `npm run lint` reports 4 pre-existing problems: `app/auth/page.tsx` (2 × `no-explicit-any`), `contexts/ThemeContext.tsx` (`set-state-in-effect`), `lib/firebase.ts` (unused-var warning). **None in any P0/P1/P2 file.**

---

## 9. Scope Explicitly NOT Implemented

- No `kind` / type filter on the read or UI.
- No search.
- No grouping / dedup by `lexicalKey` (raw occurrences only).
- No edit / delete of learning items.
- No review / SRS fields (`dueAt`, `interval`, `ease`, `lapseCount`, `lastReviewedAt`, `reviewCount`, `suspended`, …).
- No status-mutation write path (P1 only *creates* items; `status` is always `NEW`).
- No migration / backfill of pre-P1 saved analyses (their `學習項目` tab is legitimately empty).
- No shared learning-items flow.
- No callable / server API for reads (direct client read only).
- No deploy, no push, no `main` merge.

---

## 10. Current Gate

```text
P0:  COMPLETE
P1:  COMPLETE
P2:  COMPLETE WITH NOTES   (P2.1 + P2.2 complete; P2.3 = PASS WITH NOTES)

Live Firebase smoke:  DEFERRED

main merge:  NOT YET
push:        NOT YET
deploy:      NOT YET
```

---

## 11. Recommended Next Phase

**P3 — audit / design before any implementation.**

Candidate P3 scope to be defined by the audit (do NOT implement in that session):
- Review / SRS data model — which fields, all additive + optional.
- Due / review state (`dueAt`, interval, ease/difficulty, lapse count, last-reviewed, review count, suspended/archived).
- Scheduling semantics (algorithm, when `dueAt` advances, timezone handling).
- Whether occurrence → review-card **grouping by `lexicalKey`** is required, and if so which occurrence's `reading` / `meaning` / `sourceSentence` represents the group.
- Mutation / update contract — almost certainly a **callable** (Admin-side transition validation + `updatedAt` bump), since P2 deliberately ships read-only.
- Whether a due-state query needs a `dueAt` composite index.
- Optional opt-in backfill for pre-P1 saved analyses.

**Do not implement P3 in this session.** Run the live Firebase/emulator smoke (§8) whenever an environment with `.env.local` or a runnable emulator becomes available — ideally before P3 implementation, at latest before deploy.

---

## 12. Resume Commands

```bash
cd D:\J-Buddy-Dev\j-buddy
git checkout feature/japanese-reader-v0.4
git status
git log -6 --oneline --decorate
```

Expected:

```text
HEAD            48a0aa5  test(reader): add learning items pipeline integration coverage
working tree    clean

git log -6 --oneline --decorate:
48a0aa5 (HEAD -> feature/japanese-reader-v0.4) test(reader): add learning items pipeline integration coverage
e6702a9 feat(reader): add learning items webapp tab
df1641e feat(reader): add learning items read service
25e1b44 feat(reader): persist personal learning items
cbdf6c3 feat(learning): add LearningItem extractor
fb56056 (origin/main, origin/HEAD, main) docs: close Japanese Reader v0.3 integration
```

If a live smoke environment is available, also:

```bash
cd japanese-alchemy-webapp
cp .env.local.example .env.local     # fill in real NEXT_PUBLIC_FIREBASE_* values
npm install
npm run dev                          # sign in, open the 學習項目 tab, exercise Load More
```

---

## 13. Session Close Summary

```text
┌─ Japanese Reader v0.4 — P2 CHECKPOINT ──────────────────────────────────────┐
│ Date            2026-09-10                                                   │
│ Branch          feature/japanese-reader-v0.4                                 │
│ HEAD            48a0aa5  test(reader): add learning items pipeline integ.    │
│ Working tree    clean                                                       │
│ main            fb56056  UNTOUCHED (= origin/main)                          │
│ Branch state    +5 ahead / 0 behind origin/main · NOT PUSHED                │
│                                                                            │
│ P0  COMPLETE    model + deriveLearningItems()                               │
│ P1  COMPLETE    personal learning_items persistence · auth hardening ·      │
│                 analysis_page + learning_items atomic batch                 │
│ P2.1 COMPLETE   direct client read · users/{uid}/learning_items ·           │
│                 createdAt DESC + documentId DESC · base64url {createdAt,id}  │
│                 cursor · default 20 / max 100 · raw occurrences ·           │
│                 no kind filter / grouping / SRS · no index change           │
│ P2.2 COMPLETE   read-only 學習項目 tab · loading/empty/success/error ·      │
│                 vocab + grammar cards · Load More · auth-aware reset ·       │
│                 safe sourceUrl · no edit/delete/filter/search/SRS           │
│ P2.3 PASS WITH NOTES  P1→P2.1→P2.2 integration sim · 75/75 webapp tests ·   │
│                 tsc clean · changed-file lint clean · next build compile OK │
│                                                                            │
│ Live Firebase smoke   NOT RUN (no .env.local / CLI / Java / emulator)       │
│ Composite index       NONE expected; live confirmation deferred             │
│ Deploy / push / merge NOT YET                                               │
│                                                                            │
│ NEXT   P3 audit/design — review/SRS model, due state, scheduling,           │
│        occurrence→card grouping, mutation contract. Do not implement.       │
└────────────────────────────────────────────────────────────────────────────┘
```
