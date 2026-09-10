# Japanese Reader v0.4 — Webapp Deploy & Live-Smoke Runbook

**Audience:** a human operator with access to the `japanese-alchemy` Firebase
project.
**Scope:** deploy `japanese-alchemy-webapp` (the Next.js static export) to
Firebase Hosting, and verify the P3 review flow end-to-end against real
Firestore / Auth / rules / indexes. Also covers the separate Firestore-rules
deploy.
**Created:** P4.3. **Do not run any step here as part of P4.3 itself** — this is
the checklist for a later, deliberate release.

> The webapp has been developed and verified entirely on mocks + the local
> emulator-less test suite. This runbook is the first time it touches real
> Firebase. Work through it in order; **stop at the first FAIL**.

---

## Section A — Prerequisites

| Item | Value / note |
|---|---|
| Repository | `D:\J-Buddy-Dev\j-buddy` (or your clone) |
| Branch / checkpoint | `feature/japanese-reader-v0.4`, HEAD at or after `feat(reader): add minimal review session UI` (the P3.4 commit). Confirm with `git log --oneline -1`. |
| Node | 22.x (matches `functions` engine; webapp builds on 22) |
| npm | bundled with Node 22. This repo `.gitignore`s lockfiles → use `npm install`, not `npm ci`. |
| Firebase CLI | `firebase-tools` — install locally for the deploy step: `npm i -g firebase-tools` (or use `npx firebase-tools`). Log in: `firebase login`. |
| Real Firebase web config | From Firebase Console → Project `japanese-alchemy` → Project settings → General → "Your apps" → the Web app → SDK setup and configuration. |
| Test Google account | A throwaway Google account you control, added as a test user if the project restricts sign-in. **Never use a real customer account.** |
| `.env.local` location | `japanese-alchemy-webapp/.env.local` |

### `.env.local` template (fill with the real Web-app values — **do not commit**)

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

- All six must be present and non-blank or the app runs in "no Firebase"
  degraded mode (signed-out only) — see `lib/firebase.ts` / P4.2.
- `japanese-alchemy-webapp/.gitignore` already ignores `.env*.local`. Confirm
  `git status` does **not** list `.env.local` before any commit.
- These are `NEXT_PUBLIC_*` — **client config, not secrets** — but still keep
  them out of version control.

---

## Section B — Pre-deploy local gates

```bash
cd japanese-alchemy-webapp
npm install
npx vitest run          # expect: all passing (214+ at P4.3)
npx tsc --noEmit        # expect: exit 0
npm run lint            # expect: exit 0, 0 problems
npm run build           # expect: exit 0
```

| Gate | Expected | PASS/FAIL |
|---|---|---|
| `vitest run` | all green | ☐ |
| `tsc --noEmit` | exit 0 | ☐ |
| `npm run lint` | 0 problems | ☐ |
| `npm run build` | exit 0 | ☐ |
| `out/` exists | `test -f out/index.html` succeeds | ☐ |

These gates must also be green in **Webapp CI** (`.github/workflows/webapp-ci.yml`)
for the branch / PR being released. The `firestore-rules` CI job must be green
too — it is the only place the `review_cards` rules tests actually run.

---

## Section C — Real-project local smoke (`npm run dev`)

With a valid `.env.local` in place:

```bash
cd japanese-alchemy-webapp
npm run dev        # http://localhost:3000
```

Open the browser dev tools **Console** and **Network** tabs before signing in.

