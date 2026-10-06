import type { Kid, Loc } from './types';

/**
 * The demo on doddily.app: the app itself, running in the phone at the top of the home page.
 * Built with EXPO_PUBLIC_DEMO=1 (web only). It always shows the same example place, keeps nothing on the
 * visitor's device, and the postcode cannot be changed: that is what the app is for.
 */
export const DEMO = process.env.EXPO_PUBLIC_DEMO === '1';

export const DEMO_SETTINGS: { loc: Loc; radius: number; onboarded: boolean; kids: Kid[] } = {
  loc: { lat: 51.545033, lng: -0.056407, name: 'E8 1EA', postcode: 'E8 1EA' },
  radius: 3,
  onboarded: true,
  kids: [{ id: 'k1', name: 'Ada', band: '1to2' }],
};

export const DEMO_NOTE = 'This is a demo around E8 1EA. Get the app to use your own postcode.';
