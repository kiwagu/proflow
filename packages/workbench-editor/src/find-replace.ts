/**
 * Find & replace over the live document: locates text matches, highlights
 * them with `@lexical/mark` MarkNodes (each match gets a unique id so the
 * UI can scroll to and target one match at a time), and replaces one or
 * all matches. The search/highlight pass always clears any marks from a
 * previous pass first, so re-searching never leaves stale highlights.
 *
 * Scope: matches are found within a single TextNode's text content. A
 * search string that straddles a node boundary (e.g. across a bold/plain
 * run) is not found — the same limitation the ported source UX has.
 */
import { $createMarkNode, $isMarkNode, MarkNode } from '@lexical/mark';
import { $dfs } from '@lexical/utils';
import { $isTextNode, type LexicalEditor, type TextNode } from 'lexical';

const MATCH_ID_PREFIX = 'find-match-';

/**
 * The tag on every update that only moves highlights around. A host that
 * persists the editor's changes skips updates carrying it: a search is not
 * an edit, and must never write to the document on its own.
 */
export const FIND_HIGHLIGHT_TAG = 'find-highlight';

export function matchId(index: number): string {
  return `${MATCH_ID_PREFIX}${index}`;
}

/** Is this MarkNode id one of ours — a search highlight, not content? */
export function isFindHighlightId(id: string): boolean {
  return id.startsWith(MATCH_ID_PREFIX);
}

type SerializedNode = {
  type: string;
  children?: SerializedNode[];
  ids?: string[];
  text?: string;
  [property: string]: unknown;
};

/**
 * The serialised tree without the search highlights: each highlight mark is
 * replaced by its children, and the text the wrap had split is joined back
 * when the pieces are text nodes that agree on EVERYTHING but their text —
 * formatting, style, mode, detail and any node state (an `unlinked` URL
 * must not lose the state that keeps it unlinked). A mark that is not a
 * highlight (a comment anchor, say) is content and stays. Returns the SAME
 * object when there was nothing to strip, so a caller can tell.
 */
export function stripFindHighlights<T extends { root: object }>(tree: T): T {
  const root = tree.root as SerializedNode;
  const stripped = stripNode(root);
  return stripped === root ? tree : { ...tree, root: stripped };
}

function stripNode(node: SerializedNode): SerializedNode {
  if (!node.children) return node;
  let changed = false;
  let joinNext = false;
  const next: SerializedNode[] = [];
  for (const child of node.children) {
    const inner = stripNode(child);
    if (inner !== child) changed = true;
    if (
      inner.type === 'mark' &&
      inner.ids?.some(isFindHighlightId) &&
      inner.children
    ) {
      changed = true;
      // Only the pieces a highlight split are joined: text that was already
      // two nodes before the search stays two nodes.
      for (const grandchild of inner.children) pushJoining(next, grandchild);
      joinNext = true;
    } else {
      if (joinNext) pushJoining(next, inner);
      else next.push(inner);
      joinNext = false;
    }
  }
  if (!changed) return node;
  return { ...node, children: next };
}

/** Appends a node, joining it into a preceding text node of the same shape. */
function pushJoining(out: SerializedNode[], node: SerializedNode): void {
  const previous = out[out.length - 1];
  if (previous && sameButText(previous, node)) {
    out[out.length - 1] = {
      ...previous,
      text: (previous.text ?? '') + (node.text ?? ''),
    };
    return;
  }
  out.push(node);
}

/** Two text nodes that differ in nothing but their text. */
function sameButText(a: SerializedNode, b: SerializedNode): boolean {
  if (a.type !== 'text' || b.type !== 'text') return false;
  return withoutText(a) === withoutText(b);
}

function withoutText(node: SerializedNode): string {
  const { text: _text, ...rest } = node;
  return stable(rest);
}

/**
 * A canonical serialisation: keys sorted at EVERY level, nothing dropped.
 * (`JSON.stringify` with an array replacer would filter property names at
 * every depth, so nested node state such as `$: { unlinked }` would vanish
 * from the comparison and two differently-stated nodes would read equal.)
 */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export type FindMatch = {
  id: string;
  /** The MarkNode's key, once wrapped — the scroll/selection target. */
  key: string;
};

export type TextOccurrence = { start: number; end: number };

/** Every non-overlapping occurrence of `query` in `text`, in order. */
export function findAllOccurrences(
  text: string,
  query: string,
  caseSensitive: boolean
): TextOccurrence[] {
  if (!query) return [];
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();

  const occurrences: TextOccurrence[] = [];
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    occurrences.push({ start: index, end: index + needle.length });
    from = index + needle.length;
  }
  return occurrences;
}

