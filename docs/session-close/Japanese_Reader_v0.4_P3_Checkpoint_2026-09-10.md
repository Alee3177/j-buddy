# Japanese Reader v0.4 — P3 Checkpoint (Review / SRS COMPLETE WITH NOTES / NOT PUSHED)

**Date:** 2026-09-10
**Project:** J-Buddy → Language Agent / Japanese Reader
**Branch:** `feature/japanese-reader-v0.4`
**Scope of this document:** record the completed P3 review/SRS implementation
(P3.1 design → P3.2 model+mutation → P3.3 due queue → P3.4 UI) and the exact
resume point for the next session. Documentation only — no source/test changes,
no commit, no push, no deploy, no rules/index changes.

Succeeds [`Japanese_Reader_v0.4_P2_Checkpoint_2026-09-10.md`](./Japanese_Reader_v0.4_P2_Checkpoint_2026-09-10.md).

---

## 1. Final Git State

```text
branch          feature/japanese-reader-v0.4
HEAD            72344c5  feat(reader): add minimal review session UI
working tree    clean (nothing to commit) — before this checkpoint doc

main            fb56056  docs: close Japanese Reader v0.3 integration   (UNTOUCHED)
origin/main     fb56056  (identical to main)

feature/japanese-reader-v0.4 vs main:  +9 ahead / 0 behind
push status     NOT DONE   (all 9 feature commits are local only)
deploy status   NOT DONE
```

- `main` / `origin/main` **not** modified, merged into, or rebased.
- The feature branch has **no upstream tracking ref** and has never been pushed.
- No deploy, no Firestore migration, no backfill.
- `firestore.rules` and `firestore.indexes.json` **unchanged** across all of P3.

---

## 2. Phase Status

| Phase | Status | Summary |
|---|---|---|
| **P0** | **COMPLETE** | Pure model / extractor: `LearningItem` + `deriveLearningItems()` (deterministic, no Firestore/LLM). |
| **P1** | **COMPLETE** | Personal `learning_items` persistence; auth-scoped write (`request.auth.uid`, reject mismatched client `userId`); `analysis_pages` doc + all derived `learning_items` in one atomic Firestore batch. |
| **P2** | **COMPLETE WITH NOTES** | Direct-client `listLearningItems` read service (cursor-paginated, raw occurrences); read-only `學習項目` tab (`useLearningItemsFeed` + `LearningItemsPanel`); deterministic P0→P1→P2 integration simulation. Live Firebase smoke deferred (no `.env.local` / CLI / emulator). |
| **P3.1** | **COMPLETE** | Review/SRS architecture audit + design. Chose: a **separate `ReviewCard` entity** (LearningItem stays immutable); deterministic review identity `cardId = base64url(lexicalKey)`; a **simple integer-day step schedule** (not SM-2/FSRS); 3-button rating (`Again`/`Good`/`Easy` = `1`/`3`/`4`); direct auth-scoped client mutation; explicit user-triggered materialisation; epoch-ms time with injected `now`. Verdict at the time: READY FOR P3 IMPLEMENTATION. |
| **P3.2** | **COMPLETE WITH NOTES** | `lib/reviewCard.ts` (pure model + scheduler + identity), `services/reviewService.ts` (`materializeReviewCard`, `applyReviewRating`). `cardId = base64url(utf8(lexicalKey))`; deterministic `computeNextSchedule`; both mutations run in a Firestore transaction — materialise is idempotent, rating touches only scheduling fields. 44 new tests. Notes: no live emulator for a real transaction-conflict test; `occurrenceCount` deferred. |
| **P3.3** | **COMPLETE WITH NOTES** | `listDueReviewCards()` — `where('dueAt','<=',now)` + `orderBy('dueAt','asc')` + `limit(≤50)`; `REVIEW_QUEUE_CAP = 50`; clamp-not-reject limit policy; skip-malformed-rows validation; no cursor / type filter / search / client sort; **no composite index required or added**. 17 new tests. Notes: live index `FAILED_PRECONDITION` check deferred. |
| **P3.4** | **COMPLETE WITH NOTES** | `加入複習` per-card action in the `學習項目` tab; new signed-in `複習` tab; `lib/reviewSession.ts` (`useReviewSession` hook + reducer) and `components/ReviewPanel.tsx`; front → `顯示答案` → `重來`/`良好`/`簡單` → `applyReviewRating` → auto-advance → exhaustion re-fetch → empty state; P2.2-grade auth lifecycle safety. `safeExternalUrl` extracted to `lib/textUtils.ts` and shared. 58 new tests. Notes: no live browser/Firebase smoke; `useReviewSession` uses the real clock in production (schedule math itself is tested with injected `now`). |

