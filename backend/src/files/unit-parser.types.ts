import type { AsyncCacheStatus } from "./async-lru-cache";

export interface UnitXmlData {
  unitId: string;
  unitLabel: string;
  description?: string;
  definitionRef: string;
  playerRef: string;
  codingSchemeRef?: string;
  metadataRef?: string;
  commentsRef?: string;
}

export interface StudioItemComment {
  id: number;
  body: string;
  userName?: string;
  createdAt?: string;
  parentId?: number;
  hidden: boolean;
}

export interface UnitValidationResult {
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

export interface MetadataColumn {
  id: string;
  label: string;
}

export interface VomdItemData {
  itemId: string;
  uuid: string;
  rowKey: string;
  subId?: string;
  subIdDisplay?: string;
  unitId: string;
  partId?: string;
  unitLabel: string;
  description: string;
  variableId: string;
  sourceVariable?: string;
  variableReadOnlyId?: string;
  useUnitAliasAsPrefix?: boolean;
  metadata: Record<string, string>;
  studioComments?: StudioItemComment[];
  empiricalDifficulty?: number;
  bista?: number;
  meanTaskDifficulty?: number;
  infit?: number;
  discrimination?: number;
  solutionRate?: number;
  textComplexity?: string;
  competenceLevel?: string;
  itemTimeSeconds?: number;
  stimulusTimeSeconds?: number;
  bookletOccurrences: Array<{ booklet: string; position: number | null }>;
  tags?: string[];
  rowNumber: number;
}

export interface ItemListResult {
  columns: MetadataColumn[];
  items: VomdItemData[];
  subIdLabel: string;
  subIdLabels: Record<string, string>;
  unitMetadata: Record<string, any[]>;
  codingSchemes: Record<string, any>;
  variableIdentityConsistency: {
    checkedItemCount: number;
    collisionCount: number;
    collisions: Array<{
      unitId: string;
      itemId: string;
      variableId: string;
      variableReadOnlyId: string;
      resolvedVariableId: string;
      legacyResolvedVariableId: string;
    }>;
  };
}

export type ItemExplorerCacheStatus = AsyncCacheStatus;

export interface ItemExplorerLoadDiagnostics {
  cacheStatus: ItemExplorerCacheStatus;
  rowCacheStatus: ItemExplorerCacheStatus;
  sourceReadMs: number;
  fileSignatureMs: number;
  explorerStateMs?: number;
  rowNumberRevisionMs: number;
  parseMs: number;
  rowNumberingMs: number;
  totalMs: number;
}
