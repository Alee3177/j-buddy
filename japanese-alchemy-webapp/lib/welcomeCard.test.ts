import { describe, expect, it } from 'vitest';
import { shouldShowWelcomeCard } from './welcomeCard';

const emptySignedIn = {
  signedIn: true,
  vocabularyCount: 0,
  grammarCount: 0,
  pageCount: 0,
  learningItemCount: 0,
};

describe('shouldShowWelcomeCard', () => {
  it('shows for a signed-in user with no personal data', () => {
    expect(shouldShowWelcomeCard(emptySignedIn)).toBe(true);
  });

  it('hides for a signed-out user regardless of counts', () => {
    expect(shouldShowWelcomeCard({ ...emptySignedIn, signedIn: false })).toBe(
      false
    );
    expect(
      shouldShowWelcomeCard({
        signedIn: false,
        vocabularyCount: 0,
        grammarCount: 0,
        pageCount: 0,
        learningItemCount: 0,
      })
    ).toBe(false);
  });

  it('hides when vocabularyCount is non-zero', () => {
    expect(
      shouldShowWelcomeCard({ ...emptySignedIn, vocabularyCount: 1 })
    ).toBe(false);
  });

  it('hides when grammarCount is non-zero', () => {
    expect(shouldShowWelcomeCard({ ...emptySignedIn, grammarCount: 1 })).toBe(
      false
    );
  });

  it('hides when pageCount is non-zero', () => {
    expect(shouldShowWelcomeCard({ ...emptySignedIn, pageCount: 1 })).toBe(
      false
    );
  });

  it('hides when learningItemCount is non-zero', () => {
    expect(
      shouldShowWelcomeCard({ ...emptySignedIn, learningItemCount: 1 })
    ).toBe(false);
  });

  it('shows again once every count returns to zero (no persisted dismissal)', () => {
    const withData = { ...emptySignedIn, vocabularyCount: 3 };
    expect(shouldShowWelcomeCard(withData)).toBe(false);
    expect(shouldShowWelcomeCard({ ...withData, vocabularyCount: 0 })).toBe(
      true
    );
  });
});
