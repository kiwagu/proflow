/**
 * @file Durable node ids.
 *
 * Lexical's own `NodeKey` is per-session: it is minted when a node enters an
 * editor and is meaningless once that editor is gone. The sync model needs an
 * identity that survives serialization, reload, copy/paste and a collaborative
 * merge, because the id is the key the CRDT matches children by — without it a
 * document reconciles positionally and every save reads as a full rewrite.
 *
 * So every node carries an id in Lexical *node state* under the key `id`,
 * which serializes into the node's `$` object. That is exactly where the CRDT
 * layer looks for it, and it is the whole contract between this package and
 * the sync layer.
 *
 * The plugin also maintains a bidirectional `id <-> NodeKey` map the host can
 * hold, so the app and the agent can address a node across editor sessions.
 */
import {
  $getNodeByKey,
  $getRoot,
  $getState,
  $isElementNode,
  $setState,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  createState,
  type Klass,
  type LexicalCommand,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  PASTE_COMMAND,
  type SerializedLexicalNode,
} from 'lexical';
import { nanoid } from 'nanoid';

/**
 * Ids are 11 characters, everywhere. One length, no exceptions: a document
 * whose ids come in two lengths depending on which code path minted them is
 * needlessly hard to reason about when debugging a merge.
 */
const ID_LENGTH = 11;

const newId = (): string => nanoid(ID_LENGTH);

/**
 * The id lives in node state, so it lands in the serialized node's `$` object
 * and round-trips through `exportJSON`/`importJSON` for free.
 */
export const idState = createState('id', {
  parse: (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null,
});

/** The `id <-> NodeKey` correspondence for one editor session. */
export type NodeIdMappings = {
  idToNodeKeyMap: Map<string, NodeKey>;
  nodeKeyToIdMap: Map<NodeKey, string>;
};

export function createNodeIdMappings(): NodeIdMappings {
  return { idToNodeKeyMap: new Map(), nodeKeyToIdMap: new Map() };
}

/** Read a node's durable id, or `null` when it has not been assigned one. */
export function $getId(node: LexicalNode | null | undefined): string | null {
  if (!node) return null;
  return $getState(node, idState);
}

/** Write a node's durable id. */
export function $setId<T extends LexicalNode>(node: T, id: string): T {
  return $setState(node, idState, id);
}

/**
 * Carry an id from an incoming serialized node onto the node built from it.
 *
 * Every node's `importJSON` calls this, so a round trip never mints a new id
 * for a node that already had one — which is what makes an export/import cycle
 * identity-preserving rather than a document-wide renumbering.
 */
export function $applyIdFromSerialized<T extends LexicalNode>(
  node: T,
  serialized: SerializedLexicalNode
): T {
  const state = (serialized as { $?: { id?: unknown } }).$;
  const id = state?.id;
  if (typeof id === 'string' && id.length > 0) {
    return $setId(node, id);
  }
  return node;
}

/** Assign ids to a whole tree, depth-first. */
export const INITIALIZE_DOCUMENT_IDS: LexicalCommand<void> = createCommand(
  'INITIALIZE_DOCUMENT_IDS'
);

function $assign(node: LexicalNode, mappings: NodeIdMappings): void {
  const key = node.getKey();
  const existing = $getId(node);

  // Collision repair: an id already pointing at a *different* live node means
  // this node is a copy (a pasted subtree carries its source's ids), so it
  // needs an identity of its own rather than to shadow the original.
  if (existing) {
    const mapped = mappings.idToNodeKeyMap.get(existing);
    if (mapped === undefined || mapped === key) {
      mappings.idToNodeKeyMap.set(existing, key);
      mappings.nodeKeyToIdMap.set(key, existing);
      return;
    }
  }

  const id = newId();
  $setId(node, id);
  mappings.idToNodeKeyMap.set(id, key);
  mappings.nodeKeyToIdMap.set(key, id);
}

function $evict(key: NodeKey, mappings: NodeIdMappings): void {
  const id = mappings.nodeKeyToIdMap.get(key);
  if (id !== undefined) {
    mappings.idToNodeKeyMap.delete(id);
    mappings.nodeKeyToIdMap.delete(key);
  }
}

/**
 * Drop map entries for nodes that are no longer in the document.
 *
 * The mutation listener does this incrementally in the browser. Headless
 * Lexical has no mutation listeners at all (see `nodeIdPlugin`), so a
 * long-lived headless session sweeps instead — otherwise the map grows
 * without bound and, worse, keeps claiming ids for nodes that are gone, which
 * would make collision repair mint fresh ids for innocent nodes.
 */
export function $pruneNodeIds(mappings: NodeIdMappings): void {
  const live = new Set<NodeKey>();
  const visit = (node: LexicalNode): void => {
    live.add(node.getKey());
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) visit(child);
    }
  };
  for (const child of $getRoot().getChildren()) visit(child);

  for (const key of [...mappings.nodeKeyToIdMap.keys()]) {
    if (!live.has(key)) $evict(key, mappings);
  }
}

