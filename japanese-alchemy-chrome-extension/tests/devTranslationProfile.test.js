/**
 * P8-D2: the dev-only translation-profile test hook must default OFF and be
 * impossible to trigger through normal use — this test locks that default in.
 */
import { DEV_TEST_TRANSLATION_PROFILE_ID } from '../src/scripts/devTranslationProfile.js';

describe('DEV_TEST_TRANSLATION_PROFILE_ID', () => {
  test('defaults to null (no profile applied for any real user)', () => {
    expect(DEV_TEST_TRANSLATION_PROFILE_ID).toBeNull();
  });
});
