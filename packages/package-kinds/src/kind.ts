import type { PackageEntry, PackageManifest } from '@workspace/domain';

/** Reads one entry of the package as text, or null when absent. */
export type EntryText = (path: string) => Promise<string | null>;

/**
 * A package kind: how to recognise an archive and what to read out of it.
 * Kinds are tried in order; the first that claims the entries wins.
 */
export interface PackageKind {
  readonly kind: string;
  detect(entries: readonly PackageEntry[]): boolean;
  manifest(
    entries: readonly PackageEntry[],
    read: EntryText
  ): Promise<PackageManifest>;
}

/** Entries may sit under one top-level folder; find `name` at the shallowest depth. */
export function findEntry(
  entries: readonly PackageEntry[],
  name: string
): PackageEntry | undefined {
  const lower = name.toLowerCase();
  return entries
    .filter((e) => {
      const path = e.path.toLowerCase();
      return path === lower || path.endsWith(`/${lower}`);
    })
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0];
}

/** The folder an entry sits in, as a prefix to join relative paths onto. */
export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}
