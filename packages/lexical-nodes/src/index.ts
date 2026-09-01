/**
 * @file The editor node vocabulary.
 *
 * A headless package: it depends on `lexical` and `@lexical/*` only, never on
 * a view library. Rendering is injected through `decoratorRegistry` and
 * `domFactoryRegistry`, which is what lets the same vocabulary run in the
 * browser, in a server worker, and under test with no DOM.
 */

// The element vocabulary and the editor's node sets.
export {
  EditorElements,
  type ElementName,
  INTERNAL_TAG_PREFIX,
} from './constants';
export {
  type EditorType,
  RegisteredNodesByType,
  SupportedNodeTypes,
} from './node-list';

// The rendering seams.
export {
  clearDecorators,
  type DecoratorComponent,
  getDecorator,
  type NodeDecoratorMap,
  setDecorator,
} from './decoratorRegistry';
export {
  clearDomFactories,
  type DomFactory,
  getDomFactory,
  setDomFactory,
} from './domFactoryRegistry';

// Durable node ids — the contract with the sync layer.
export {
  $applyIdFromSerialized,
  $getId,
  $pruneNodeIds,
  $setId,
  $updateAllNodeIds,
  createNodeIdMappings,
  idState,
  INITIALIZE_DOCUMENT_IDS,
  type NodeIdMappings,
  nodeIdPlugin,
  type NodeIdPluginOptions,
} from './plugins/nodeIdPlugin';

// Nodes.
export {
  $isDecoratorBlockNode,
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from './nodes/DecoratorBlockNode';
export {
  $createEquationNode,
  $isEquationNode,
  type EquationDecoratorProps,
  EquationNode,
  type SerializedEquationNode,
} from './nodes/EquationNode';
export {
  $createFileNode,
  $isFileNode,
  type FileDecoratorProps,
  type FileInfo,
  FileNode,
  type SerializedFileNode,
} from './nodes/FileNode';
export {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  type HorizontalRuleDecoratorProps,
  HorizontalRuleNode,
  INSERT_HORIZONTAL_RULE_COMMAND,
  type SerializedHorizontalRuleNode,
} from './nodes/HorizontalRuleNode';
export {
  $createImageNode,
  $isImageNode,
  type ImageDecoratorProps,
  type ImageInfo,
  ImageNode,
  type SerializedImageNode,
} from './nodes/ImageNode';
export {
  $isMediaNode,
  type Dimensions,
  fitDimensions,
  type MediaDecoratorProps,
  type MediaDisplay,
  type MediaInfo,
  MediaNode,
  type SerializedMediaNode,
} from './nodes/MediaNode';
export {
  $createResourceMentionNode,
  $isResourceMentionNode,
  type ResourceMentionDecoratorProps,
  type ResourceMentionDisplay,
  type ResourceMentionInfo,
  ResourceMentionNode,
  type SerializedResourceMentionNode,
} from './nodes/ResourceMentionNode';
export {
  $createUnknownEmbedNode,
  $isUnknownEmbedNode,
  type SerializedUnknownEmbedNode,
  type UnknownEmbedDecoratorProps,
  type UnknownEmbedInfo,
  UnknownEmbedNode,
} from './nodes/UnknownEmbedNode';
export {
  $createVideoNode,
  $isVideoNode,
  type SerializedVideoNode,
  type VideoDecoratorProps,
  type VideoInfo,
  VideoNode,
} from './nodes/VideoNode';

// Transformers.
export {
  ALL_TRANSFORMERS,
  EXTERNAL_TRANSFORMERS,
  INTERNAL_TRANSFORMERS,
  isConversionOnlyTransformer,
  LIST_TRANSFORMERS,
  wrapXml,
  xmlMatcher,
} from './transformers';

// The model's view of the document.
export { MissingXmlIdError, toXml } from './transformers/xml';

// Headless helpers.
export {
  markdownToState,
  type MarkdownStateResult,
  stateToMarkdown,
} from './utils';
