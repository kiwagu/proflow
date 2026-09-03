export type DocumentKind = 'md' | 'task' | 'snippet' | 'skill';

export interface DocumentMeta {
  id: string;
  title: string;
  kind: DocumentKind;
  preview: string;
  starred: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A serialized editor tree, as plain JSON. Structural on purpose: the domain
 * describes the document's shape without depending on the editor library that
 * produces it.
 */
export interface SerializedNode {
  type: string;
  children?: SerializedNode[];
  text?: string;
  [key: string]: unknown;
}

export interface SerializedTree {
  root: SerializedNode;
}

/** The editor-facing content pair: canonical tree + derived markdown. */
export interface DocumentContent {
  tree: SerializedTree;
  markdown: string;
}