**Final P3 gate: COMPLETE WITH NOTES.**

---

## 3. Exact P3 Commit Chain

```text
72344c5  feat(reader): add minimal review session UI                 ← HEAD (P3.4)
f007d1b  feat(reader): add due review queue query                    ← P3.3
043f1b7  feat(reader): add review card model and mutation service    ← P3.2
8c7cf49  docs: add Japanese Reader v0.4 P2 checkpoint                 ← previous checkpoint
48a0aa5  test(reader): add learning items pipeline integration coverage
e6702a9  feat(reader): add learning items webapp tab
df1641e  feat(reader): add learning items read service
25e1b44  feat(reader): persist personal learning items
cbdf6c3  feat(learning): add LearningItem extractor
fb56056  docs: close Japanese Reader v0.3 integration                 ← main / origin/main
```

- **P3.1 produced no commit** — it was audit/design only, delivered inline.
- **P3.2 and P3.3 produced no checkpoint doc** — their results were reported inline; this document is the first P3 checkpoint.
- No rebase, squash, or SHA rewrite. All feature commits carry the
  `Co-Authored-By: Claude Sonnet 5` / `Claude-Session:` trailers.

---

## 4. Final Review Architecture

```text
Japanese web page  ──►  analysis  ──►  personal save (P1)
                                          │
                                          ▼
                        users/{uid}/learning_items/{autoId}   (immutable occurrences)
                                          │
                            學習項目 tab (P2.2, browse)
                                          │
                          ┌──── explicit user action ────┐
                          │      加入複習  (P3.4)         │
                          ▼                               │
              materializeReviewCard(item)   (P3.2, transaction, idempotent)
                          │
                          ▼
        users/{uid}/review_cards/{cardId}     cardId = base64url(utf8(lexicalKey))
        (mutable scheduling state + a face/provenance snapshot)
                          │
              listDueReviewCards({ now })     (P3.3 — dueAt <= now, asc, limit 50)
                          │
                 useReviewSession(uid, authResolved)   (P3.4 hook + reducer)
                          │
                     ReviewPanel                       (P3.4 presentation)
                          │
             front (surface + badge only)
                          │  顯示答案
                     reveal (reading / meaning / sentence / safe link)
                          │  重來 / 良好 / 簡單  (Again 1 / Good 3 / Easy 4)
                          ▼
              applyReviewRating(cardId, rating)         (P3.2, transaction)
                          │
              computeNextSchedule(card, rating, now)    (P3.2, pure, deterministic)
                          │
        update ONLY: state, dueAt, intervalDays, reps, lapses,
                     lastRating, lastReviewedAt, updatedAt
                          │
              auto-advance to next card in the in-memory batch
                          │
        batch exhausted ──► re-fetch listDueReviewCards() (fresh now)
                            backend naturally excludes what was just rated
                          │
                     empty ──► 今天沒有要複習的項目
```

**Invariants:**
- **`LearningItem` occurrences remain immutable.** P3 never writes to `learning_items`.
- **`ReviewCard` owns all mutable scheduling state.** One card per lexical identity; duplicate occurrences collapse onto it.
- **The face/provenance snapshot on a `ReviewCard` is written once (at materialisation) and never rewritten.**

---

## 5. ReviewCard Schema

