/**
 * P8-D2: isolated test for the dev-only translation-profile fallback
 * mechanism in jaAlchemyApiService.js. Kept in its own file (rather than
 * jaAlchemyApiService.test.js) so devTranslationProfile.js can be mocked to
 * a non-null value from the top of the file — proving the FALLBACK actually
 * fires — without disturbing the main test file's real (null-default)
 * module state.
 */
jest.mock('../src/scripts/firebaseApp.js', () => ({
  firebaseApp: { __app: true },
  firebaseFunctions: { __functions: true },
}));

jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(),
}));

// The one thing this file overrides relative to jaAlchemyApiService.test.js:
// simulate a developer having locally flipped the dev-only constant to test
// a profile, and prove generateResponseStream/generateResponse actually use
// it when the caller doesn't pass an explicit translationProfileId.
jest.mock('../src/scripts/devTranslationProfile.js', () => ({
  DEV_TEST_TRANSLATION_PROFILE_ID: 'oriwish-ja-business-v1',
}));

import JaAlchemyApiService from '../src/scripts/jaAlchemyApiService.js';

const { httpsCallable: mockHttpsCallable } = jest.requireMock('firebase/functions');

describe('P8-D2 dev-only translation profile hook (activated)', () => {
  beforeEach(() => {
    mockHttpsCallable.mockReset();
  });

  test('generateResponseStream falls back to the dev hook when the caller omits translationProfileId', async () => {
    const callable = jest.fn();
    callable.stream = jest.fn(async () => ({
      stream: { async *[Symbol.asyncIterator]() {} },
      data: Promise.resolve({ success: true }),
    }));
    mockHttpsCallable.mockReturnValue(callable);

    await new JaAlchemyApiService().generateResponseStream(
      '这是一个测试', 'v2', undefined, jest.fn(), jest.fn(), jest.fn()
    );

    expect(callable.stream).toHaveBeenCalledWith(
      { content: '这是一个测试', prompt: 'v2', translationProfileId: 'oriwish-ja-business-v1' },
      { signal: undefined }
    );
  });

  test('an explicit translationProfileId from the caller still overrides the dev hook', async () => {
    const callable = jest.fn();
    callable.stream = jest.fn(async () => ({
      stream: { async *[Symbol.asyncIterator]() {} },
      data: Promise.resolve({ success: true }),
    }));
    mockHttpsCallable.mockReturnValue(callable);

    await new JaAlchemyApiService().generateResponseStream(
      '这是一个测试', 'v2', undefined, jest.fn(), jest.fn(), jest.fn(),
      { translationProfileId: 'some-other-profile' }
    );

    expect(callable.stream).toHaveBeenCalledWith(
      { content: '这是一个测试', prompt: 'v2', translationProfileId: 'some-other-profile' },
      { signal: undefined }
    );
  });

  test('generateResponse (batch) also falls back to the dev hook', async () => {
    const callable = jest.fn(async () => ({ data: { success: true, data: 'result' } }));
    mockHttpsCallable.mockReturnValue(callable);

    await new JaAlchemyApiService().generateResponse('这是一个测试', 'v2');

    expect(callable).toHaveBeenCalledWith({
      content: '这是一个测试',
      prompt: 'v2',
      translationProfileId: 'oriwish-ja-business-v1',
    });
  });
});
