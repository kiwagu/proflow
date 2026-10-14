/**
 * @file Value encoding for the XML view.
 *
 * Deliberately hand-written rather than delegated to an XML library. The
 * output is a behaviour contract with the agent layer — the model reads this
 * text and addresses nodes by the ids in it — so the exact escaping and
 * attribute shape matter more than generality, and a library would make them
 * incidental to whatever it does by default.
 */

/** Escape text appearing between tags. */
export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape a double-quoted attribute value. */
export function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

export type Attributes = Record<string, string | number | boolean | undefined>;

/**
 * Render attributes, skipping empties.
 *
 * `false` and `undefined` are omitted rather than emitted as `="false"`: the
 * model reads presence as truth, and an explicit negative is noise in a
 * prompt that is paying by the token.
 */
export function renderAttributes(attributes: Attributes): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === false || value === '') continue;
    if (value === true) {
      parts.push(` ${key}="true"`);
      continue;
    }
    parts.push(` ${key}="${escapeAttribute(String(value))}"`);
  }
  return parts.join('');
}

/** The text-format bits Lexical packs into a single integer. */
const TEXT_FORMATS: Array<[number, string]> = [
  [1, 'bold'],
  [2, 'italic'],
  [4, 'strikethrough'],
  [8, 'underline'],
  [16, 'code'],
  [32, 'subscript'],
  [64, 'superscript'],
  [128, 'highlight'],
];

/** Unpack a format bitmask into attributes the model can read. */
export function formatAttributes(format: number | undefined): Attributes {
  if (!format) return {};
  const attributes: Attributes = {};
  for (const [bit, name] of TEXT_FORMATS) {
    if ((format & bit) !== 0) attributes[name] = true;
  }
  return attributes;
}