Persisted at `users/{uid}/review_cards/{cardId}`. Defined in
`japanese-alchemy-webapp/lib/reviewCard.ts`; re-exported as a type from
`japanese-alchemy-webapp/types/index.ts` (the `RATING` value stays in
`lib/reviewCard.ts`).

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | `=== cardId === base64url(utf8(lexicalKey))`, mirrors the Firestore doc id |
| `userId` | `string` | owner (defence-in-depth; the path already gates by `isOwner`) |
| `lexicalKey` | `string` | the lexical identity, human-readable |
| `type` | `'vocab' \| 'grammar'` | denormalised from `lexicalKey`'s first segment; display/queue only |
| `state` | `'learning' \| 'review'` | scheduling lifecycle |
| `dueAt` | `number` (epoch ms) | the single scheduling timestamp / queue key |
| `intervalDays` | `number` (integer ≥ 0) | current spacing |
| `reps` | `number` (integer) | total ratings applied |
| `lapses` | `number` (integer) | count of `Again`-from-`review` |
| `lastRating` | `1 \| 3 \| 4 \| null` | most recent rating |
| `lastReviewedAt` | `number \| null` | epoch ms of the last rating |
| `createdAt` | `number` | materialisation time |
| `updatedAt` | `number` | last mutation |
| `surface` | `string` | face snapshot |
| `reading` | `string \| null` | face snapshot |
| `meaning` | `string \| null` | face snapshot |
| `sourceSentence` | `string` | one representative context |
| `sourceUrl` | `string \| null` | provenance |
| `sourceAnalysisId` | `string` | back-link to the full analysis page |
| `sourceLearningItemId` | `string` | the occurrence that materialised the card |

**Deferred / does NOT exist** (confirmed absent from the interface and the writers):
`nextReviewAt`, `easeFactor`, `difficulty`, `suspended` / `suspendedAt`,
`archived`, review history / log (no `review_log` subcollection),
`sourceLearningItemIds[]` (array), `occurrenceCount`, `contexts[]`, and every
FSRS field (`stability`, `retrievability`, …).

---

## 6. Review Identity

```text
cardId = base64url(utf8(lexicalKey))          (no padding, charset [A-Za-z0-9_-])
```

`lexicalKey` is produced by P0's `computeLexicalKey` and already encodes
`type | NFKC(stripRuby(surface)).trim() | NFKC(reading).trim()`.

Properties:
- **Deterministic** and **bijective** (`decodeReviewCardId` round-trips the exact bytes).
- **Path-safe** — no `/`, no `.`/`..`, well under Firestore's id length limit; real
  `vocab|…` / `grammar|…` keys never encode to a reserved `__…__` pattern.
- **Same `lexicalKey` → same `ReviewCard`.** Duplicate occurrences (across pages
  or within one save) collapse onto one card; re-materialising is a no-op.
- **No new normalisation introduced** — `reviewCardIdFor` only base64url-encodes
  the `lexicalKey` it is handed.

**Known limitations (accepted, deferred):**
- The same word **splits** into two cards when one occurrence had a reading
  extracted (`vocab|改善|かいぜん`) and another did not (`vocab|改善|`).
- Grammar homographs with different function share one card
  (`grammar|が|` covers subject-marker と contrastive-conjunction).

---

## 7. Review State / Rating Contract

```text
ReviewCard.state   :  'learning' | 'review'
ReviewRating       :  1 | 3 | 4
RATING             :  { AGAIN: 1, GOOD: 3, EASY: 4 }     // '2' reserved for a future "Hard"
```

- **`Hard` is not implemented.** The FSRS-compatible integer `2` is deliberately
  left free so a later "Hard" slots in without reinterpreting stored ratings.
- **`LearningItem.status`** is still present in the schema and still written
  `'NEW'` by P1's `deriveLearningItems`. **P3 does not read it.** It is *not* the
  `ReviewCard` lifecycle source and carries no meaning in P3 (deprecated-in-place).

---

## 8. Scheduling Contract

Constants (`lib/reviewCard.ts`):

```text
DAY_MS                        = 86_400_000
AGAIN_STEP_MS                  = 600_000        // 10 minutes
GRADUATING_INTERVAL_DAYS      = 1
EASY_GRADUATING_INTERVAL_DAYS  = 4
GOOD_FACTOR                    = 2
EASY_FACTOR                    = 3
MIN_INTERVAL_DAYS             = 1
MAX_INTERVAL_DAYS             = 3650            // 10 years
```

`computeNextSchedule(card, rating, now)` — pure, total, returns exactly
`{ state, dueAt, intervalDays, reps, lapses, lastRating, lastReviewedAt, updatedAt }`:

