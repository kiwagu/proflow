/**
 * @file Moving a document between the agent and the live editor.
 *
 * An editing session runs headlessly on a copy of the document and hands
 * back a whole tree. Two operations bring that across: reading what the
 * editor holds right now, and landing a result in it. Neither may go
 * through the document store — that is the fallback the agent takes when
 * no editor is open, and it costs the user their undo stack and paints the
 * document from underneath them.
 *
 * So the result is reconciled into the live editor BY NODE ID, updating
 * nodes in place: a block the session left alone keeps its node and its
 * DOM, so nothing is rebuilt wholesale, nothing flashes, and a selection
 * that pointed into text that no longer exists is never pushed to the DOM.
 */
import {
  $updateAllNodeIds,
  type NodeIdMappings,
} from '@workspace/lexical-nodes';
import type { EditorDocumentBridge } from '@workspace/workbench-agent';
import deepEqual from 'fast-deep-equal';
import {
  $addUpdateTag,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $parseSerializedNode,
  $setSelection,
  type ElementNode,
  HISTORY_MERGE_TAG,
  HISTORY_PUSH_TAG,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type SerializedEditorState,
  type SerializedLexicalNode,
  SKIP_DOM_SELECTION_TAG,
} from 'lexical';

/**
 * The live editor the agent addresses: which document it holds, and the
 * instance plus id mapping to read and write through.
 */
export type LiveDocument = {
  documentId: string;
  editor: LexicalEditor;
  mapping: NodeIdMappings;
};

/**
 * The editor's side of the agent seam: a mutable slot holding whatever the
 * editor has open, and the bridge that answers from it.
 *
 * The slot is deliberately a closure variable rather than a React ref: the
 * agent asks its questions from a worker message, outside render and
 * outside any event handler, so there is no render pass for a ref to be
 * read during. Its host creates one seam per surface and pushes the live
 * editor into it as the editor mounts and unmounts.
 */
export function createAgentSeam(): {
  bridge: EditorDocumentBridge;
  setLive: (live: LiveDocument | null) => void;
} {
  let live: LiveDocument | null = null;
  return {
    bridge: createEditorDocumentBridge(() => live),
    setLive(next) {
      live = next;
    },
  };
}

/**
 * The editor's side of the agent seam, over whatever the editor holds at
 * the moment a question arrives.
 *
 * `live` is read per call rather than captured: a session started against
 * one document can finish after the user opened another, and answering for
 * the wrong document would overwrite it. Both answers are then `null` /
 * `false`, which sends the agent back to the document store — an honest
 * fallback, rather than a silent write into the wrong place.
 */
export function createEditorDocumentBridge(
  live: () => LiveDocument | null
): EditorDocumentBridge {
  const held = (documentId: string): LiveDocument | null => {
    const current = live();
    return current && current.documentId === documentId ? current : null;
  };
  return {
    documentId: () => live()?.documentId ?? null,
    readState: (documentId) => {
      const current = held(documentId);
      return current ? readAgentState(current.editor) : null;
    },
    applyEdit: (documentId, result, partial) => {
      const current = held(documentId);
      if (!current) return false;
      applyAgentState(current.editor, current.mapping, result.state, {
        partial,
      });
      return true;
    },
  };
}

/**
 * The editor's current content, as the agent reads it.
 *
 * A plain serialization, deliberately: every node class this editor
 * registers also carries the id plugin's transform, so ids and the id↔key
 * mapping are already current when the read happens. Stamping again here
 * would be an `editor.update` that dirties nodes — which the surface's save
 * listener cannot tell from the user typing, so merely ASKING the editor
 * what it holds would schedule a write.
 */
export function readAgentState(editor: LexicalEditor): SerializedEditorState {
  return editor.getEditorState().toJSON();
}

/**
 * Which editors have an agent edit open in their history.
 *
 * A session reports progress as it goes; the first paint that changes
 * something opens a history entry and every later one merges into it, so
 * however many times the document repainted, one undo takes the whole
 * session back.
 */
const entryOpen = new WeakSet<LexicalEditor>();

/**
 * Land an agent's result in the live editor.
 *
 * `partial` marks a result the session will still add to, which is what
 * keeps the whole session in one undo step.
 */
export function applyAgentState(
  editor: LexicalEditor,
  mapping: NodeIdMappings,
  state: SerializedEditorState,
  options: { partial: boolean }
): void {
  const before = editor.getEditorState();
  editor.update(
    () => {
      $addUpdateTag(SKIP_DOM_SELECTION_TAG);
      $setSelection(null);
      $reconcileSerializedState(before.toJSON(), state, mapping);
      $updateAllNodeIds(mapping);
    },
    {
      discrete: true,
      // A small reconciled change looks, to the history plugin, like typing
      // it could fold into the user's last entry; say explicitly whether
      // this paint opens the edit's entry or joins it.
      tag: entryOpen.has(editor) ? HISTORY_MERGE_TAG : HISTORY_PUSH_TAG,
    }
  );
  // A paint that changed nothing (the session reported before its first
  // operation landed) produced no update and opened no entry.
  if (editor.getEditorState() !== before) entryOpen.add(editor);
  if (!options.partial) entryOpen.delete(editor);
}

type NodeWithChildren = SerializedLexicalNode & {
  children: SerializedLexicalNode[];
};

