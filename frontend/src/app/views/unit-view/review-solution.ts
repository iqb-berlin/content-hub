import { CodingSchemeFactory } from '@iqb/responses';
import type { VariableCodingData } from '@iqbspecs/coding-scheme';
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

/** Combine the Explorer's validated solutions without guessing missing answers. */
export function deriveReviewSolution(
  variables: CodingVariableLike[],
  relevantVariables: CodingVariableLike[],
  resolveTarget: PlayerResponseTargetResolver,
): ReviewSolution {
  const unavailableVariables: string[] = [];
  const availableVariables: CodingVariableLike[] = [];
  const responses = new Map<string, PlayerSolutionResponse>();
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
    for (const response of solution.responses) {
      const key = response.id.toLowerCase();
      const existing = responses.get(key);
      if (existing && !Object.is(existing.value, response.value)) {
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
      message: unavailableVariables.length
        ? `Teilweise Musterlösung: ${availableVariables.length} von ${relevantVariables.length} Kodiervariablen sind eindeutig im Player darstellbar. Für die übrigen bitte die Kodieranweisungen verwenden.`
        : 'Die Musterlösung wurde aus den Lösungsregeln abgeleitet und mit dem Kodierschema geprüft.',
    },
    unavailableVariables,
  };
}