| Check | Expected | PASS/FAIL |
|---|---|---|
| App boots at `/` | signed-out dashboard renders (shared vocab/grammar, 登入 button) | ☐ |
| Sign in (`/auth` → Google) | redirects to `/`, header shows the account email | ☐ |
| Signed-in tabs appear | `單字 / 文法 / 頁面 / 學習項目 / 複習` | ☐ |
| `學習項目` tab loads | list renders (may be empty for a fresh account) | ☐ |
| `listLearningItems` real query | Network shows a Firestore `Listen`/`RunQuery` to `…/learning_items` that **succeeds** | ☐ |
| No `FAILED_PRECONDITION` on that query | Console has **no** "The query requires an index" error / no index-creation URL | ☐ |
| Add one learning item to review | click `加入複習` on a card → button becomes `已加入複習` | ☐ |
| Reload the page (`Ctrl-R`) | (known limitation) `加入複習` shows again — clicking it is safe (idempotent). The **review card itself must persist** — verify in the next step. | ☐ |
| `複習` tab loads | either a card front or `今天沒有要複習的項目` | ☐ |
| The item added above appears in `複習` | its `surface` shows on a card front | ☐ |
| `listDueReviewCards` real query | Network shows a query to `…/review_cards` with `where dueAt <= …` + `orderBy dueAt` that **succeeds** | ☐ |
| No `FAILED_PRECONDITION` on that query | no index error / no index-creation URL | ☐ |
| Reveal → rate `良好` (Good) | card advances to the next / to the empty state | ☐ |
| Reload → open `複習` again | the just-rated card is **gone** from the queue (its `dueAt` moved +1 day) — confirms the schedule persisted | ☐ |
| Cross-user isolation | (optional) sign in as a second test account → its `學習項目` / `複習` do **not** show the first account's data | ☐ |

### Console / Network error watch-list — any occurrence = FAIL, capture it

- `permission-denied`
- `failed-precondition` / "The query requires an index" / a `console.firebase.google.com/…/firestore/indexes?create_composite=…` URL
- `auth/invalid-api-key` (means `.env.local` is wrong)
- `unauthenticated`
- any `FirebaseError` not explicitly expected

---

## Section D — Firestore rule smoke (test account only)

Normal app usage already exercises the happy path (create + schedule-only
update). To spot-check the hardening, in the browser console **while signed in as
your test account**:

```js
// import path may differ; use the app's firestore instance if exposed, else skip
// this and rely on the CI rules tests.
```

If you have a quick way to issue a raw client write (e.g. a scratch page), verify:

| Check | Expected | PASS/FAIL |
|---|---|---|
| Own review card: `getDoc` | succeeds | ☐ |
| Own review card: schedule-only `updateDoc` (`dueAt`, `reps`, …) | succeeds | ☐ |
| Own review card: `updateDoc({ surface: 'x' })` | **permission-denied** | ☐ |
| Own review card: `deleteDoc` | **permission-denied** | ☐ |
| Another user's `users/<otherUid>/review_cards/<id>` read | **permission-denied** | ☐ |

- **Do not** attempt writes against another real user's documents.
- If a raw client write is not convenient, the `firestore-rules` CI job covers
  all 25 cases — treat a green CI run as this section's PASS.

---

## Section E — Deploy

**Only after Sections B, C, D all PASS.**

### E.1 — Webapp (Firebase Hosting)

```bash
cd japanese-alchemy-webapp
firebase login                         # if not already
npm run build                          # produces out/
firebase deploy --only hosting         # uses .firebaserc: project "japanese-alchemy", firebase.json site "japanese-alchemy-webapp"
```

Confirm before pressing enter:

| Check | Value |
|---|---|
| Firebase project alias | `japanese-alchemy` (`japanese-alchemy-webapp/.firebaserc` → `projects.default`) |
| Hosting site | `japanese-alchemy-webapp` (`japanese-alchemy-webapp/firebase.json` → `hosting.site`) |
| `--only hosting` | yes — **no functions**, **no Firestore rules** from this directory |
| `firebase.json` in this dir | has **only** a `hosting` block — it cannot deploy rules/functions even by accident |

### E.2 — Firestore rules (separate — see Section 9 below)

The `review_cards` rules live in `japanese-alchemy-hosting/firestore.rules`.
Deploy them **only** if they have changed since the last rules deploy (P4.3
changed them):

```bash
cd japanese-alchemy-hosting
firebase deploy --only firestore:rules   # project "japanese-alchemy"
```

- Do this **before or together with** the webapp deploy, so the tightened rules
  are live when the new client starts writing review cards.
- Do **not** run `firebase deploy` with no `--only` from `japanese-alchemy-hosting`
  — that would also deploy Functions and Hosting (the `public/` static site).

### E.3 — Do NOT

- Do not `firebase deploy --only functions` (no functions changed in v0.4).
- Do not deploy `firestore:indexes` — no index changes (see Section 8).
- Do not merge to `main` before the release is agreed; the inert
  `japanese-alchemy-hosting/.github/workflows/firebase-hosting-*.yml` do not run
  (nested path), so a `main` push does **not** auto-deploy the webapp.

