import type { PlayerDropList } from '../../core/services/voud-drop-lists';
import { normalizeSolutionIdentifier } from './item-explorer-solution-analysis';

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

/** Keep saved answers outside the preview, returning displaced objects to their original lists. */
export function mergeResponsesOutsideSolution(
  existing: ListResponse[],
  solutions: Array<{ id: string }>,
  lists: PlayerDropList[],
): ListResponse[] {
  const examples = lists.flatMap((list) => list.readOnlyExamples || []);
  // Omitting an example response makes ASPECT display its contents from the definition.
  const resetListIds = new Set(
    [...lists, ...examples].map((list) => normalizeSolutionIdentifier(list.responseId)),
  );
  const solutionIds = new Set(
    solutions.map((response) => normalizeSolutionIdentifier(response.id)),
  );
  const retainOtherResponses = () =>
    existing.filter((response) => {
      const id = normalizeSolutionIdentifier(response?.id);
      return !resetListIds.has(id) && !solutionIds.has(id);
    });
  if (!examples.length || !existing.length) return retainOtherResponses();

  const outsideLists = new Map(
    lists.flatMap((list) =>
      (list.otherDropLists || []).map(
        (origin) => [normalizeSolutionIdentifier(origin.responseId), origin] as const,
      ),
    ),
  );
  const restoredItemIds = new Set([
    ...examples.flatMap((example) => example.movableItemIds),
    ...lists
      .filter((list) => !list.copyOnDrop)
      .flatMap((list) => list.items.map((item) => item.value)),
  ]);

  const singleItemOrigins = new Map<string, string>();
  for (const [id, origin] of outsideLists) {
    if (origin.onlyOneItem && origin.movableItemIds.length === 1) {
      singleItemOrigins.set(origin.movableItemIds[0], id);
    }
  }

  // A non-copyable object can enter the example from outside. Returning it to an
  // occupied single-item list also displaces that list's saved occupant.
  const savedById = new Map(
    existing.map((response) => [normalizeSolutionIdentifier(response?.id), response]),
  );
  const displacedItemIds = new Set<string>();
  for (const id of resetListIds) {
    const items = savedById.get(id)?.value;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      displacedItemIds.add(item);
      const singleOrigin = singleItemOrigins.get(item);
      if (singleOrigin && !resetListIds.has(singleOrigin)) {
        // Set iteration visits newly added origins, including chains of occupied lists.
        resetListIds.add(singleOrigin);
        restoredItemIds.add(item);
      }
    }
  }
  const retained = retainOtherResponses();
  for (const response of retained) {
    if (
      outsideLists.has(normalizeSolutionIdentifier(response?.id)) &&
      Array.isArray(response?.value)
    ) {
      for (const item of response.value) displacedItemIds.delete(item);
    }
  }
  return retained.map((response) => {
    const origin = outsideLists.get(normalizeSolutionIdentifier(response?.id));
    if (!origin || !Array.isArray(response?.value)) return response;
    const value = response.value.filter((item) => !restoredItemIds.has(item));
    origin.movableItemIds.forEach((item, index) => {
      if (displacedItemIds.has(item)) value.splice(index, 0, item);
    });
    return { ...response, value };
  });
}
