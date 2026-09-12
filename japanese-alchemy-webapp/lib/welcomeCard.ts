// P6.5-B — pure visibility rule for the dashboard Welcome/Getting-Started
// card. Kept separate from app/page.tsx so it is unit-testable without
// mounting the dashboard (mirrors the reducer-in-lib/ pattern used by
// learningItemsFeed.ts / reviewSession.ts).
//
// No persisted "hasSeenWelcome" state by design (P6.5-B product decision):
// the card is purely a function of current personal-data counts, so it can
// reappear if a user later deletes everything.

export interface WelcomeCardVisibilityInput {
  signedIn: boolean;
  vocabularyCount: number;
  grammarCount: number;
  pageCount: number;
  learningItemCount: number;
}

export function shouldShowWelcomeCard({
  signedIn,
  vocabularyCount,
  grammarCount,
  pageCount,
  learningItemCount,
}: WelcomeCardVisibilityInput): boolean {
  if (!signedIn) return false;
  return (
    vocabularyCount === 0 &&
    grammarCount === 0 &&
    pageCount === 0 &&
    learningItemCount === 0
  );
}
