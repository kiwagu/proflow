/**
 * @file Host-environment probes the ported editor sources depend on.
 *
 * The origin app ran inside a native shell as well as the browser, so these
 * probes could answer "desktop", "ios" or "android". This binding layer
 * targets the browser only, so the platform question collapses to "web" and
 * the native-shell probes are constant `false`. They are kept as functions
 * rather than inlined at their call sites so the ported code stays a
 * line-for-line match with its origin and a future native shell only has to
 * change this file.
 */

/** True when the app runs inside a native mobile shell. Browser build: never. */
export function isNativeMobilePlatform(): boolean {
  return false;
}

export const IS_MAC =
  typeof navigator !== 'undefined' &&
  (navigator.platform?.startsWith('Mac') ||
    navigator.userAgent.includes('Mac'));

const coarsePointerQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)')
    : null;

let coarsePointer = coarsePointerQuery?.matches ?? false;

// Tracked live (rather than caching the first answer) so devtools touch
// emulation toggled after load is picked up.
coarsePointerQuery?.addEventListener('change', (event) => {
  coarsePointer = event.matches;
});

/**
 * True for devices that are PRIMARILY touch-driven — false for a touchscreen
 * laptop. A user may still have a keyboard attached (an external keyboard on a
 * tablet), so this answers "what is the primary pointer", not "is a keyboard
 * present".
 */
export function isTouchDevice(): boolean {
  return coarsePointer;
}

const MOBILE_WIDTH_BREAKPOINT = 640;

let mobileWidth =
  typeof window !== 'undefined' &&
  window.innerWidth < MOBILE_WIDTH_BREAKPOINT;

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    mobileWidth = window.innerWidth < MOBILE_WIDTH_BREAKPOINT;
  });
}

export function isMobileWidth(): boolean {
  return mobileWidth;
}

/**
 * True when the device is likely in a phone context: narrow AND primarily
 * touch. Use this for behaviour that should differ on phones but not on
 * tablets or touchscreen desktops.
 */
export function isMobile(): boolean {
  return isMobileWidth() && isTouchDevice();
}

type SafeAreaInsetSide = 'top' | 'right' | 'bottom' | 'left';

export function getSafeAreaInset(side: SafeAreaInsetSide): number {
  if (typeof document === 'undefined') return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    `--safe-${side}`
  );
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : 0;
}