/**
 * Walk the tree depth-first and give everything an id.
 *
 * Used when adopting a document that was produced without the plugin running —
 * a markdown import, a seed, anything an agent assembled headlessly — so the
 * result is immediately acceptable to the CRDT layer.
 */
export function $updateAllNodeIds(mappings: NodeIdMappings): void {
  const visit = (node: LexicalNode): void => {
    $assign(node, mappings);
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) visit(child);
    }
  };
  for (const child of $getRoot().getChildren()) visit(child);
}

/** Strip ids from the given nodes so the transforms mint fresh ones. */
function $clearIds(nodes: LexicalNode[]): void {
  for (const node of nodes) $setState(node, idState, null);
}

export type NodeIdPluginOptions = {
  /** Every node class registered on the editor. */
  nodes: ReadonlyArray<Klass<LexicalNode>>;
  /** The map the host holds; the plugin keeps it current. */
  mappings: NodeIdMappings;
};

/**
 * Whether this editor came from `createHeadlessEditor`.
 *
 * That factory replaces every DOM-dependent registration method with a throw,
 * so the plugin has to ask before registering rather than catch afterwards —
 * catching would also swallow genuine registration failures.
 */
function isHeadless(editor: LexicalEditor): boolean {
  return (editor as unknown as { _headless?: boolean })._headless === true;
}

/**
 * Registers the id machinery on an editor. Returns the teardown function
 * Lexical plugins conventionally return.
 */
export function nodeIdPlugin({ nodes, mappings }: NodeIdPluginOptions) {
  return (editor: LexicalEditor): (() => void) => {
    const teardown: Array<() => void> = [];

    // 1. Assign on sight: a transform per registered class, so a node gets an
    //    id the moment it appears, whatever created it.
    for (const nodeClass of nodes) {
      teardown.push(
        editor.registerNodeTransform(nodeClass, (node: LexicalNode) => {
          $assign(node, mappings);
        })
      );
    }

    // 2. Mutation tracking. Listeners are read-only, so newly created nodes
    //    are ided in a follow-up update; destroyed nodes leave no map entry
    //    behind, which is what keeps collision repair honest over a long
    //    session.
    //
    //    Headless Lexical does not support mutation listeners at all — it
    //    throws rather than no-oping. That is fine and expected: a headless
    //    consumer runs a bounded transformation and then serializes, so it
    //    has no long-lived map to maintain. It should call `$pruneNodeIds`
    //    if it does keep one alive across many edits.
    if (!isHeadless(editor)) {
      for (const nodeClass of nodes) {
        teardown.push(
          editor.registerMutationListener(nodeClass, (mutations) => {
            const created: NodeKey[] = [];
            for (const [key, mutation] of mutations) {
              if (mutation === 'created') created.push(key);
              else if (mutation === 'destroyed') $evict(key, mappings);
            }
            if (created.length === 0) return;
            editor.update(() => {
              for (const key of created) {
                const node = $getNodeByKey(key);
                if (node) $assign(node, mappings);
              }
            });
          })
        );
      }
    }

    // 3. Paste invalidation. Pasted content arrives carrying the ids of the
    //    nodes it was copied from — possibly from a different document, where
    //    collision repair alone cannot help because those ids are not in this
    //    session's map at all and so look perfectly valid.
    //
    //    So we snapshot which nodes existed before the paste and strip ids
    //    from whatever is new afterwards, letting the transforms mint fresh
    //    ones. Note this clears only the ARRIVING nodes: clearing the whole
    //    document here would renumber every node on every paste and make the
    //    next sync read as a full rewrite.
    //
    //    This handler deliberately returns FALSE. It runs at critical priority
    //    to act before the insertion settles, but it does not claim the
    //    command — the table-aware paste handler and the clipboard fallback
    //    still need to run and perform the actual insertion. Returning true
    //    here silently breaks pasting into tables.
    teardown.push(
      editor.registerCommand(
        PASTE_COMMAND,
        () => {
          const before = new Set<NodeKey>(mappings.nodeKeyToIdMap.keys());
          // Runs after the handlers that actually insert the content.
          queueMicrotask(() => {
            editor.update(() => {
              const incoming: LexicalNode[] = [];
              const visit = (node: LexicalNode): void => {
                if (!before.has(node.getKey())) incoming.push(node);
                if ($isElementNode(node)) {
                  for (const child of node.getChildren()) visit(child);
                }
              };
              for (const child of $getRoot().getChildren()) visit(child);
              $clearIds(incoming);
            });
          });
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      )
    );

    // 4. Bulk initialization on demand.
    teardown.push(
      editor.registerCommand(
        INITIALIZE_DOCUMENT_IDS,
        () => {
          $updateAllNodeIds(mappings);
          return true;
        },
        COMMAND_PRIORITY_EDITOR
      )
    );

    return () => {
      for (const fn of teardown) fn();
    };
  };
}
