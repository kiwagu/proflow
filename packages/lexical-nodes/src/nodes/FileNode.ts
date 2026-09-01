import {
  $applyNodeReplacement,
  type DOMConversionMap,
  type DOMExportOutput,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { type DecoratorComponent, getDecorator } from '../decoratorRegistry';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';
import { DecoratorBlockNode } from './DecoratorBlockNode';

/**
 * A file attached to the document: a card naming the file, pointing at its
 * bytes by content hash. Images and video have their own media nodes; this
 * one is for everything else — a PDF, an archive, a spreadsheet.
 *
 * The hash is the only reference the document carries. Bytes live in the
 * blob store, names and folders on the file tree; the card resolves both
 * when it renders.
 */
export type FileInfo = {
  hash: string;
  fileName: string;
  mimeType: string;
  size: number;
};

export type SerializedFileNode = Spread<FileInfo, SerializedLexicalNode>;
export type FileDecoratorProps = FileInfo & { key: NodeKey };

export class FileNode extends DecoratorBlockNode<
  DecoratorComponent<FileDecoratorProps> | undefined
> {
  __hash: string;
  __fileName: string;
  __mimeType: string;
  __size: number;

  constructor(info: FileInfo, key?: NodeKey) {
    super('', key);
    this.__hash = info.hash;
    this.__fileName = info.fileName;
    this.__mimeType = info.mimeType;
    this.__size = info.size;
  }

  static getType(): string {
    return 'file';
  }

  static clone(node: FileNode): FileNode {
    return new FileNode(node.getInfo(), node.__key);
  }

  static importJSON(serializedNode: SerializedFileNode): FileNode {
    const node = $createFileNode(serializedNode).updateFromJSON(serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedFileNode {
    return {
      ...super.exportJSON(),
      ...this.getInfo(),
      type: 'file',
      version: 1,
    };
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    return {
      a: (domNode: HTMLElement) => {
        const hash = domNode.getAttribute('data-file-hash');
        if (!hash) return null;
        return {
          conversion: () => ({
            node: $createFileNode({
              hash,
              fileName: domNode.textContent ?? '',
              mimeType:
                domNode.getAttribute('type') ?? 'application/octet-stream',
              size: Number(domNode.getAttribute('data-file-size')) || 0,
            }),
          }),
          priority: 1,
        };
      },
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('a');
    element.setAttribute('href', `docblob://${this.__hash}`);
    element.setAttribute('data-file-hash', this.__hash);
    element.setAttribute('data-file-size', String(this.__size));
    element.setAttribute('type', this.__mimeType);
    element.textContent = this.__fileName;
    return { element };
  }

  getInfo(): FileInfo {
    return {
      hash: this.__hash,
      fileName: this.__fileName,
      mimeType: this.__mimeType,
      size: this.__size,
    };
  }

  getHash(): string {
    return this.__hash;
  }

  getTextContent(): string {
    return this.__fileName;
  }

  isKeyboardSelectable(): true {
    return true;
  }

  decorate(): DecoratorComponent<FileDecoratorProps> | undefined {
    const decorator = getDecorator<FileDecoratorProps>(FileNode);
    if (!decorator) return undefined;
    const props = { ...this.getInfo(), key: this.__key };
    return () => decorator(props);
  }
}

export function $createFileNode(info: FileInfo): FileNode {
  return $applyNodeReplacement(new FileNode(info));
}

export function $isFileNode(
  node: LexicalNode | null | undefined
): node is FileNode {
  return node instanceof FileNode;
}
