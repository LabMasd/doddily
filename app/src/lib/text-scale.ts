import { useWindowDimensions } from 'react-native';

/** Chips, the week strip and other small controls stop growing here; reading text keeps growing. */
export const CHROME_MAX = 1.6;

/**
 * The phone's text size setting. `roomy` is where fixed columns stop fitting (iOS "Larger Text",
 * Android font size above default) and layouts stack or scroll instead of squeezing.
 */
export function useTextScale() {
  const { fontScale } = useWindowDimensions();
  // In development, `globalThis.__ddTextScale = 1.5` forces a size: the web preview has no text size setting.
  const forced = __DEV__ ? (globalThis as { __ddTextScale?: number }).__ddTextScale : undefined;
  const scale = forced || fontScale || 1;
  return { scale, chrome: Math.min(scale, CHROME_MAX), roomy: scale >= 1.2 };
}
