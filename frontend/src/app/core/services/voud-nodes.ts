/** Traverse VOUD objects, including Likert rows and embedded cloze models.
 * Visibility-rule references are not player targets.
 */
export interface VoudNodeEntry {
  node: Record<string, unknown>;
  parent?: Record<string, unknown>;
}

export function collectVoudNodeEntries(
  root: unknown,
  parent?: Record<string, unknown>,
): VoudNodeEntry[] {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap((value) => collectVoudNodeEntries(value, parent));
  const node = root as Record<string, unknown>;
  return [
    { node, parent },
    ...Object.entries(node)
      .filter(([key]) => key !== 'visibilityRules')
      .flatMap(([, value]) => collectVoudNodeEntries(value, node)),
  ];
}

export function collectVoudNodes(root: unknown): Record<string, unknown>[] {
  return collectVoudNodeEntries(root).map(({ node }) => node);
}

export function findVoudIdentifierMatches<T extends { node: { id?: unknown; alias?: unknown } }>(
  entries: T[],
  target: string,
): T[] {
  const normalized = target.trim().toLowerCase();
  if (!normalized) return [];
  const matches = (key: 'id' | 'alias') =>
    entries.filter(
      (entry) =>
        String(entry.node[key] || '')
          .trim()
          .toLowerCase() === normalized,
    );
  const aliases = matches('alias');
  return aliases.length ? aliases : matches('id');
}
