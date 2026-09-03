import { archiveKind, htmlBundleKind } from './html-bundle.js';
import type { PackageKind } from './kind.js';
import { scormKind } from './scorm.js';

export { archiveKind, htmlBundleKind } from './html-bundle.js';
export { dirOf, type EntryText, findEntry, type PackageKind } from './kind.js';
export { type ScormManifest, scormKind } from './scorm.js';

/** Kinds in detection order: the most specific first, the catch-all last. */
export const PACKAGE_KINDS: readonly PackageKind[] = [
  scormKind,
  htmlBundleKind,
  archiveKind,
];
