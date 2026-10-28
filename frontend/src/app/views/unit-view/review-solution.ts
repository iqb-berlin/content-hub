import { CodingSchemeFactory } from '@iqb/responses';
import type { VariableCodingData } from '@iqbspecs/coding-scheme';
import type { PlayerDropList } from '../../core/services/voud-drop-lists';
import { validateDropListAssignments } from '../item-explorer/item-explorer-drop-list-solution';
import {
  CodingVariableLike,
  derivePlayerSolutionPrefill,
  PlayerResponseTargetResolver,
  PlayerSolutionPrefill,
  PlayerSolutionResponse,
} from '../item-explorer/item-explorer-solution-prefill';

export interface ReviewSolution {
  prefill: PlayerSolutionPrefill;
  unavailableVariables: string[];
}

function sameResponseValue(
  left: PlayerSolutionResponse['value'],
  right: PlayerSolutionResponse['value'],
): boolean {
  return Array.isArray(left) && Array.isArray(right)
    ? left.length === right.length && left.every((value, index) => value === right[index])
    : Object.is(left, right);
}

/** Combine the Explorer's validated solutions without guessing missing answers. */
export function deriveReviewSolution(
  variables: CodingVariableLike[],
  relevantVariables: CodingVariableLike[],
  resolveTarget: PlayerResponseTargetResolver,
): ReviewSolution {
  const unavailableVariables: string[] = [];
  const availableVariables: CodingVariableLike[] = [];
  const responses = new Map<string, PlayerSolutionResponse>();
  const dropListsById = new Map<string, PlayerDropList>();
  const unavailable = (message: string): ReviewSolution => ({
    prefill: { status: 'unavailable', responses: [], message },
    unavailableVariables,
  });

  for (const variable of relevantVariables) {
    const solution = derivePlayerSolutionPrefill(variable, variables, resolveTarget);
    if (solution.status === 'unavailable') {
      unavailableVariables.push(String(variable.alias || variable.id));
      continue;
    }
    availableVariables.push(variable);
    for (const list of solution.dropLists || []) dropListsById.set(list.id, list);
    for (const response of solution.responses) {
      const key = response.id.toLowerCase();
      const existing = responses.get(key);
      if (existing && !sameResponseValue(existing.value, response.value)) {
        return unavailable(
          'Die Lösungsregeln widersprechen sich. Bitte die Kodieranweisungen im Reviewbereich verwenden.',
        );
      }
      responses.set(key, response);
    }
  }
  if (!responses.size) {
    return unavailable(
      'Keine eindeutige Musterlösung für den Player verfügbar. Vorhandene Kodieranweisungen und Lösungsregeln stehen im Reiter „Kodierung“.',
    );
  }

  const dropLists = [...dropListsById.values()];
  const dropResponseIds = new Set(dropLists.map((list) => list.responseId.toLowerCase()));
  if (
    dropLists.length &&
    !validateDropListAssignments(
      dropLists,
      [...responses.values()].filter((response) => dropResponseIds.has(response.id.toLowerCase())),
    )
  ) {
    return unavailable(
      'Die Drag-and-drop-Lösungen enthalten widersprüchliche Objektbelegungen. Bitte die Kodieranweisungen im Reviewbereich verwenden.',
    );
  }

  // Answers for separate variables can affect a derived result. Validate the combined state too.
  try {
    const coded = CodingSchemeFactory.code(
      [...responses.values()],
      variables as VariableCodingData[],
    );
    if (
      availableVariables.some((variable) => {
        const result = coded.find(
          (response) => response.id === String(variable.alias || variable.id),
        );
        return (
          result?.status !== 'CODING_COMPLETE' ||
          !variable.codes?.some(
            (code) => code.type === 'FULL_CREDIT' && String(code.id) === String(result.code),
          )
        );
      })
    ) {
      return unavailable(
        'Die Lösungen lassen sich nicht gemeinsam als richtig bestätigen. Bitte die Kodieranweisungen im Reviewbereich verwenden.',
      );
    }
  } catch {
    return unavailable('Die gemeinsame Musterlösung konnte nicht geprüft werden.');
  }

  return {
    prefill: {
      status: 'available',
      responses: [...responses.values()],
      ...(dropLists.length ? { dropLists } : {}),
      message: unavailableVariables.length
        ? `Teilweise Musterlösung: ${availableVariables.length} von ${relevantVariables.length} Kodiervariablen sind eindeutig im Player darstellbar. Für die übrigen bitte die Kodieranweisungen verwenden.`
        : 'Die Musterlösung wurde aus den Lösungsregeln abgeleitet und mit dem Kodierschema geprüft.',
    },
    unavailableVariables,
  };
}
