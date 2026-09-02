import { Button } from '@workspace/ui/components/button';
import { useState } from 'react';
import { deleteEverythingAndStartOver } from '../composition/start-over';

/**
 * The screen a start-up that failed ends on. No service exists here — the
 * failure is that they could not be built — so everything it offers works
 * on the storage directly.
 *
 * Reloading is the first offer: most failures are another tab holding the
 * database, and a reload after closing it is all that is needed. Starting
 * over is the second, for the failures a reload cannot cure — a database
 * missing some of its files — and it asks first, because it ends
 * everything stored on this device.
 */
export function BootFailure({ error }: { error: unknown }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const startOver = async () => {
    setDeleting(true);
    await deleteEverythingAndStartOver();
  };

  return (
    <div className="bg-background text-foreground flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold">The workbench could not start</h1>
      <p className="text-muted-foreground max-w-md text-sm">{String(error)}</p>
      <p className="text-muted-foreground/70 max-w-md text-xs">
        Your documents and files are stored on this device and are not affected.
        Close any other tab with the workbench open — they share one database —
        and reload.
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
        {!confirming ? (
          <Button
            size="sm"
            variant="ghost"
            data-testid="boot-start-over"
            onClick={() => setConfirming(true)}
          >
            Delete local data and start over
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div
          className="border-destructive/40 bg-card mt-2 max-w-md rounded-lg border p-4 text-left"
          data-testid="boot-start-over-confirm"
        >
          <p className="mb-2 text-sm">
            This deletes every document, file and setting stored on this device,
            and cannot be undone. The app starts again as if newly installed.
          </p>
          <p className="text-muted-foreground/70 mb-3 text-xs">
            Other tabs of this app should be closed, or their copy of the
            database may outlive this.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              data-testid="boot-start-over-cancel"
              disabled={deleting}
              onClick={() => setConfirming(false)}
            >
              Keep my data
            </Button>
            <Button
              size="sm"
              variant="destructive"
              data-testid="boot-start-over-confirm-delete"
              disabled={deleting}
              onClick={() => void startOver()}
            >
              {deleting ? 'Deleting…' : 'Delete everything'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
