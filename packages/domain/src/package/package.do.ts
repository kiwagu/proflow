/**
 * A package is an archive the app has unpacked and indexed: a bundle of
 * HTML resources, a course, anything with an entry point and a tree of
 * files. The layer is generic — `kind` names the plugin that understood
 * the archive, and `manifest` is whatever that plugin parsed out of it.
 */
export interface PackageInfo {
  /** The archive's content hash; the package shares it with the blob. */
  hash: string;
  kind: string;
  manifest: PackageManifest;
  createdAt: Date;
}

/** Fields every kind provides; plugins add their own beside them. */
export interface PackageManifest {
  /** Path inside the package of the document to open first. */
  launchPath: string;
  title?: string;
  [key: string]: unknown;
}

export interface PackageEntry {
  path: string;
  size: number;
  mime: string;
}

/** What an archive holds, read from its index before anything is unpacked. */
export interface PackagePreview {
  kind: string;
  entryCount: number;
  /** Total size once unpacked. */
  totalSize: number;
  /** The entry that would launch, when the kind names one from the index. */
  launchHint?: string;
}

/** One row of the package's audit trail: what was asked, and whether it was allowed. */
export interface PackageAuditEvent {
  op: string;
  path: string;
  allowed: boolean;
}
