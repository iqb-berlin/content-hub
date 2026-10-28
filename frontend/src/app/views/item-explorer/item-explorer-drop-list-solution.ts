import type { PlayerDropList } from '../../core/services/voud-drop-lists';

interface ListResponse {
  id?: unknown;
  value?: unknown;
  [key: string]: unknown;
}

const sameId = (left: unknown, right: string): boolean =>
  String(left || '').toLowerCase() === right.toLowerCase();

export function validateDropListAssignments(
  lists: PlayerDropList[],
  responses: Array<{ id: string; value: unknown }>,
): boolean {
  const allocated = new Set<string>();
  return responses.every((response) => {
    const target = lists.find((list) => sameId(response.id, list.responseId));
    if (!target?.onlyOneItem || !Array.isArray(response.value) || response.value.length !== 1) {
      return false;
    }
    const token = response.value[0];
    const origin = lists.find((list) => list.items.some((item) => item.value === token));
    if (!origin?.connectedTo.includes(target.id)) return false;
    if (!origin.copyOnDrop && allocated.has(token)) return false;
    if (!origin.copyOnDrop) allocated.add(token);
    return true;
  });
}

/** Build one consistent preview group while keeping unrelated responses and saved data intact. */
export function mergeDropListSolutionResponses(
  existing: ListResponse[],
  solutions: Array<{ id: string; value: unknown }>,
  lists: PlayerDropList[],
): ListResponse[] {
  if (!lists.length) return [];
  const placements = new Map<string, string[]>();
  const allocated = new Set<string>();
  const originOf = (token: string) =>
    lists.find((list) => list.items.some((item) => item.value === token));
  const retain = (list: PlayerDropList, value: unknown): void => {
    const tokens = Array.isArray(value) ? value : [];
    const token = tokens.length === 1 && typeof tokens[0] === 'string' ? tokens[0] : undefined;
    const origin = token ? originOf(token) : undefined;
    if (
      token &&
      origin?.connectedTo.includes(list.id) &&
      (origin.copyOnDrop || !allocated.has(token))
    ) {
      placements.set(list.responseId, [token]);
      if (!origin.copyOnDrop) allocated.add(token);
    } else {
      placements.set(list.responseId, []);
    }
  };

  // Reserve the solution first: a movable object cannot remain in a different target.
  for (const response of solutions) {
    const list = lists.find((candidate) => sameId(response.id, candidate.responseId));
    if (list?.onlyOneItem) retain(list, response.value);
  }
  for (const list of lists.filter((candidate) => candidate.onlyOneItem)) {
    if (placements.has(list.responseId)) continue;
    retain(list, existing.find((response) => sameId(response.id, list.responseId))?.value);
  }
  return lists.map((list) => ({
    id: list.responseId,
    status: 'VALUE_CHANGED',
    value: list.onlyOneItem
      ? placements.get(list.responseId) || []
      : list.items
          .filter((item) => list.copyOnDrop || !allocated.has(item.value))
          .map((item) => item.value),
  }));
}
