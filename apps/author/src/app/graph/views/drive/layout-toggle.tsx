import type { LayoutMode } from '@workspace/ui/components/platform/layout-toggle';

export { LayoutToggle } from '@workspace/ui/components/platform/layout-toggle';

/** The grid/list display layout — a per-device UI preference (the `drive-layout` cookie).
 * App-local alias over the shared `LayoutMode` so existing imports stay stable. */
export type DriveLayout = LayoutMode;
