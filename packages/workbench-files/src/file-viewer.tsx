'use client';

import type { FileNode } from '@workspace/domain';
import { cn } from '@workspace/ui/lib/utils';
import { Download } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { FileIcon } from './file-icon.js';
import { useBlobs } from './file-services.js';
import { categoryOf, formatSize } from './file-tree.js';

/** How much of a text file is read for the preview. */
const TEXT_PREVIEW_BYTES = 512 * 1024;

/**
 * The bytes of a node, as an object URL that is revoked when the viewer
 * moves on.
 *
 * A blob out of the local store is lazily backed, so making a URL for it
 * copies nothing; the revoke is what keeps a long session from pinning
 * every file the user has looked at.
 */
function useBlobUrl(hash: string | null): {
  blob: Blob | null;
  url: string | null;
  loading: boolean;
} {
  const blobs = useBlobs();
  // Carrying the hash the bytes belong to is what makes switching files
  // safe: a delivery is published only when it still answers the question
  // being asked, so the previous file's bytes never flash under the new
  // file's name while the read is in flight.
  const [loaded, setLoaded] = useState<{
    hash: string;
    blob: Blob | null;
    url: string | null;
  } | null>(null);

  useEffect(() => {
    if (!hash) return;
    let url: string | undefined;
    let live = true;
    void blobs.get(hash).then((blob) => {
      if (!live) return;
      url = blob ? URL.createObjectURL(blob) : undefined;
      setLoaded({ hash, blob, url: url ?? null });
    });
    return () => {
      live = false;
      // A lazily-backed blob costs nothing until its URL exists; revoking
      // it here is what keeps a long session from pinning every file the
      // user has looked at.
      if (url) URL.revokeObjectURL(url);
    };
  }, [blobs, hash]);

  const current = loaded?.hash === hash ? loaded : null;
  return {
    blob: current?.blob ?? null,
    url: current?.url ?? null,
    loading: hash !== null && current === null,
  };
}

/** The head of a text file, for the plain-text preview. */
function useTextPreview(blob: Blob | null, enabled: boolean): string | null {
  const [read, setRead] = useState<{ blob: Blob; text: string } | null>(null);
  useEffect(() => {
    if (!blob || !enabled) return;
    let live = true;
    void blob
      .slice(0, TEXT_PREVIEW_BYTES)
      .text()
      .then((text) => {
        if (live) setRead({ blob, text });
      });
    return () => {
      live = false;
    };
  }, [blob, enabled]);
  return read?.blob === blob ? read.text : null;
}

/**
 * Shows a blob-backed file with whatever the browser renders natively:
 * images, video, audio, PDF and text. Anything else gets a card with the
 * facts and a download.
 *
 * An archive is not a file to look at but a package to run, and running
 * one is a separate surface — so the host supplies it through
 * `renderArchive` and this viewer stays a pure preview.
 */
export function FileViewer({
  node,
  renderArchive,
  className,
}: {
  node: FileNode;
  renderArchive?: (node: FileNode) => ReactNode;
  className?: string;
}) {
  const { blob, url, loading } = useBlobUrl(node.blobHash);
  const category = categoryOf(node.mime);
  const text = useTextPreview(blob, category === 'text');

  return (
    <div
      className={cn('flex h-full min-h-0 flex-col', className)}
      data-testid="file-viewer"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <FileIcon node={node} />
        <h2
          className="min-w-0 flex-1 truncate text-sm font-medium"
          data-testid="file-viewer-name"
        >
          {node.name}
        </h2>
        <span className="text-xs text-muted-foreground">
          {node.mime} · {formatSize(node.size)}
        </span>
        {url ? (
          <a
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Download"
            aria-label="Download"
            data-testid="file-download"
            href={url}
            download={node.name}
          >
            <Download className="size-4" />
          </a>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/40 p-4">
        <ViewerBody
          node={node}
          url={url}
          text={text}
          loading={loading}
          renderArchive={renderArchive}
        />
      </div>
    </div>
  );
}

function ViewerBody({
  node,
  url,
  text,
  loading,
  renderArchive,
}: {
  node: FileNode;
  url: string | null;
  text: string | null;
  loading: boolean;
  renderArchive?: (node: FileNode) => ReactNode;
}) {
  if (!url)
    return (
      <p className="text-muted-foreground" data-testid="file-viewer-status">
        {loading ? 'Loading…' : 'These bytes are not on this device.'}
      </p>
    );

  const category = categoryOf(node.mime);
  if (category === 'image')
    return (
      <img
        src={url}
        alt={node.name}
        className="max-h-full max-w-full rounded-md object-contain"
      />
    );
  if (category === 'video')
    return (
      <video src={url} controls className="max-h-full max-w-full rounded-md">
        {/* A file the user uploaded carries no caption track of its own;
        the empty track keeps the element well-formed. */}
        <track kind="captions" />
      </video>
    );
  if (category === 'audio')
    return (
      <audio src={url} controls className="w-full max-w-xl">
        <track kind="captions" />
      </audio>
    );
  if (category === 'pdf')
    return (
      <iframe
        src={url}
        title={node.name}
        className="h-full w-full rounded-md border border-border bg-white"
      />
    );
  if (category === 'archive' && renderArchive)
    return <div className="h-full w-full">{renderArchive(node)}</div>;
  if (category === 'text')
    return (
      <pre
        className="h-full w-full overflow-auto rounded-md border border-border bg-background p-4 font-mono text-xs whitespace-pre-wrap"
        data-testid="file-viewer-text"
      >
        {text}
      </pre>
    );

  return (
    <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
      <FileIcon node={node} className="size-12" />
      <p className="text-sm">No preview for this file type.</p>
      <a
        className="text-sm text-primary underline"
        href={url}
        download={node.name}
      >
        Download {node.name}
      </a>
    </div>
  );
}
