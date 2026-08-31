import type { PackageManifest } from '@workspace/domain';
import { dirOf, findEntry, type PackageKind } from './kind.js';

/**
 * SCORM (1.2 and 2004): a zip with `imsmanifest.xml` naming resources and
 * an organization of items; the launch page is the href of the resource
 * the first launchable item points at.
 *
 * Parsed with a small tag scanner rather than a DOM: it runs anywhere,
 * and the slice of the manifest needed here is tags and attributes.
 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

// XML stores `&` in attributes as `&amp;` — a raw href like
// `start.html?width=1200&amp;height=695` must come out decoded.
const decode = (value: string): string =>
  value.replace(
    /&(?:#(x?)([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi,
    (_, hex: string, code: string, name: string) =>
      name
        ? (ENTITIES[name.toLowerCase()] as string)
        : String.fromCodePoint(Number.parseInt(code, hex ? 16 : 10))
  );

const attr = (tag: string, name: string): string | undefined => {
  const raw =
    new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1] ??
    new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag)?.[1];
  return raw === undefined ? undefined : decode(raw);
};

const tags = (xml: string, name: string): string[] =>
  [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>`, 'gi'))].map(
    (m) => m[0]
  );

const text = (xml: string, name: string): string | undefined => {
  const raw = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([^<]*)<`, 'i')
    .exec(xml)?.[1]
    ?.trim();
  return raw === undefined ? undefined : decode(raw);
};

export interface ScormManifest extends PackageManifest {
  version: '1.2' | '2004' | 'unknown';
  /** Every launchable item, in manifest order. */
  items: Array<{ title: string; launchPath: string }>;
}

export const scormKind: PackageKind = {
  kind: 'scorm',
  detect: (entries) => findEntry(entries, 'imsmanifest.xml') !== undefined,
  async manifest(entries, read) {
    const manifestEntry = findEntry(entries, 'imsmanifest.xml');
    const xml = manifestEntry ? await read(manifestEntry.path) : null;
    const base = manifestEntry ? dirOf(manifestEntry.path) : '';
    if (!xml) return { launchPath: '', version: 'unknown', items: [] };

    const schemaVersion = text(xml, 'schemaversion') ?? '';
    const version: ScormManifest['version'] = /2004|CAM/i.test(schemaVersion)
      ? '2004'
      : /1\.2/.test(schemaVersion)
        ? '1.2'
        : 'unknown';

    const resources = new Map<string, string>();
    for (const tag of tags(xml, 'resource')) {
      const id = attr(tag, 'identifier');
      const href = attr(tag, 'href');
      if (id && href) resources.set(id, href);
    }

    const items: ScormManifest['items'] = [];
    // Items carry their title as a child element; pair each item tag with
    // the text that follows it.
    const itemRe =
      /<(?:\w+:)?item\b([^>]*)>([\s\S]*?)(?=<(?:\w+:)?item\b|<\/(?:\w+:)?item>|<\/(?:\w+:)?organization>)/gi;
    for (const m of xml.matchAll(itemRe)) {
      const tag = `<item${m[1]}>`;
      const ref = attr(tag, 'identifierref');
      if (!ref) continue;
      const href = resources.get(ref);
      if (!href) continue;
      const params = attr(tag, 'parameters') ?? '';
      items.push({
        title: text(m[2] ?? '', 'title') ?? ref,
        launchPath: base + href + params,
      });
    }

    const fallback = [...resources.values()][0];
    const title = text(xml, 'title');
    const manifest: ScormManifest = {
      launchPath: items[0]?.launchPath ?? (fallback ? base + fallback : ''),
      version,
      items,
    };
    if (title) manifest.title = title;
    return manifest;
  },
};