| From `state` | AGAIN (1) | GOOD (3) | EASY (4) |
|---|---|---|---|
| `learning` | `learning`, interval `0`, `dueAt = now + 600_000`, lapses unchanged | `review`, interval `1`, `dueAt = now + DAY_MS`, lapses unchanged | `review`, interval `4`, `dueAt = now + 4·DAY_MS`, lapses unchanged |
| `review` | `learning`, interval `0`, `dueAt = now + 600_000`, **lapses + 1** | `review`, interval `clamp(interval·2, 1, 3650)`, `dueAt = now + interval·DAY_MS` | `review`, interval `clamp(interval·3, 1, 3650)`, `dueAt = now + interval·DAY_MS` |

Other behaviour:
- `reps` increments on **every** rating.
- An **overdue** card is scheduled **from `now`**, never from its stale `dueAt` (no overdue penalty/bonus).
- Repeated `Again` in `learning`: `reps` climbs, interval stays `0`, **no lapse**.
- **Integer arithmetic only** — no floating-point interval output.
- **Not SM-2, not FSRS**, no `easeFactor`.
- Validation (throws): unsupported `rating`; non-finite `now`; structurally
  invalid card (`state`, `intervalDays`, `reps`, `lapses`).

---

## 9. Time Model

- **Epoch milliseconds `number`** everywhere (consistent with P0/P1/P2).
- **`Date.now()`** in production; **injected `now`** in every model/service test
  (`computeNextSchedule(card, rating, now)`, `listDueReviewCards({ now })`,
  `applyReviewRating(id, rating, { now })`, `materializeReviewCard(item, { now })`).
- **UTC / timezone-neutral** — the schedule is "now + N days" (elapsed duration),
  never "local midnight".
- **No Firestore `Timestamp` migration. No `serverTimestamp()`.**
- **Known risk:** a client with a wrong clock schedules wrong (own private data only).
- **Deferred:** server-authoritative time (via a callable) only if a later
  requirement (e.g. streak rewards) needs anti-tamper.

---

## 10. Security / Mutation Model

| Property | Record |
|---|---|
| Personal path | **`users/{auth.currentUser.uid}/review_cards/{cardId}`** — built from the authenticated uid |
| Caller-supplied `userId` | **not accepted** by any P3 function (no such option/param) |
| `materializeReviewCard` | auth required (throws before any write); one transaction; **create if absent**; if the card exists it is **returned unchanged** — schedule not reset, face/provenance not overwritten; rejects an empty `lexicalKey` |
| `applyReviewRating` | auth required; `cardId` (`/^[A-Za-z0-9_-]+$/`), `rating` (`1/3/4`), `now` (finite) all validated **before** any Firestore call; one transaction; **missing card → deterministic error**; writes **only** `state, dueAt, intervalDays, reps, lapses, lastRating, lastReviewedAt, updatedAt` |
| Never rewritten during a rating | `id`, `userId`, `lexicalKey`, `type`, `surface`, `reading`, `meaning`, `sourceSentence`, `sourceUrl`, `sourceAnalysisId`, `sourceLearningItemId`, `createdAt` |
| Shared flow | **unchanged** — no `shared_review_cards`, no shared review path |
| Firestore rules | **unchanged** — the existing `match /users/{userId}/{document=**} { allow read, write: if isOwner(userId) }` already authorises `review_cards` |
| Firestore indexes | **unchanged** |
| Callable / Admin SDK | **not used** — direct client write, same pattern as the P2.1 read layer |

---

## 11. Due Queue Contract

```ts
query(
  collection(doc(db, 'users', auth.currentUser.uid), 'review_cards'),
  where('dueAt', '<=', now),          // now = options.now ?? Date.now()
  orderBy('dueAt', 'asc'),
  limit(resolvedLimit)                // 1..50
)
// → { cards: ReviewCard[] }
```