function $clearHighlights(): void {
  for (const { node } of $dfs()) {
    if (
      $isMarkNode(node) &&
      node.getIDs().some((id) => id.startsWith(MATCH_ID_PREFIX))
    ) {
      unwrapPreservingText(node);
    }
  }
}

/** Unwraps a MarkNode, leaving its children as direct siblings. */
function unwrapPreservingText(mark: MarkNode): void {
  const children = mark.getChildren();
  let target = null;
  for (const child of children) {
    if (target === null) {
      mark.insertBefore(child);
    } else {
      target.insertAfter(child);
    }
    target = child;
  }
  mark.remove();
}

/** Wraps each occurrence of `node`'s text in its own MarkNode, in place. */
function wrapOccurrences(
  node: TextNode,
  occurrences: readonly TextOccurrence[],
  nextId: () => string,
  marks: FindMatch[]
): void {
  let workingNode = node;
  let consumed = 0;

  for (const occ of occurrences) {
    const start = occ.start - consumed;
    const end = occ.end - consumed;
    const parts = workingNode.splitText(start, end);

    let offset = 0;
    let matchPart: TextNode | undefined;
    let tailPart: TextNode | undefined;
    for (const part of parts) {
      const partStart = offset;
      const partEnd = offset + part.getTextContentSize();
      if (partStart === start && partEnd === end) matchPart = part;
      if (partStart >= end && !tailPart) tailPart = part;
      offset = partEnd;
    }

    if (matchPart) {
      const id = nextId();
      const mark = $createMarkNode([id]);
      matchPart.insertBefore(mark);
      mark.append(matchPart);
      marks.push({ id, key: mark.getKey() });
    }

    consumed = occ.end;
    if (tailPart) workingNode = tailPart;
  }
}

/**
 * Searches the document for `query` and highlights every match, replacing
 * any highlights left by a previous search. Returns the matches in
 * document order. Pass an empty query to just clear highlights.
 */
export function searchAndHighlight(
  editor: LexicalEditor,
  query: string,
  caseSensitive: boolean
): FindMatch[] {
  const marks: FindMatch[] = [];
  editor.update(
    () => {
      $clearHighlights();
      if (!query) return;

      let index = 0;
      const nextId = () => matchId(index++);

      // Snapshot the text nodes before mutating — $dfs during in-place
      // splitText/wrap edits would otherwise revisit newly created nodes.
      const textNodes = $dfs()
        .map(({ node }) => node)
        .filter($isTextNode)
        .filter((node) => !$isMarkNode(node.getParent()));

      for (const node of textNodes) {
        const occurrences = findAllOccurrences(
          node.getTextContent(),
          query,
          caseSensitive
        );
        if (occurrences.length > 0) {
          wrapOccurrences(node, occurrences, nextId, marks);
        }
      }
    },
    { discrete: true, tag: FIND_HIGHLIGHT_TAG }
  );
  return marks;
}

/** Clears any highlights from the last search without starting a new one. */
export function clearHighlights(editor: LexicalEditor): void {
  editor.update(() => $clearHighlights(), {
    discrete: true,
    tag: FIND_HIGHLIGHT_TAG,
  });
}

function $findMarkById(id: string): MarkNode | undefined {
  for (const { node } of $dfs()) {
    if ($isMarkNode(node) && node.hasID(id)) return node;
  }
  return undefined;
}

/** Replaces the text of one match (by id) and removes its highlight. */
export function replaceMatch(
  editor: LexicalEditor,
  id: string,
  replacement: string
): void {
  editor.update(
    () => {
      const mark = $findMarkById(id);
      if (!mark) return;
      for (const child of mark.getChildren()) {
        if ($isTextNode(child)) child.setTextContent(replacement);
      }
      unwrapPreservingText(mark);
    },
    { discrete: true }
  );
}

/** Replaces every current match's text with `replacement`. */
export function replaceAllMatches(
  editor: LexicalEditor,
  matches: readonly FindMatch[],
  replacement: string
): void {
  editor.update(
    () => {
      for (const match of matches) {
        const mark = $findMarkById(match.id);
        if (!mark) continue;
        for (const child of mark.getChildren()) {
          if ($isTextNode(child)) child.setTextContent(replacement);
        }
        unwrapPreservingText(mark);
      }
    },
    { discrete: true }
  );
}

/** Marks the given match as the "current" one for scroll/selection purposes. */
export function computeNextMatchIndex(
  current: number,
  total: number,
  direction: 'next' | 'prev'
): number {
  if (total === 0) return -1;
  if (current === -1) return direction === 'next' ? 0 : total - 1;
  if (direction === 'next') return current >= total - 1 ? 0 : current + 1;
  return current <= 0 ? total - 1 : current - 1;
}