/** A node's durable id, as it serializes — in the node-state object. */
function idOf(node: SerializedLexicalNode): string | undefined {
  const id = (node as { $?: { id?: unknown } }).$?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function hasChildren(node: SerializedLexicalNode): node is NodeWithChildren {
  return 'children' in node && Array.isArray(node.children);
}

/** The node's own value, without the children reconciled separately. */
function ownValue(
  node: SerializedLexicalNode
): LexicalUpdateJSON<SerializedLexicalNode> {
  return {
    ...node,
    children: undefined,
  } as LexicalUpdateJSON<SerializedLexicalNode>;
}

/** `id -> parent id`, so a node that changed parents is recognised as moved. */
type ParentMap = Map<string, string | undefined>;

function buildParentMap(
  node: SerializedLexicalNode,
  parentId: string | undefined,
  out: ParentMap
): void {
  const id = idOf(node);
  if (id) out.set(id, parentId);
  if (hasChildren(node)) {
    for (const child of node.children) buildParentMap(child, id, out);
  }
}

function $nodeById(
  mapping: NodeIdMappings,
  id: string
): LexicalNode | null | undefined {
  const key = mapping.idToNodeKeyMap.get(id);
  return key === undefined ? null : $getNodeByKey(key);
}

/**
 * Bring the live document to `next`, emitting the minimal set of changes.
 *
 * The root is addressed as a node rather than looked up by id: ids are
 * assigned to the root's descendants, not to the root itself.
 */
function $reconcileSerializedState(
  previous: SerializedEditorState,
  next: SerializedEditorState,
  mapping: NodeIdMappings
): void {
  const previousParents: ParentMap = new Map();
  const nextParents: ParentMap = new Map();
  buildParentMap(previous.root, undefined, previousParents);
  buildParentMap(next.root, undefined, nextParents);

  $applyChildren(
    $getRoot(),
    previous.root as unknown as NodeWithChildren,
    next.root as unknown as NodeWithChildren,
    mapping,
    previousParents,
    nextParents
  );
}

function $applyChildren(
  parent: ElementNode,
  previous: NodeWithChildren,
  next: NodeWithChildren,
  mapping: NodeIdMappings,
  previousParents: ParentMap,
  nextParents: ParentMap
): void {
  const previousChildren = previous.children;
  const nextChildren = next.children;

  const previousIndexById = new Map<string, number>();
  const nextIndexById = new Map<string, number>();
  for (const [index, child] of previousChildren.entries()) {
    const id = idOf(child);
    if (id) previousIndexById.set(id, index);
  }
  for (const [index, child] of nextChildren.entries()) {
    const id = idOf(child);
    if (id) nextIndexById.set(id, index);
  }

  // Removals first, back to front, so the surviving children keep the
  // indices the insert pass below addresses them by.
  for (let index = previousChildren.length - 1; index >= 0; index--) {
    const child = previousChildren[index];
    if (!child) continue;
    const id = idOf(child);
    if (id && nextIndexById.has(id)) continue;
    if (index < parent.getChildrenSize()) parent.splice(index, 1, []);
  }

  for (const [index, nextChild] of nextChildren.entries()) {
    const id = idOf(nextChild);
    const node = id ? $nodeById(mapping, id) : null;

    // Unknown to this editor: the session created it, so it is inserted
    // whole, children and all.
    if (!id || !node) {
      parent.splice(index, 0, [$parseSerializedNode(nextChild)]);
      continue;
    }

    const previousParentId = previousParents.get(id);
    const nextParentId = nextParents.get(id);
    if (previousParentId !== nextParentId) {
      $moveBetweenParents(parent, node, mapping, previousParentId, index);
      continue;
    }

    const at = parent.getChildren().indexOf(node);
    if (at !== -1 && at !== index) {
      parent.splice(at, 1, []);
      parent.splice(index, 0, [node]);
    }

    const previousIndex = previousIndexById.get(id);
    const previousChild =
      previousIndex === undefined ? undefined : previousChildren[previousIndex];
    if (
      previousChild &&
      !deepEqual(ownValue(previousChild), ownValue(nextChild))
    ) {
      node.updateFromJSON(ownValue(nextChild));
      node.markDirty();
    }

    // Recurse into children. A code block's children are its highlight
    // tokens, rebuilt with fresh ids by every highlighter run, so an
    // unchanged block would be re-tokenized on every reconcile; equal text
    // and language mean equal block.
    if (
      previousChild &&
      hasChildren(previousChild) &&
      hasChildren(nextChild) &&
      $isElementNode(node) &&
      !$isUnchangedCodeBlock(node, nextChild)
    ) {
      $applyChildren(
        node,
        previousChild,
        nextChild,
        mapping,
        previousParents,
        nextParents
      );
    }
  }
}

function $moveBetweenParents(
  parent: ElementNode,
  node: LexicalNode,
  mapping: NodeIdMappings,
  previousParentId: string | undefined,
  index: number
): void {
  const previousParent = previousParentId
    ? $nodeById(mapping, previousParentId)
    : null;
  if (previousParent && $isElementNode(previousParent)) {
    const at = previousParent.getChildren().indexOf(node);
    if (at !== -1) previousParent.splice(at, 1, []);
  }
  parent.splice(index, 0, [node]);
}

function $isUnchangedCodeBlock(
  node: LexicalNode,
  serialized: SerializedLexicalNode
): boolean {
  if (node.getType() !== 'code' || serialized.type !== 'code') return false;
  const language = (serialized as { language?: string }).language;
  const current = (node.exportJSON() as { language?: string }).language;
  return language === current && node.getTextContent() === textOf(serialized);
}

function textOf(node: SerializedLexicalNode): string {
  const text = (node as { text?: unknown }).text;
  if (typeof text === 'string') return text;
  if (node.type === 'linebreak') return '\n';
  return hasChildren(node) ? node.children.map(textOf).join('') : '';
}
