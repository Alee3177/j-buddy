import fs from 'fs';
import path from 'path';
import firebaseConfig from '../src/scripts/firebaseConfig.js';

const OLD_POPUP_URL = 'japanese-alchemy.web.app/sign-in-with-popup.html';
const OLD_WEBSITE_URL = 'japanese-alchemy-webapp.web.app';
const NEW_POPUP_URL = 'j-buddy-ez3177.web.app/sign-in-with-popup.html';

describe('firebaseConfig identity (P7.3 cutover — j-buddy-ez3177)', () => {
  test('points at the owned j-buddy-ez3177 project, not the old japanese-alchemy project', () => {
    expect(firebaseConfig).toEqual({
      apiKey: 'AIzaSyANsygtC5y-vqF762-IP_y01CSQwBzEUNs',
      authDomain: 'j-buddy-ez3177.firebaseapp.com',
      projectId: 'j-buddy-ez3177',
      storageBucket: 'j-buddy-ez3177.firebasestorage.app',
      messagingSenderId: '793282830675',
      appId: '1:793282830675:web:98e3c136b546b6602bc1a6',
    });
  });

  test('does not carry a measurementId (no confirmed j-buddy-ez3177 value; Analytics unused)', () => {
    expect(firebaseConfig).not.toHaveProperty('measurementId');
  });
});

describe('offscreen popup URL (P7.3 cutover)', () => {
  const offscreenHtml = fs.readFileSync(
    path.join(__dirname, '../src/offscreen/offscreen.html'),
    'utf8'
  );

  test('iframe src points at the new j-buddy-ez3177-hosted popup page', () => {
    expect(offscreenHtml).toContain(`src="https://${NEW_POPUP_URL}"`);
  });

  test('no longer references the old japanese-alchemy popup URL', () => {
    expect(offscreenHtml).not.toContain(OLD_POPUP_URL);
  });
});

describe('sidepanel website/FAQ URLs (P7.3 cutover)', () => {
  const sidepanelJs = fs.readFileSync(
    path.join(__dirname, '../src/sidepanel/sidepanel.js'),
    'utf8'
  );

  test('no longer references the old japanese-alchemy-webapp website URL', () => {
    expect(sidepanelJs).not.toContain(OLD_WEBSITE_URL);
  });
});
