import { LoroMap, type LoroMovableList, type LoroText } from 'loro-crdt';
import {
  DuplicateNodeIdError,
  type IdOf,
  MissingNodeIdError,
  ROOT_ID,
  type SerializedNode,
} from './tree.js';

const KEY_ID = 'id';
const KEY_TYPE = 'type';
const KEY_PROPS = 'props';
const KEY_TEXT = 'text';
const KEY_CHILDREN = 'children';

/** Keys that get their own container; everything else is a scalar prop. */
const STRUCTURAL = new Set([KEY_TYPE, KEY_TEXT, KEY_CHILDREN]);

// Loro's container generics cannot express a heterogeneous node tree, so the
// looseness is named once here and every cast is contained in this file.
type AnyMap = LoroMap<Record<string, unknown>>;
type AnyList = LoroMovableList<unknown>;

/**
 * Reflects a serialized node onto a CRDT map, emitting the MINIMAL set of
 * operations rather than replacing the subtree.
 *
 * That distinction is the whole point: a full rewrite would still produce a
 * correct document, but its history would be a sequence of "everything
 * changed" entries — useless for a diff, a timeline, or attribution.
 */
export function reconcileNode(
  map: AnyMap,
  node: SerializedNode,
  id: string,
  idOf: IdOf
): void {
  if (map.get(KEY_ID) !== id) map.set(KEY_ID, id);
  if (map.get(KEY_TYPE) !== node.type) map.set(KEY_TYPE, node.type);

  reconcileProps(map.ensureMergeableMap(KEY_PROPS), node);

  if (typeof node.text === 'string') {
    // Myers diff inside Loro: a one-character edit costs one operation, which
    // is what makes character-level history and attribution possible.
    const text = map.ensureMergeableText(KEY_TEXT) as LoroText;
    if (text.toString() !== node.text) text.update(node.text);
  } else if (map.get(KEY_TEXT) !== undefined) {
    map.delete(KEY_TEXT);
  }

  if (Array.isArray(node.children)) {
    reconcileChildren(
      map.ensureMergeableMovableList(KEY_CHILDREN),
      node.children,
      idOf
    );
  } else if (map.get(KEY_CHILDREN) !== undefined) {
    map.delete(KEY_CHILDREN);
  }
}

function reconcileProps(props: AnyMap, node: SerializedNode): void {
  const next = new Map<string, unknown>();
  for (const [key, value] of Object.entries(node)) {
    if (!STRUCTURAL.has(key)) next.set(key, value);
  }

  const current = props.toJSON() as Record<string, unknown>;
  for (const key of Object.keys(current)) {
    if (!next.has(key)) props.delete(key);
  }
  for (const [key, value] of next) {
    if (!sameValue(current[key], value)) {
      props.set(key, value as never);
    }
  }
}

/**
 * Keyed reconciliation of a children list: delete what is gone, then walk the
 * wanted ids into place, moving an existing child rather than deleting and
 * re-inserting it. A move keeps the child's own container — and therefore its
 * history — intact, which a delete+insert would throw away.
 */
function reconcileChildren(
  list: AnyList,
  next: SerializedNode[],
  idOf: IdOf
): void {
  const nextIds = next.map((child, index) => requireId(child, idOf, index));
  const wanted = new Set<string>();
  for (const id of nextIds) {
    if (wanted.has(id)) throw new DuplicateNodeIdError(id);
    wanted.add(id);
  }

  for (let i = list.length - 1; i >= 0; i--) {
    if (!wanted.has(idAt(list, i))) list.delete(i, 1);
  }

  for (let i = 0; i < nextIds.length; i++) {
    const id = nextIds[i] as string;
    const child = placeAt(list, id, i);
    reconcileNode(child, next[i] as SerializedNode, id, idOf);
  }
}

/** Ensures the child with `id` sits at `index`, inserting it if it is new. */
function placeAt(list: AnyList, id: string, index: number): AnyMap {
  for (let i = index; i < list.length; i++) {
    if (idAt(list, i) === id) {
      if (i !== index) list.move(i, index);
      return list.get(index) as AnyMap;
    }
  }
  return list.insertContainer(index, new LoroMap()) as AnyMap;
}

function idAt(list: AnyList, index: number): string {
  return (list.get(index) as AnyMap).get(KEY_ID) as string;
}

function requireId(node: SerializedNode, idOf: IdOf, index: number): string {
  const id = idOf(node);
  if (!id) throw new MissingNodeIdError(node, index);
  return id;
}

/** Reads a node subtree back out of the CRDT. */
export function readNode(map: AnyMap): SerializedNode {
  const node: SerializedNode = { type: map.get(KEY_TYPE) as string };

  const props = map.get(KEY_PROPS) as AnyMap | undefined;
  if (props) Object.assign(node, props.toJSON());

  const text = map.get(KEY_TEXT) as LoroText | undefined;
  if (text) node.text = text.toString();

  const children = map.get(KEY_CHILDREN) as AnyList | undefined;
  if (children) {
    const out: SerializedNode[] = [];
    for (let i = 0; i < children.length; i++) {
      out.push(readNode(children.get(i) as AnyMap));
    }
    node.children = out;
  }
  return node;
}

/** The id the root node is reconciled under. */
export function rootIdOf(node: SerializedNode, idOf: IdOf): string {
  return idOf(node) ?? ROOT_ID;
}

/**
 * Structural comparison of two stored prop values. JSON serialization is
 * enough here because both sides come from the same editor serializer, so key
 * order is stable; the comparison only has to answer "did this change".
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
