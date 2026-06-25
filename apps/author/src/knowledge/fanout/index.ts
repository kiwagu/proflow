export {
  createBodylessResource,
  renameResource,
  type BodylessKind,
  type CreateBodylessResourceDeps,
  type CreateBodylessResourceInput,
  type CreateBodylessResourceResult,
  type FanoutEdgeInput,
  type ParentFolderPlacement,
  type RenameResourceInput,
} from './bodyless-resource.fanout';
export {
  AUTHORABLE_RELATION_TYPES,
  createEdge,
  deleteEdge,
  tagResource,
  type AuthorableRelationType,
  type CreateEdgeInput,
  type DeleteEdgeInput,
  type TagResourceInput,
} from './resource-edge.fanout';
export {
  linkResourceScope,
  listScopeChoices,
  unlinkResourceScope,
  loadResourceFloor,
  setResourceFloor,
  type LinkResourceScopeInput,
} from './resource-scope.fanout';
export {
  grantResourceToUser,
  listGrantableMembers,
  listUserGrants,
  revokeResourceUserGrant,
  type GrantResourceToUserInput,
  type RevokeResourceUserGrantInput,
} from './resource-user-grant.fanout';
export { listResourcesSharedByMe } from './shared-by-me.fanout';
export { annotateShareMechanism } from './share-mechanism.fanout';
export {
  purgeResource,
  restoreResource,
  trashResource,
  type PurgeResourceDeps,
  type TrashResourceDeps,
} from './trash-resource.fanout';
export {
  copyResourceSubtree,
  type CopyResourceSubtreeDeps,
  type CopyResourceSubtreeInput,
  type CopyResourceSubtreeResult,
} from './copy-resource.fanout';
export {
  setResourceDescription,
  type KbAttributeDeps,
  type SetResourceDescriptionInput,
} from './kb-attribute.fanout';
export {
  setResourceStarred,
  type ResourceStarredDeps,
  type ResourceStarredState,
  type SetResourceStarredInput,
} from './resource-starred.fanout';
export {
  recordResourceOpened,
  type RecordResourceOpenedDeps,
  type RecordResourceOpenedInput,
  type RecordResourceOpenedResult,
} from './resource-opened.fanout';
export {
  createTextResource,
  ensureNodeBody,
  type CreateTextResourceDeps,
  type CreateTextResourceInput,
  type CreateTextResourceResult,
  type EnsureNodeBodyDeps,
  type EnsureNodeBodyInput,
  type TextParentFolderPlacement,
} from './text-resource.fanout';
