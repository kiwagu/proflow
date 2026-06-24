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
  deleteResourceCascade,
  type DeleteResourceInput,
} from './delete-resource.fanout';
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
