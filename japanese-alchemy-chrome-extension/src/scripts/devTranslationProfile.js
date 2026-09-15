/**
 * P8-D2 DEV-ONLY test hook for manually live-testing translationProfileId
 * (see functions/src/models/translationProfile.ts) after a deploy, WITHOUT
 * any visible UI control in the public side panel.
 *
 * Default `null` = production behavior for every real user: no profile is
 * ever sent, byte-identical to pre-P8-D2 request bodies. This constant is
 * never read from chrome.storage, never exposed through any UI element, and
 * never persisted — the ONLY way to change it is for a developer to edit
 * this literal and rebuild. There is no code path that lets a normal user
 * (or the normal side-panel UI) trigger it accidentally.
 *
 * To manually test a profile locally: change the string below to a real
 * profile id (e.g. "oriwish-ja-business-v1"), `npm run build`, reload the
 * unpacked extension, run one zh/en analysis, then REVERT to `null` before
 * committing/shipping.
 *
 * Remove this file (and its one call site in jaAlchemyApiService.js) once a
 * real profile-selection UX ships, or once manual P8-D2 verification is
 * complete.
 */
export const DEV_TEST_TRANSLATION_PROFILE_ID = null;
