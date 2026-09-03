import type { SerializedNode } from '@workspace/domain';

/**
 * The shape this package reflects into a CRDT: a serialized editor tree of
 * plain JSON, described by the domain rather than imported from the editor.
 * Keeping the CRDT format free of the editor library is what lets it be unit
 * tested in Node, with no browser and no DOM.
 */
export type { SerializedNode, SerializedTree } from '@workspace/domain';

/** The one node that needs no assigned id: there is exactly one of it. */
export const ROOT_ID = 'root';

/**
 * Reads a node's stable id.
 *
 * Stable ids are not a nicety — they are the identity key of the children
 * list, so without them a re-save reads as "every child replaced" and the
 * history degenerates into a sequence of full rewrites. They cannot be added
 * retroactively, which is why a missing one is an error rather than a
 * fallback to positional matching.
 */
export type IdOf = (node: SerializedNode) => string | undefined;

/** Node state is where the editor's id plugin writes, under `$`. */
export const defaultIdOf: IdOf = (node) => {
  const state = node.$ as { id?: unknown } | undefined;
  return typeof state?.id === 'string' ? state.id : undefined;
};

export class MissingNodeIdError extends Error {
  constructor(node: SerializedNode, index: number) {
    super(
      `node <${node.type}> at index ${index} has no stable id; ` +
        'the editor must assign ids before the tree is committed'
    );
    this.name = 'MissingNodeIdError';
  }
}

export class DuplicateNodeIdError extends Error {
  constructor(id: string) {
    super(`node id ${id} appears twice among siblings; ids must be unique`);
    this.name = 'DuplicateNodeIdError';
  }
}
