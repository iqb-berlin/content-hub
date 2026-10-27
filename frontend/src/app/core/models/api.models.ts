export interface User {
  id: string;
  username: string;
  displayName?: string;
  isAppAdmin: boolean;
  oidcSub?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateUserRequest {
  username: string;
  displayName?: string;
  isAppAdmin?: boolean;
}

export interface UpdateUserRequest {
  displayName?: string;
}

export interface LoginResponse {
  accessToken: string;
  user: User;
}

export type ServerApiScope =
  | 'acp.read'
  | 'transfer.read'
  | 'transfer.write'
  | 'index.read'
  | 'index.write'
  | 'files.read'
  | 'files.write'
  | 'audit.read';

export interface ApplicationToken {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: ServerApiScope[];
  allowedAcpIds: string[] | null;
  active: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdByUserId: string | null;
  revokedByUserId: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationTokenListResponse {
  items: ApplicationToken[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateApplicationTokenRequest {
  name: string;
  scopes: ServerApiScope[];
  expiresAt?: string | null;
  allowedAcpIds?: string[] | null;
}

export interface CreatedApplicationToken extends ApplicationToken {
  token: string;
}

export interface CredentialLoginResponse {
  accessToken: string;
  acpId: string;
  username: string;
}

export type AcpRoleName = 'ACP_MANAGER' | 'READ_ONLY';

export interface AcpRole {
  acpId: string;
  acpName?: string;
  role: AcpRoleName;
}

export interface UserProfile extends User {
  acpRoles: AcpRole[];
}

export interface CreateAcpRequest {
  packageId: string;
  name: string;
  description?: string;
}

export interface UpdateAcpRequest {
  name?: string;
  description?: string;
}

export interface AssignAcpRoleRequest {
  capabilities?: string[];
  userId: string;
  role: AcpRoleName;
}

export interface AssignableAcpUser {
  id: string;
  username: string;
  displayName?: string | null;
}

export interface AcpRoleAssignment {
  capabilities?: string[];
  id: string;
  acpId: string;
  userId: string;
  role: AcpRoleName;
  // Included by the list endpoint; assignment writes return the role alone.
  user?: AssignableAcpUser;
}

export interface Acp {
  id: string;
  packageId: string;
  name: string;
  description?: string | null;
  acpIndex: Record<string, unknown>;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AcpFile {
  id: string;
  acpId: string;
  filePath: string;
  originalName: string;
  fileType?: string;
  fileSize: number;
  checksum?: string;
  validationResult?: ValidationResult;
  uploadedAt: string;
}

export interface IndexSyncReport {
  unitsAdded: number;
  unitsUpdated: number;
  itemsAdded: number;
  itemsUpdated: number;
  warnings: string[];
}

export type FileUploadConflictStrategy = 'reject' | 'overwrite' | 'keep-both';

export interface FileUploadResponse {
  files: AcpFile[];
}

export type FileProcessingJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export type FileProcessingJobType = 'upload-process' | 'archive-download';

export type FileProcessingJobPhase =
  | 'queued'
  | 'sync-index'
  | 'zip-files'
  | 'validate-files'
  | 'validate-semantic'
  | 'cleanup-overwrite'
  | 'completed'
  | 'failed';

export interface FileProcessingCleanupReport {
  unitsUpdated: number;
  dependenciesRemoved: number;
  bookletsUpdated: number;
  bookletDefinitionsRemoved: number;
  indexUpdated: boolean;
}

export interface FileProcessingResponseStateCleanup {
  totalStates: number;
  deletedStates: number;
  keptStates: number;
}

export interface FileDeletionResponse {
  message: string;
  deletedCount?: number;
  deletedFileIds?: string[];
  cleanupReport?: FileProcessingCleanupReport | null;
  responseStateCleanup?: FileProcessingResponseStateCleanup | null;
  validationSummary?: UploadValidationSummary | null;
}

export interface FileProcessingJob {
  id: string;
  acpId: string;
  jobType: FileProcessingJobType;
  status: FileProcessingJobStatus;
  phase: FileProcessingJobPhase;
  phaseLabel: string;
  message: string | null;
  phaseCurrent: number;
  phaseTotal: number;
  uploadedFileCount: number;
  archiveFileName?: string | null;
  syncReport?: IndexSyncReport | null;
  validationSummary?: UploadValidationSummary | null;
  cleanupReport?: FileProcessingCleanupReport | null;
  responseStateCleanup?: FileProcessingResponseStateCleanup | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface UploadValidationSummary {
  totalFiles: number;
  validFiles: number;
  invalidFiles: number;
  semanticValid: boolean;
  semanticIssueCount: number;
  timestamp: string;
}

export interface UnitFileValidationResult {
  unitId: string;
  unitLabel: string;
  valid: boolean;
  files: {
    xml: { expected: string; found: boolean };
    definition: { expected: string; found: boolean };
    codingScheme: { expected: string; found: boolean };
    metadata: { expected: string; found: boolean };
    player: { expected: string; found: boolean; resolvedName?: string };
  };
}

export interface ValidateUnitsResponse {
  unitResults: UnitFileValidationResult[];
  validationSummary: UploadValidationSummary;
}

export interface ReviewReadiness {
  stale?: boolean;
  status: 'READY' | 'WARNING' | 'BLOCKED';
  checkedAt: string;
  blockers: string[];
  warnings: string[];
  summary: {
    totalFiles: number;
    validFiles: number;
    invalidFiles: number;
    bookletCount: number;
    unitCount: number;
  };
}

export type FilePreviewMode =
  | 'text'
  | 'image'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'structured'
  | 'binary';

export type FilePreviewTextFormat = 'text' | 'json' | 'xml' | 'csv' | 'html' | 'markdown';

export interface FilePreviewUnitXmlData {
  type: 'unit-xml';
  unitId: string;
  unitLabel: string;
  description?: string;
  references: {
    definition?: string;
    player?: string;
    codingScheme?: string;
    metadata?: string;
  };
}

export interface FilePreviewVomdData {
  type: 'vomd';
  itemCount: number;
  unitProfileCount: number;
  metadataColumns: { id: string; label: string }[];
  unitProfiles: { id: string; label: string; value: string }[];
  items: {
    id: string;
    description: string;
    variableId?: string;
    sourceVariable?: string;
    variableReadOnlyId?: string;
    metadata: Record<string, string>;
  }[];
}

export interface FilePreviewVocsData {
  type: 'vocs';
  variableCount: number;
  codeCount: number;
  variables: {
    id: string;
    label: string;
    manualInstruction?: string;
    codeCount: number;
    codes: {
      id: string;
      label: string;
      score: string;
      manualInstruction?: string;
    }[];
  }[];
}

export interface FilePreviewVoudData {
  type: 'voud';
  pageCount: number;
  variableRefCount: number;
  topLevelKeys: string[];
  identifierPreview: string[];
  pages: {
    pageNumber: number;
    variableRefs: string[];
    alwaysVisible: string[];
  }[];
}

export interface FilePreviewCsvData {
  type: 'csv';
  delimiter: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
  rows: string[][];
}

export type FileStructuredPreviewData =
  | FilePreviewUnitXmlData
  | FilePreviewVomdData
  | FilePreviewVocsData
  | FilePreviewVoudData
  | FilePreviewCsvData;

export interface FilePreviewResponse {
  fileId: string;
  originalName: string;
  mimeType: string | null;
  extension: string;
  mode: FilePreviewMode;
  textFormat?: FilePreviewTextFormat;
  textContent?: string;
  truncated: boolean;
  lineCount?: number;
  characterCount?: number;
  structuredData?: FileStructuredPreviewData | null;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  timestamp: string;
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  field?: string;
  path?: string;
}

export interface AcpSnapshot {
  id: string;
  acpId: string;
  versionNumber: number;
  acpIndexSnapshot: Record<string, any>;
  changelog?: string;
  createdAt: string;
}

export interface SnapshotCurrentDiff {
  snapshotId: string;
  comparedWith: 'current';
  indexChanged: boolean;
  added: string[];
  removed: string[];
  modified: string[];
  unchanged: number;
}

export type AccessModel = 'PRIVATE' | 'PUBLIC' | 'REGISTERED' | 'CREDENTIALS_LIST';

export interface AccessConfig {
  id: string;
  acpId: string;
  accessModel: AccessModel;
  allowRegistered?: boolean;
  featureConfig: FeatureConfig;
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface UpdateAccessConfigRequest {
  accessModel: AccessModel;
  allowRegistered?: boolean;
  featureConfig?: FeatureConfig;
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface UpdateMetadataColumnsRequest {
  visibleColumns: string[];
  columnOrder?: string[];
}

export type CredentialUploadMode = 'replace' | 'append' | 'upsert';

export interface CredentialEntry {
  username: string;
  password: string;
}

export interface CredentialUploadResponse {
  message: string;
  added: number;
  updated: number;
  skipped: number;
  duplicates: string[];
}

export interface CredentialDeletionResponse {
  message: string;
}

export interface Credential {
  capabilities?: string[];
  id: string;
  username: string;
}

export interface MetadataColumnsConfig {
  restrictReviewerColumnsToManagerSelection?: boolean;
  visible?: string[];
  order?: string[];
  configured?: boolean;
  referenceNumberVisible?: boolean;
  definitions?: Array<{ id: string; label: string }>;
  widths?: Record<string, number>;
  layout?: ItemExplorerTableColumnLayout;
}

export interface ItemExplorerTableColumnLayout {
  visible?: string[];
  order?: string[];
  configured?: boolean;
  widths?: Record<string, number>;
}

export interface FeatureConfig {
  itemExplorerReducedView?: import('./item-explorer-reduced-view').ItemExplorerReducedView;
  showStudioItemComments?: boolean;
  // Preserve extension keys while requiring callers to narrow unknown values.
  [key: string]: unknown;
  allowIndexDownload?: boolean;
  allowUnitDownload?: boolean;
  allowFileDownload?: boolean;
  enableUnitView?: boolean;
  showMetadata?: boolean;
  hideReviewDeveloperNames?: boolean;
  showRichText?: boolean;
  showCodingScheme?: boolean;
  enableUnitListNavigation?: boolean;
  enableSequenceNavigation?: boolean;
  showItemExplorerOnStartPage?: boolean;
  showUnitListOnStartPage?: boolean;
  showSequencesOnStartPage?: boolean;
  showIndexOnStartPage?: boolean;
  enableCommenting?: boolean;
  commentTargets?: string[];
  commentVisibilityMode?: 'PRIVATE' | 'SHARED' | 'GROUP';
  enableItemList?: boolean;
  metadataColumns?: MetadataColumnsConfig;
  // Legacy key (read-only compatibility)
  itemListMetadataColumns?: string[];
  enableItemClick?: boolean;
  enableItemListFilter?: boolean;
  enableItemListSort?: boolean;
  enableItemListTags?: boolean;
  showOnlyItemsWithEmpiricalDifficulty?: boolean;
  showAudioVideoCodingVariables?: boolean;
  showGeneralCodingInstructions?: boolean;
  preferManualCodingInstructions?: boolean;
  enableItemExplorerConditionalVisibility?: boolean;
  enablePlayerFocusHighlight?: boolean;
  showItemExplorerPlayerTargetInfo?: boolean;
  itemSubIdLabel?: string;
  itemSubIdLabels?: Record<string, string>;
  enablePersonalItemData?: boolean;
  enableItemCollections?: boolean;
  personalItemCategoryLabel?: string;
  personalItemCategoryValues?: string[];
  personalItemTagLabel?: string;
  personalItemTags?: Array<{ label: string; color: string }>;
  availableTags?: string[];
  persistUserPreferences?: boolean;
}

export type CommentTargetType = 'BOOKLET' | 'UNIT' | 'ITEM' | 'CODING' | 'TASK_SEQUENCE';

export interface StudioItemComment {
  id: number;
  body: string;
  userName?: string;
  createdAt?: string;
  parentId?: number;
  hidden: boolean;
}

export interface ReviewCommentTarget {
  targetType: Exclude<CommentTargetType, 'TASK_SEQUENCE'>;
  bookletId?: string;
  unitId?: string;
  itemId?: string;
}

export interface CommentCategory {
  id: string;
  name: string;
  archived: boolean;
}

export interface Comment {
  id: string;
  acpId: string;
  userId?: string;
  credentialUsername?: string;
  credentialId?: string;
  targetType: CommentTargetType;
  targetId: string;
  bookletId?: string | null;
  unitId?: string | null;
  itemId?: string | null;
  parentCommentId?: string | null;
  parentVisible?: boolean;
  groupId?: string | null;
  groupName?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  commentText: string;
  authorLabel?: string;
  createdAt: string;
  updatedAt?: string;
  version?: number;
  isOwn?: boolean;
  isDeleted?: boolean;
  legacyReadOnly?: boolean;
  upvotes?: number;
  downvotes?: number;
  myVote?: 'UP' | 'DOWN' | null;
  canVote?: boolean;
}

export interface CommentThreadSnapshot {
  target: ReviewCommentTarget;
  revision: string;
  visibilityMode: 'PRIVATE' | 'SHARED' | 'GROUP';
  defaultGroupId?: string | null;
  groups?: { id: string; name: string; archived: boolean }[];
  categories?: CommentCategory[];
  comments: Comment[];
}

export interface ItemCommentCountsSnapshot {
  revision: string;
  counts: Array<{ unitId: string; itemId: string; count: number; codingCount: number }>;
}

export interface AppSettings {
  id: string;
  theme: Record<string, any>;
  language: string;
  logoUrl?: string;
  landingPageHtml?: string;
  imprintHtml?: string;
  privacyHtml?: string;
  accessibilityHtml?: string;
  defaultAcpIndex: Record<string, any>;
  geoGebraBundle?: GeoGebraBundleSettings | null;
}

export interface GeoGebraBundleSettings {
  sourceFileName: string;
  deployScriptUrl: string;
  publicBasePath: string;
  checksum: string;
  entryCount: number;
  uploadedAt: string;
}

export interface PublicAcp {
  id: string;
  name: string;
  description?: string;
  accessModel: AccessModel | 'ADMIN';
  requiresLogin?: boolean;
}

export interface UnitViewData {
  id: string;
  name: string;
  description?: string;
  lang?: string;
  items: any[];
  dependencies: FileDependency[];
  codingScheme?: unknown;
  richText?: string;
}

export interface FileDependency {
  type: string;
  fileId: string;
  originalName: string;
  downloadUrl: string;
}

export interface ItemViewPreferences {
  ui?: Record<string, unknown>;
  tags?: Record<string, string[]>;
  rowData?: Record<string, Record<string, unknown>>;
}

export interface SimpleItemListEntry {
  itemId: string;
  unitId: string;
  unitName: string;
  name?: string;
  sourceVariable?: string;
  variableId?: string;
  variableReadOnlyId?: string;
  meanTaskDifficulty?: number;
}

export type ItemExplorerPerspective = 'editor' | 'read-only';

export interface ItemCollectionSummary {
  rowCount: number;
  itemCount: number;
  unitCount: number;
  itemTimeSeconds: number;
  stimulusTimeSeconds: number;
  testTimeSeconds: number;
  missingItemTimeCount: number;
  missingStimulusTimeUnitCount: number;
  complete: boolean;
}

export interface ItemCollection {
  id: string;
  name: string;
  rowKeys: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  unavailableRowKeys: string[];
  summary: ItemCollectionSummary;
  shared: boolean;
  ownedByCurrentUser: boolean;
  ownerLabel: string;
}

export interface ItemCollectionsPayload {
  activeCollectionId: string | null;
  collectionViewMode: 'all' | 'active';
  collections: ItemCollection[];
  sharedCollectionsTruncated: boolean;
}

export type ItemCollectionRowsMutation =
  | { baseVersion: number; addRowKeys: string[]; perspective: ItemExplorerPerspective }
  | { baseVersion: number; removeRowKeys: string[]; perspective: ItemExplorerPerspective }
  | { baseVersion: number; clear: true; perspective: ItemExplorerPerspective };

export interface ItemCollectionRowsMutationResult {
  collectionId: string;
  version: number;
  updatedAt: string;
  summary: ItemCollectionSummary;
}

export interface ItemExplorerMetadataColumns {
  restrictReviewerColumnsToManagerSelection?: boolean;
  visible?: string[];
  order?: string[];
  configured?: boolean;
  referenceNumberVisible?: boolean;
  widths?: Record<string, number>;
  layout?: ItemExplorerTableColumnLayout;
}

export interface ItemExplorerSharedState {
  ui?: Record<string, unknown>;
  tags?: Record<string, string[]>;
  metadataColumns?: ItemExplorerMetadataColumns;
  itemOrder?: string[];
  itemProperties?: Record<string, Record<string, unknown>>;
}

export interface ItemExplorerStateEnvelope {
  status: 'CLEAN' | 'DIRTY';
  version: number;
  publishedVersion: number;
  canEdit: boolean;
  canPublish: boolean;
  updatedAt: string;
  updatedByUsername?: string | null;
  updatedByRole?: string | null;
  activeState: ItemExplorerSharedState;
  publishedState: ItemExplorerSharedState;
  draftState: ItemExplorerSharedState;
}

export interface ItemExplorerChangeLogEntry {
  id: string;
  acpId: string;
  changeType: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  diff: Record<string, unknown>;
  draftVersion?: number | null;
  publishedVersion?: number | null;
  actorUserId?: string | null;
  actorUsername?: string | null;
  actorRole?: string | null;
  createdAt: string;
}

export interface TaskSequence {
  id: string;
  name: any;
  units: {
    id: string;
    name: string;
    occurrenceId?: string;
    linkId?: string;
    alias?: string;
    blockPath?: string[];
  }[];
}

export interface OidcConfig {
  enabled: boolean;
  issuerUrl: string | null;
  clientId: string | null;
  redirectUri: string;
  scope: string;
}

export interface BuildVersion {
  version: string;
  commit: string;
  builtAt: string;
}