| Aspect | Value |
|---|---|
| `REVIEW_QUEUE_CAP` | **50** (in `lib/reviewCard.ts`) |
| Limit resolution | **clamp, never reject**: `undefined` / non-finite / `< 1` → `50`; `1..50` → itself; `> 50` → `50`; positive non-integer → `Math.floor`, then the same rules |
| Ordering | `dueAt` ascending (most overdue first); equal `dueAt` broken by Firestore's implicit ascending `__name__` — **no explicit `documentId()` orderBy** |
| Malformed persisted rows | **skipped** (not thrown on, not repaired) — a row must have a non-empty `id`, finite `dueAt`, `state ∈ {learning,review}`, non-empty `lexicalKey`, `type ∈ {vocab,grammar}` |
| Not present | cursor / pagination token, `type` filter, `state` filter, search, client-side sort, client-side dedup, daily timezone-based quota |
| Auth | `auth.currentUser` only; throws before any query if signed out or `now` non-finite |
| Composite index | **NOT REQUIRED** — inequality + `orderBy` on the *same* field `dueAt` is served by the automatic single-field index (`firestore.indexes.json` has `"fieldOverrides": []`) |
| Live emulator `FAILED_PRECONDITION` check | **DEFERRED** (no emulator available) |

---

## 12. Review UI Contract

### `學習項目` tab (P3.4 addition)
- One **`加入複習`** button per `LearningItem` card (rendered only when `onAddToReview` is passed — P2.2 callers unaffected).
- **Per-card** local state: `idle → pending` (button disabled) → `已加入複習` (button removed) / `加入失敗，請再試一次` (button stays, retryable).
- Calls `materializeReviewCard(item)`; **does not** mutate the `LearningItem`, **does not** refresh the feed, **no** bulk-add, **no** edit/delete.

### `複習` tab (P3.4, signed-in only)
| Element | Behaviour |
|---|---|
| Front | `surface` (furigana) + `單字`/`文法` badge only. Reading, meaning, source context **hidden**. |
| Reveal | `顯示答案` button |
| After reveal | `reading` (if non-null), `meaning` (if non-null), `sourceSentence` (if non-empty), `來源` link **only** for a safe `http(s)` URL |
| Ratings | `重來` / `良好` / `簡單` → `RATING.AGAIN` / `GOOD` / `EASY` |
| Rating gating | **disabled** while `!revealed \|\| rating` |
| After a successful rating | **auto-advance** to the next card — **no separate "Next" button** |
| Loading | `載入中...` |
| Empty | `今天沒有要複習的項目` |
| Initial-load error | `無法載入複習項目` |
| Rating error | `更新複習狀態時發生錯誤` (no Firebase details leaked) |
| Remaining count | `剩餘 {n}` shown above the card |

---

## 13. Auth Session Safety (`useReviewSession(uid, authResolved)`)

- **No query before `authResolved`.**
- **No query when signed out** (`uid === null` → `RESET`).
- **Logout resets the queue** (cards cleared).
- **User switch** bumps an internal generation counter and immediately clears the
  previous user's cards (`LOAD_PENDING`).
- **Generation guard** discards a stale `listDueReviewCards` response after a
  logout / switch.
- **A stale `applyReviewRating` completion** after a user switch cannot advance
  the new user's session (`isCurrent()` check + generation).
- **Duplicate rating submission blocked** — synchronous `ratingRef` guard plus
  `state.rating` for the UI.
- **A rating failure keeps the current card AND its revealed state** for retry.

All of the above are covered by `lib/reviewSession.hook.test.tsx`.

---

## 14. Safe URL Handling

`export function safeExternalUrl(value)` — **shared**, in `lib/textUtils.ts`
(extracted from a private copy in `LearningItemsPanel.tsx`; now used by both
`LearningItemsPanel` and `ReviewPanel`).

- Allows: `http:`, `https:`
- Rejects: `javascript:`, `data:`, malformed URLs, empty/null → all return `null`
- Rendered links carry `target="_blank" rel="noopener noreferrer"`
- No new dependency. `app/page.tsx`'s own `safeSourceUrl` (identical semantics)
  was left untouched (out of P3.4 scope).

---

## 15. Test / Verification Summary

| Phase | New tests | Total at that point |
|---|---|---|
| P3.2 | 44 | 119 / 119 |
| P3.3 | 17 | 136 / 136 |
| P3.4 | 58 | **194 / 194** |

