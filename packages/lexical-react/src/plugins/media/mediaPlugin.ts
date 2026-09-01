import {
  $createFileNode,
  $createImageNode,
  $createVideoNode,
  $isFileNode,
  $isImageNode,
  $isVideoNode,
} from '@workspace/lexical-nodes';
import {
  $getNodeByKey,
  COMMAND_PRIORITY_HIGH,
  createCommand,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  PASTE_COMMAND,
} from 'lexical';
import { $insertNodesAndSplitList } from '../../utils';
import type { PluginFunction } from '../pluginManager';
import { getAttachmentStore, setUploadProgressFor } from './attachmentStore';

/** Where dropped files land relative to an existing block. */
export type InsertionPoint = { key: NodeKey; position: 'before' | 'after' };

/** Attach these files: store their bytes, then insert a node per file. */
export const INSERT_ATTACHMENT_FILES_COMMAND = createCommand<{
  files: File[];
  at?: InsertionPoint;
}>('INSERT_ATTACHMENT_FILES_COMMAND');

/** Ask the user for files through a picker, then attach them. */
export const TRY_INSERT_ATTACHMENT_UPLOAD_COMMAND = createCommand<
  'image' | 'video' | 'all'
>('TRY_INSERT_ATTACHMENT_UPLOAD_COMMAND');

/** The reference a media node carries for blob-backed bytes. */
export const blobUrl = (hash: string) => `pero-blob://${hash}`;

async function imageSize(
  file: File
): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 0, height: 0 };
  }
}

function $insertAt(node: LexicalNode, at?: InsertionPoint) {
  const anchor = at ? $getNodeByKey(at.key)?.getTopLevelElementOrThrow() : null;
  if (!anchor) {
    $insertNodesAndSplitList([node]);
    return;
  }
  if (at?.position === 'before') anchor.insertBefore(node);
  else anchor.insertAfter(node);
}

/** A node goes in at once, with a local preview; its bytes follow. */
async function attach(
  editor: LexicalEditor,
  files: File[],
  at?: InsertionPoint
) {
  const store = getAttachmentStore();
  if (!store) return;
  for (const file of files) {
    const kind = file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('video/')
        ? 'video'
        : 'file';
    const size =
      kind === 'image' ? await imageSize(file) : { width: 0, height: 0 };
    const preview = kind === 'file' ? '' : URL.createObjectURL(file);
    const localId = `local-${crypto.randomUUID()}`;

    let key = '';
    editor.update(
      () => {
        const node =
          kind === 'image'
            ? $createImageNode({
                srcType: 'local',
                id: localId,
                url: preview,
                alt: file.name,
                ...size,
              })
            : kind === 'video'
              ? $createVideoNode({
                  srcType: 'local',
                  id: localId,
                  url: preview,
                })
              : $createFileNode({
                  hash: '',
                  fileName: file.name,
                  mimeType: file.type || 'application/octet-stream',
                  size: file.size,
                });
        $insertAt(node, at);
        key = node.getKey();
      },
      { discrete: true }
    );
    // Further files follow the one just inserted.
    at = undefined;

    setUploadProgressFor(key, 0);
    try {
      const info = await store.importFile(file, (done, total) =>
        setUploadProgressFor(key, total > 0 ? done / total : 0)
      );
      editor.update(() => {
        const node = $getNodeByKey(key);
        if (!node) return;
        if ($isImageNode(node) || $isVideoNode(node)) {
          node.setSrcType('blob', false);
          node.setId(info.hash, false);
          node.setUrl(blobUrl(info.hash));
        } else if ($isFileNode(node)) {
          node.replace($createFileNode(info));
        }
      });
    } catch (e) {
      // The bytes never made it: take the placeholder out and say why —
      // a node left behind would render as an interrupted upload forever.
      editor.update(() => {
        $getNodeByKey(key)?.remove();
      });
      store.reportError?.(`Could not attach ${file.name}: ${String(e)}`);
    } finally {
      setUploadProgressFor(key, undefined);
      if (preview) URL.revokeObjectURL(preview);
    }
  }
}

function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (accept) input.accept = accept;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/**
 * Attachments: files arrive by drop, paste or picker; their bytes go to
 * the attachment store and a node referencing them by hash goes into the
 * document.
 */
export function mediaPlugin(): PluginFunction {
  return (editor) => {
    const unregister = [
      editor.registerCommand(
        INSERT_ATTACHMENT_FILES_COMMAND,
        ({ files, at }) => {
          if (files.length === 0) return false;
          void attach(editor, files, at);
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        TRY_INSERT_ATTACHMENT_UPLOAD_COMMAND,
        (kind) => {
          const accept =
            kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : '';
          void pickFiles(accept).then((files) => {
            if (files.length > 0) void attach(editor, files);
          });
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!(event instanceof ClipboardEvent)) return false;
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length === 0) return false;
          event.preventDefault();
          void attach(editor, files);
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
    ];
    return () => {
      for (const fn of unregister) fn();
    };
  };
}
