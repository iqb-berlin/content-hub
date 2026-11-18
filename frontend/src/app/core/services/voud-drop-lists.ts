export interface PlayerDropList {
  id: string;
  responseId: string;
  connectedTo: string[];
  onlyOneItem: boolean;
  copyOnDrop: boolean;
  items: Array<{ value: string; label: string }>;
  readOnlyExamples?: Array<{ responseId: string; movableItemIds: string[] }>;
  otherDropListResponseIds?: string[];
}

interface DropListNode {
  id?: unknown;
  alias?: unknown;
  type?: unknown;
  value?: unknown;
  connectedTo?: unknown;
  onlyOneItem?: unknown;
  copyOnDrop?: unknown;
  isSortList?: unknown;
  readOnly?: unknown;
}

interface DropListItem {
  id?: unknown;
  alias?: unknown;
  text?: unknown;
}

/** ASPECT 2.6 switched both response and drag object identifiers to aliases. */
export function usesLegacyAspectDropListIds(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const { id, version } = metadata as { id?: unknown; version?: unknown };
  return (
    id === 'iqb-player-aspect' &&
    typeof version === 'string' &&
    /^2\.[0-5]\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(version)
  );
}

export function resolveDropListTarget(
  pages: unknown,
  target: DropListNode,
  displayText: (value: unknown) => string,
  {
    useLegacyIds = false,
    definitionVersion,
  }: { useLegacyIds?: boolean; definitionVersion?: unknown } = {},
): { valueOptions: PlayerDropList['items']; dropLists: PlayerDropList[] } | undefined {
  if (target.readOnly === true) return undefined;

  const nodes: DropListNode[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node['type'] === 'drop-list') nodes.push(node);
    Object.entries(node).forEach(([key, child]) => {
      if (key !== 'visibilityRules') visit(child);
    });
  };
  visit(pages);

  const isIdentifier = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.trim() === value;
  const listResponseId = (node: DropListNode) => (useLegacyIds ? node.id : node.alias || node.id);
  const itemIdentifier = useLegacyIds ? 'id' : 'alias';
  if (nodes.some((node) => !isIdentifier(node.id) || !isIdentifier(listResponseId(node)))) {
    return undefined;
  }
  const ids = nodes.map((node) => String(node.id));
  const responseIds = nodes.map((node) => String(listResponseId(node)).toLowerCase());
  if (new Set(ids).size !== ids.length || new Set(responseIds).size !== responseIds.length) {
    return undefined;
  }
  const tokens = nodes.flatMap((node) =>
    Array.isArray(node.value)
      ? node.value.map((item: DropListItem | null) => item?.[itemIdentifier])
      : [],
  );
  if (tokens.some((token) => !isIdentifier(token)) || new Set(tokens).size !== tokens.length) {
    return undefined;
  }

  // Read-only examples use the definition's values and stay outside the assignment graph.
  const readOnlyNodes = nodes.filter((node) => node.readOnly === true);
  const readOnlyIds = new Set(readOnlyNodes.map((node) => String(node.id)));
  const interactiveNodes = nodes.filter((node) => node.readOnly !== true);
  const connections = (node: DropListNode): string[] =>
    Array.isArray(node.connectedTo) ? node.connectedTo.map(String) : [];
  const connectedListIds = (node: DropListNode): string[] =>
    connections(node).filter((id) => !readOnlyIds.has(id));

  const component = new Set([String(target.id || '').trim()]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of interactiveNodes) {
      const connected = connectedListIds(node);
      if (component.has(String(node.id)) || connected.some((id) => component.has(id))) {
        for (const id of [String(node.id), ...connected]) {
          if (!component.has(id)) {
            component.add(id);
            changed = true;
          }
        }
      }
    }
  }
  if ([...component].some((id) => !ids.includes(id))) return undefined;

  const group = interactiveNodes.filter((node) => component.has(String(node.id)));
  // Initially empty single-item targets and token palettes have a safe, reversible state.
  // Before VOUD 4.4, an unconnected list with multiple objects implied sorting.
  const usesImplicitSorting =
    useLegacyIds &&
    typeof definitionVersion === 'string' &&
    /^4\.[0-3]\.\d+$/.test(definitionVersion);
  if (
    group.some(
      (node) =>
        typeof node.onlyOneItem !== 'boolean' ||
        typeof node.copyOnDrop !== 'boolean' ||
        !Array.isArray(node.value) ||
        !Array.isArray(node.connectedTo) ||
        (node.isSortList !== false &&
          !(
            usesImplicitSorting &&
            node.isSortList === undefined &&
            (node.connectedTo.length > 0 || node.value.length <= 1)
          )) ||
        (node.onlyOneItem ? node.value.length !== 0 || node.copyOnDrop : !node.value.length),
    ) ||
    target.onlyOneItem !== true
  ) {
    return undefined;
  }
  const otherDropListResponseIds = nodes
    .filter((node) => !component.has(String(node.id)))
    .map((node) => String(listResponseId(node)));
  const dropLists: PlayerDropList[] = group.map((node) => {
    const id = String(node.id);
    const outgoingConnections = connections(node);
    const readOnlyExamples = readOnlyNodes
      .filter(
        (example) =>
          outgoingConnections.includes(String(example.id)) || connections(example).includes(id),
      )
      .map((example) => ({
        responseId: String(listResponseId(example)),
        movableItemIds:
          example.copyOnDrop !== true && Array.isArray(example.value)
            ? (example.value as DropListItem[]).map((item) => String(item[itemIdentifier]))
            : [],
      }));
    return {
      id,
      responseId: String(listResponseId(node)),
      connectedTo: connectedListIds(node),
      onlyOneItem: node.onlyOneItem as boolean,
      copyOnDrop: node.copyOnDrop as boolean,
      items: (node.value as DropListItem[]).map((item) => {
        const value = String(item[itemIdentifier]);
        return { value, label: displayText(item.text) || value };
      }),
      ...(readOnlyExamples.length ? { readOnlyExamples, otherDropListResponseIds } : {}),
    };
  });
  const valueOptions = dropLists
    .filter((list) => !list.onlyOneItem && list.connectedTo.includes(String(target.id)))
    .flatMap((list) => list.items);
  return valueOptions.length ? { valueOptions, dropLists } : undefined;
}
