import { findEntry, type PackageKind } from './kind.js';

/** Any archive with an index page: a static site, an exported presentation. */
export const htmlBundleKind: PackageKind = {
  kind: 'html-bundle',
  detect: (entries) =>
    findEntry(entries, 'index.html') !== undefined ||
    findEntry(entries, 'index.htm') !== undefined,
  async manifest(entries) {
    const index =
      findEntry(entries, 'index.html') ?? findEntry(entries, 'index.htm');
    return { launchPath: index?.path ?? '' };
  },
};

/** The fallback: an archive with no entry point, browsable as a listing. */
export const archiveKind: PackageKind = {
  kind: 'archive',
  detect: () => true,
  async manifest() {
    return { launchPath: '' };
  },
};
