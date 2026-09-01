/**
 * @file Virtual-keyboard geometry, published as signals.
 *
 * The editor's iOS cursor-scroll and floating-menu placement code needs to
 * know whether the soft keyboard is up and how tall it is. Whoever owns the
 * app shell writes these (from the VisualViewport API or a native shell
 * bridge); the editor only reads them. Defaults are "no keyboard", which is
 * correct for every desktop browser.
 */
import { createSignal } from '../reactive/signal';

const visible = createSignal(false);
const height = createSignal(0);

export const virtualKeyboardVisible = visible.get;
export const setVirtualKeyboardVisible = visible.set;
export const subscribeVirtualKeyboardVisible = visible.subscribe;

export const virtualKeyboardHeight = height.get;
export const setVirtualKeyboardHeight = height.set;
export const subscribeVirtualKeyboardHeight = height.subscribe;
