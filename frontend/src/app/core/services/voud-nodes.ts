/** Traverse VOUD objects, including Likert rows and embedded cloze models.
 * Visibility-rule references are not player targets.
 */
export function collectVoudNodes(root: unknown): Record<string, unknown>[] {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(collectVoudNodes);
  return [
    root as Record<string, unknown>,
    ...Object.entries(root)
      .filter(([key]) => key !== 'visibilityRules')
      .flatMap(([, value]) => collectVoudNodes(value)),
  ];
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