New P3 test files:
`lib/reviewCard.test.ts` (27), `services/reviewService.test.ts` (34 — 17 P3.2 +
17 P3.3), `lib/reviewSession.test.ts` (17), `lib/reviewSession.hook.test.tsx`
(11), `components/ReviewPanel.test.tsx` (19), `test/reviewPipeline.integration.test.tsx`
(4); plus +7 in `components/LearningItemsPanel.test.tsx`.

**Latest gates (HEAD `72344c5`):**
- `npx vitest run` (full webapp) — **194 / 194 PASS** (13 files)
- `npx tsc --noEmit` — **PASS**
- `npx eslint` on all P3 changed/new files — **PASS (0 problems)**
- `next build` — compile + TypeScript phases **PASS**
- `git diff --check` — **PASS**

**Whole-project `npm run lint`:** 4 problems, **all pre-existing** in
`app/auth/page.tsx` (×2), `contexts/ThemeContext.tsx`, `lib/firebase.ts` — **none
in any P0/P1/P2/P3 file**. Not introduced by P3.

**`next build` static prerender:** fails with `FirebaseError auth/invalid-api-key`
because `.env.local` is absent — **pre-existing environmental issue**, identical
signature on every commit since `fb56056`; not a P3 regression.

**No external API calls. No live Firebase / emulator smoke.**

---

## 16. Known Notes / Deferred Items

### Infrastructure (unchanged since the P2 checkpoint)
- `japanese-alchemy-webapp/.env.local` **missing**; all `NEXT_PUBLIC_FIREBASE_*` absent → the webapp cannot boot locally.
- `firebase` CLI **not installed**; **Java not installed** → the Firestore emulator cannot run.
- **Not run:** real Firebase Auth resolution in a browser; real Firestore
  security-rule enforcement; real transaction contention / retry behaviour;
  live composite-index `FAILED_PRECONDITION` check; real browser render of the
  `複習` tab.

### P3 product / architecture deferred
- `Hard` rating (integer `2` reserved)
- SM-2 (`easeFactor`) / FSRS (`stability`, `difficulty`)
- `occurrenceCount` on `ReviewCard`
- review history / log subcollection
- suspend / archive
- bulk "add all to review"
- daily new-card quota / timezone-based daily counter
- search / filter in the review queue
- reading-agnostic identity merge (the `vocab|改善|かいぜん` vs `vocab|改善|` split)
- grammar function / sense splitting (`grammar|が|` collision)
- multi-context provenance (`contexts[]`, `sourceLearningItemIds[]`)

---

## 17. No Semantic Drift

P3 did **not** modify:
- P1 `learning_items` persistence / `savePersonalAnalysisPage` / `saveItemsCallable`
- `LearningItem` schema (`learningItem.ts`)
- P2 raw-occurrence semantics
- `listLearningItems` contract (`services/firestoreService.ts`)
- `japanese-alchemy-hosting/**` (Cloud Functions, LLM services)
- the Chrome extension
- prompts / `systemPromptV1` / `systemPromptV2`
- `firestore.rules`
- `firestore.indexes.json`
- the shared save / shared-collection flow

Verified: `git status` shows **no diff** on any of those files across the P3 commit chain.

---

## 18. Current Product Capability

The v0.4 flow, end to end:

```text
Japanese web content
  → sidepanel analysis (extension → Functions → LLM)
  → personal save  →  users/{uid}/analysis_pages + users/{uid}/learning_items   (P1)
  → 學習項目 browser tab  (P2.2 — browse raw saved occurrences, newest first)
  → explicit 加入複習 on a chosen occurrence   (P3.4)
  → materializeReviewCard  →  one deduplicated ReviewCard per lexical identity   (P3.2)
  → 複習 tab: due queue  (dueAt <= now, asc, ≤50)   (P3.3)
  → 顯示答案 → 重來 / 良好 / 簡單   (P3.4)
  → applyReviewRating → computeNextSchedule → deterministic reschedule   (P3.2)
  → automatic next card; re-fetch when the batch empties
```

