export interface PlayerDropList {
  id: string;
  responseId: string;
  connectedTo: string[];
  onlyOneItem: boolean;
  copyOnDrop: boolean;
  items: Array<{ value: string; label: string }>;
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

/** Aspect restores drag objects by their globally unique alias, not by their element id. */
export function resolveDropListTarget(
  pages: unknown,
  target: DropListNode,
  displayText: (value: unknown) => string,
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
  if (nodes.some((node) => !isIdentifier(node.id) || !isIdentifier(node.alias || node.id))) {
    return undefined;
  }
  const ids = nodes.map((node) => String(node.id || '').trim());
  const responseIds = nodes.map((node) => String(node.alias || node.id || '').trim());
  if (
    ids.some((id) => !id) ||
    new Set(ids).size !== ids.length ||
    new Set(responseIds.map((id) => id.toLowerCase())).size !== responseIds.length
  ) {
    return undefined;
  }
  const tokens = nodes.flatMap((node) =>
    Array.isArray(node.value) ? node.value.map((item) => item?.alias) : [],
  );
  if (tokens.some((token) => !isIdentifier(token)) || new Set(tokens).size !== tokens.length) {
    return undefined;
  }

  // Connected read-only examples stay in the definition and never participate in assignments.
  const readOnlyIds = new Set(
    nodes.filter((node) => node.readOnly === true).map((node) => String(node.id)),
  );
  const interactiveNodes = nodes.filter((node) => node.readOnly !== true);
  const connectedListIds = (node: DropListNode): string[] =>
    Array.isArray(node.connectedTo)
      ? node.connectedTo.map(String).filter((id) => !readOnlyIds.has(id))
      : [];

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
  // Sorting and multi-item answers need explicit ordered-answer derivation and stay as rules.
  if (
    group.some(
      (node) =>
        node.isSortList !== false ||
        typeof node.onlyOneItem !== 'boolean' ||
        typeof node.copyOnDrop !== 'boolean' ||
        !Array.isArray(node.value) ||
        !Array.isArray(node.connectedTo) ||
        (node.onlyOneItem ? node.value.length !== 0 || node.copyOnDrop : !node.value.length),
    ) ||
    target.onlyOneItem !== true
  ) {
    return undefined;
  }
  const dropLists: PlayerDropList[] = group.map((node) => ({
    id: String(node.id),
    responseId: String(node.alias || node.id),
    connectedTo: connectedListIds(node),
    onlyOneItem: node.onlyOneItem as boolean,
    copyOnDrop: node.copyOnDrop as boolean,
    items: (node.value as Array<{ alias: string; text?: unknown }>).map((item) => ({
      value: item.alias,
      label: displayText(item.text) || item.alias,
    })),
  }));
  const valueOptions = dropLists
    .filter((list) => !list.onlyOneItem && list.connectedTo.includes(String(target.id)))
    .flatMap((list) => list.items);
  return valueOptions.length ? { valueOptions, dropLists } : undefined;
}
