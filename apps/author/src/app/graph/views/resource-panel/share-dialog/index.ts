/**
 * ShareDialog module — public surface. The ONE Share editor opened
 * from the ⋯ node-actions menu and the panel's access section. Cross-module imports go
 * through this barrel; the dialog shell, the share state/mutation hook ({@link useShare}),
 * the grantee rows, and the `ShareData` payload type are internals.
 */
export { ShareDialog } from './share-dialog';