**Three distinct concepts — keep them separate:**
1. **Browsing occurrences** — `learning_items`, one row per (word/grammar × saved analysis), immutable, shown in `學習項目`. Duplicates are expected and preserved.
2. **Review cards** — `review_cards`, one document per lexical identity, created only by an explicit `加入複習`. Duplicate occurrences collapse.
3. **Review scheduling** — the mutable `state` / `dueAt` / `intervalDays` / `reps` / `lapses` on a `ReviewCard`, advanced only by `applyReviewRating`.

---

## 19. Current Gate

```text
P0:  COMPLETE
P1:  COMPLETE
P2:  COMPLETE WITH NOTES
P3:  COMPLETE WITH NOTES

Live Firebase smoke:  DEFERRED
main merge:            NOT YET
push:                 NOT YET
deploy:               NOT YET
migration / backfill:  NONE
```

---

## 20. Recommended Next Phase

**P4 — audit / design. Do NOT implement in that session.**

Candidate topics (candidates, **not** committed requirements):
- Live Firebase local environment / emulator decision (unblocks every deferred smoke).
- Review-card materialisation UX refinement (bulk add? auto-suggest? "add all vocab from this page"?).
- Review history / log (per-review record; drives statistics + FSRS later).
- `Hard` button (rating `2`).
- Occurrence ↔ card relationship refinement (reading-agnostic merge; `occurrenceCount`; multi-context).
- SM-2 vs FSRS evaluation (and the field additions each needs).
- Due / new daily quotas (needs a timezone model).
- Review statistics surface.
- Whether to expose review state (`state` / `dueAt` / "in review") in the `學習項目` tab.
- Deployment readiness (rules hardening for `review_cards`, index config review, `.env` provisioning).

---

## 21. Resume Commands

```bash
cd D:\J-Buddy-Dev\j-buddy
git checkout feature/japanese-reader-v0.4
git status
git log -8 --oneline --decorate
```

Expected:

```text
HEAD            72344c5  feat(reader): add minimal review session UI
working tree    clean   (before this checkpoint doc is added)

72344c5 (HEAD -> feature/japanese-reader-v0.4) feat(reader): add minimal review session UI
f007d1b feat(reader): add due review queue query
043f1b7 feat(reader): add review card model and mutation service
8c7cf49 docs: add Japanese Reader v0.4 P2 checkpoint
48a0aa5 test(reader): add learning items pipeline integration coverage
e6702a9 feat(reader): add learning items webapp tab
df1641e feat(reader): add learning items read service
25e1b44 feat(reader): persist personal learning items
```

To run the review flow locally (once a smoke environment exists):

```bash
cd japanese-alchemy-webapp
cp .env.local.example .env.local     # fill in real NEXT_PUBLIC_FIREBASE_* values
npm install
npm run dev
# sign in → 學習項目 tab → 加入複習 on a few items → 複習 tab → 顯示答案 → rate
```

---

## 22. Session Close Block

```text
┌─ Japanese Reader v0.4 — P3 CHECKPOINT ──────────────────────────────────────┐
│ Japanese Reader v0.4                                                        │
│ P3: COMPLETE WITH NOTES                                                     │
│                                                                            │
│ Branch            feature/japanese-reader-v0.4                              │
│ Code HEAD         72344c5  feat(reader): add minimal review session UI      │
│ Tests             194/194 PASS                                              │
│ Review flow       IMPLEMENTED  (加入複習 → 複習 tab → reveal → rate →       │
│                   deterministic reschedule → next card → refetch)           │
│                                                                            │
│ ReviewCard        users/{uid}/review_cards/{base64url(lexicalKey)}          │
│ Schedule          integer-day step model (Again/Good/Easy = 1/3/4)          │
│ LearningItem      immutable; status still 'NEW', ignored by P3              │
│ Rules / indexes   UNCHANGED (no composite index required)                   │
│                                                                            │
│ Live Firebase smoke   DEFERRED (no .env.local / CLI / Java / emulator)      │
│ main                  UNTOUCHED (fb56056)                                   │
│ push / deploy         NOT DONE                                              │
│ migration / backfill  NONE                                                  │
│                                                                            │
│ NEXT   P4 AUDIT / DESIGN — emulator decision, review history, Hard button,  │
│        occurrence↔card refinement, SM-2 vs FSRS, quotas, deploy readiness.  │
│        Do not implement.                                                    │
└────────────────────────────────────────────────────────────────────────────┘
```
