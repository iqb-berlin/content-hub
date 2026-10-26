/** Explicit defaults for existing ACPs. Review the visibility of each new action. */
export const EXPLORER_OPTIONAL_HEADER_ACTIONS = [
  { id: 'readonlyPreview', label: 'Leseansicht', managerOnly: true },
  { id: 'columnManager', label: 'Spalten verwalten', managerOnly: false },
  { id: 'importParameters', label: 'Itemparameter importieren', managerOnly: true },
  {
    id: 'clearEmpiricalDifficulties',
    label: 'Empirische Itemschwierigkeiten löschen',
    managerOnly: true,
  },
  { id: 'renumberReferences', label: 'Referenznummern neu vergeben', managerOnly: true },
  { id: 'history', label: 'Änderungsverlauf', managerOnly: true },
] as const;

export type ExplorerOptionalHeaderAction = (typeof EXPLORER_OPTIONAL_HEADER_ACTIONS)[number]['id'];

export interface ItemExplorerReducedView {
  enabled: boolean;
  headerActions: Record<ExplorerOptionalHeaderAction, boolean>;
  showHeader: boolean;
  showTableToolbarArea: boolean;
  showItemInfo: boolean;
  showPlayerPreview: boolean;
  showExplorerItemPanel: boolean;
}

export function normalizeReducedView(value: unknown): ItemExplorerReducedView {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const actions =
    source['headerActions'] &&
    typeof source['headerActions'] === 'object' &&
    !Array.isArray(source['headerActions'])
      ? (source['headerActions'] as Record<string, unknown>)
      : {};
  return {
    enabled: source['enabled'] === true,
    headerActions: Object.fromEntries(
      EXPLORER_OPTIONAL_HEADER_ACTIONS.map(({ id }) => [id, actions[id] !== false]),
    ) as Record<ExplorerOptionalHeaderAction, boolean>,
    showHeader: source['showHeader'] !== false,
    showTableToolbarArea: source['showTableToolbarArea'] !== false,
    showItemInfo: source['showItemInfo'] !== false,
    showPlayerPreview: source['showPlayerPreview'] !== false,
    showExplorerItemPanel: source['showExplorerItemPanel'] !== false,
  };
}