---

## Section F — Post-deploy smoke

Open the live Hosting URL (e.g. `https://japanese-alchemy-webapp.web.app`). Repeat
the key checks from Section C against production:

| Check | Expected | PASS/FAIL |
|---|---|---|
| Site loads, signed-out | ☐ |
| Sign in | ☐ |
| `學習項目` loads, real query OK, no index error | ☐ |
| `加入複習` on one item | ☐ |
| `複習` loads, real query OK, no index error | ☐ |
| Reveal → rate → advance | ☐ |
| Reload → schedule persisted (card gone from queue) | ☐ |
| Console clean (no `permission-denied` / `failed-precondition` / errors) | ☐ |

---

## Section G — Rollback

### Webapp (static hosting)
- **Fastest:** Firebase Console → Hosting → the `japanese-alchemy-webapp` site →
  Release history → "Rollback" to the previous release. No rebuild needed.
- **From source:** `git checkout <last-good-commit>`, `cd japanese-alchemy-webapp`,
  `npm install && npm run build && firebase deploy --only hosting`.
- Identify the last good commit: the commit whose Webapp CI run was green and
  which was last deployed (record deploy commits in the release log).

### Firestore rules
- `git checkout <previous-rules-commit> -- japanese-alchemy-hosting/firestore.rules`
  then `cd japanese-alchemy-hosting && firebase deploy --only firestore:rules`.
- Firebase Console → Firestore → Rules also shows a version history with a
  one-click rollback.

### Data
- **Do not delete or bulk-edit Firestore data on rollback.** `review_cards` is
  additive and backward-compatible; a code/rules rollback needs no data change.
  The pre-P4.3 rules were strictly more permissive, so rolling rules back cannot
  lock anyone out.

---

## Section H — Release gate checklist

| # | Gate | PASS | FAIL |
|---|---|---|---|
| 1 | Webapp CI `webapp-quality` job green on the release ref | ☐ | ☐ |
| 2 | Webapp CI `firestore-rules` job green on the release ref | ☐ | ☐ |
| 3 | Section B local gates all PASS | ☐ | ☐ |
| 4 | Section C real-project local smoke all PASS | ☐ | ☐ |
| 5 | No `FAILED_PRECONDITION` / index-creation URL seen anywhere (Section 8) | ☐ | ☐ |
| 6 | Section D rule smoke PASS (or CI `firestore-rules` green) | ☐ | ☐ |
| 7 | `.env.local` confirmed **not** staged / committed | ☐ | ☐ |
| 8 | Firestore rules deployed (`firestore:rules` only, project `japanese-alchemy`) | ☐ | ☐ |
| 9 | Webapp deployed (`hosting` only, site `japanese-alchemy-webapp`) | ☐ | ☐ |
| 10 | Section F post-deploy smoke all PASS | ☐ | ☐ |
| 11 | Rollback path (Section G) understood and reachable | ☐ | ☐ |

**Release is GO only when 1–11 are all PASS.**

---

## Section 8 — Firestore index confirmation

Two v0.4 client queries rely on **no composite index** (only automatic
single-field indexes). This has been established analytically (P2.1 / P3.1 / P3.3)
but **never confirmed against real Firestore**.

### Query 1 — `listLearningItems` (`services/firestoreService.ts`)

```
collection:  users/{uid}/learning_items
orderBy:     createdAt  desc
orderBy:     __name__   desc          (documentId())
limit:       pageSize + 1
[startAfter: createdAt, id]           (on "load more")
```
Expected: **no composite index** — ordering by one field then `__name__` in the
same direction is index-free.

### Query 2 — `listDueReviewCards` (`services/reviewService.ts`)

```
collection:  users/{uid}/review_cards
where:       dueAt  <=  now
orderBy:     dueAt  asc               (+ implicit __name__ asc)
limit:       ≤ 50 (REVIEW_QUEUE_CAP)
```
Expected: **no composite index** — an inequality filter plus an `orderBy` on the
**same** field is index-free.

### Human confirmation (Section C / F)

For **each** query, with real data present:

1. Trigger it (open `學習項目`; open `複習`).
2. Watch the browser console.
3. **Expected:** the query returns results (or an empty list) with **no** error.
4. **Not expected:** `FirebaseError: The query requires an index. You can create
   it here: https://console.firebase.google.com/…/firestore/indexes?create_composite=…`

### If an index error DOES appear

1. **STOP** the deployment.
2. Capture: the exact query (collection + where + orderBy), the full error text,
   and the `create_composite` URL (do not click "create").
3. Review why — a real contradiction with the P3.3 analysis, or a query shape
   drift.
4. Only then decide whether to add an entry to
   `japanese-alchemy-hosting/firestore.indexes.json` and redeploy
   `firestore:indexes`. **Do not blind-create the suggested index.**

---

## Section 9 — Deploy separation (audit)

Three deployables, three directories/commands. Keep them uncoupled.

| Deployable | Directory | Command | `firebase.json` scope |
|---|---|---|---|
| **Webapp** (Next static export) | `japanese-alchemy-webapp/` | `npm run build && firebase deploy --only hosting` (this is the `deploy` npm script) | `japanese-alchemy-webapp/firebase.json` — **`hosting` only** (site `japanese-alchemy-webapp`, `public: "out"`). Cannot deploy rules/functions. |
| **Firestore rules** | `japanese-alchemy-hosting/` | `firebase deploy --only firestore:rules` | `japanese-alchemy-hosting/firebase.json` → `firestore.rules` = `firestore.rules` |
| **Firestore indexes** | `japanese-alchemy-hosting/` | `firebase deploy --only firestore:indexes` | same → `firestore.indexes` = `firestore.indexes.json` (no change in v0.4) |
| **Cloud Functions** | `japanese-alchemy-hosting/functions/` | `npm run deploy` (= `firebase deploy --only functions`) | not touched in v0.4 |
| **Static `public/` site** | `japanese-alchemy-hosting/` | `firebase deploy --only hosting` | `japanese-alchemy-hosting/firebase.json` → `hosting.public = "public"` — a **different** hosting target from the webapp; do not confuse |

### Coupling risks & how they are avoided

- Running bare `firebase deploy` from `japanese-alchemy-hosting/` deploys
  **Functions + Firestore + Hosting(public/)** together. **Always pass `--only`.**
- The webapp's `firebase.json` has only a `hosting` block, so
  `firebase deploy` from `japanese-alchemy-webapp/` can only ever touch webapp
  hosting — a safe default. The `deploy` npm script already scopes to
  `--only hosting`.
- The auto-generated `japanese-alchemy-hosting/.github/workflows/firebase-hosting-*.yml`
  are at a **nested** path and are **never executed** by GitHub Actions (Actions
  reads only the repo-root `.github/workflows/`). They target the `public/`
  static site, not the webapp. Leave them; they are inert. Do not move them to
  the repo root without a deliberate decision.
- **Deploy scripts were not modified in P4.3.** The `preview` / `deploy` npm
  scripts still assume a locally installed `firebase-tools`.

---

## Appendix — What P4.3 changed (context for the operator)

- `.github/workflows/webapp-ci.yml` (new) — the CI described above.
- `japanese-alchemy-hosting/firestore.rules` — added an explicit
  `users/{uid}/review_cards/{cardId}` block: owner-only, exact-shape validation
  on create, schedule-only fields mutable on update, **no client delete**. The
  broad `users/{uid}/{document=**}` write wildcard was narrowed to **read-only**;
  `vocabularies` / `grammars` / `analysis_pages` / `learning_items` keep full
  owner write via explicit rules (identical behaviour). No other collection's
  semantics changed.
- `japanese-alchemy-webapp/test/firestoreRules.reviewCards.rules.test.ts` (new) +
  `npm run test:rules` + `vitest.rules.config.mts` + `@firebase/rules-unit-testing`
  devDependency — the 25-case rules test, run by CI's `firestore-rules` job.
- 3 pre-existing lint problems fixed (`app/auth/page.tsx` ×2, `contexts/ThemeContext.tsx`).
- **No** change to: ReviewCard schema, scheduler, `reviewService` public API,
  `LearningItem`, P1 persistence, prompts, the Chrome extension,
  `firestore.indexes.json`, deploy scripts.
