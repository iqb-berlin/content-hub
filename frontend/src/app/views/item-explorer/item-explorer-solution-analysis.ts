import { CodingSchemeFactory } from '@iqb/responses';
import type { VariableCodingData } from '@iqbspecs/coding-scheme';

export type SolutionScalar = string | number | boolean;
export type SolutionResponseValue = SolutionScalar | string[];

export interface CodingRuleLike {
  method?: string;
  parameters?: unknown;
  fragment?: number;
}

export interface RuleSetLike {
  rules?: CodingRuleLike[];
  valueArrayPos?: number | string;
}

export interface CodeLike {
  id?: unknown;
  type?: string;
  score?: unknown;
  manualInstruction?: unknown;
  ruleSets?: RuleSetLike[];
}

export interface CodingVariableLike {
  id?: unknown;
  alias?: unknown;
  sourceType?: string;
  deriveSources?: unknown[];
  fragmenting?: unknown;
  codeModel?: string;
  manualInstruction?: unknown;
  codes?: CodeLike[];
}

export interface DerivedSolutionAnswer {
  variable: CodingVariableLike;
  value: SolutionScalar;
  codeIds: string[];
}

export type SolutionAnalysis =
  | {
      status: 'exact';
      answers: DerivedSolutionAnswer[];
      selectedCodeId: string;
      message: string;
    }
  | {
      status: 'multiple' | 'rules' | 'unavailable';
      answers: [];
      message: string;
    };

interface VariableValueExact {
  status: 'exact';
  value: SolutionScalar;
  codeIds: string[];
}

type VariableValueAnalysis = VariableValueExact | { status: 'multiple' | 'rules' | 'unavailable' };

const fallback = (
  status: 'multiple' | 'rules' | 'unavailable',
  message: string,
): SolutionAnalysis => ({ status, answers: [], message });

export const normalizeSolutionIdentifier = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase();

const variableIdentifiers = (variable: CodingVariableLike): string[] =>
  Array.from(
    new Set(
      [variable?.id, variable?.alias]
        .map((value) => String(value || '').trim())
        .filter((value) => value.length > 0),
    ),
  );

const findVariable = (
  reference: unknown,
  variables: CodingVariableLike[],
): CodingVariableLike | undefined => {
  const normalizedReference = normalizeSolutionIdentifier(reference);
  if (!normalizedReference) return undefined;
  const idMatches = variables.filter(
    (variable) => normalizeSolutionIdentifier(variable?.id) === normalizedReference,
  );
  if (idMatches.length === 1) return idMatches[0];
  if (idMatches.length > 1) return undefined;
  const aliasMatches = variables.filter(
    (variable) => normalizeSolutionIdentifier(variable?.alias) === normalizedReference,
  );
  return aliasMatches.length === 1 ? aliasMatches[0] : undefined;
};

const collectBaseVariables = (
  variable: CodingVariableLike,
  variables: CodingVariableLike[],
  visited = new Set<string>(),
): CodingVariableLike[] | null => {
  const visitKey = normalizeSolutionIdentifier(variable?.id || variable?.alias);
  if (!visitKey || visited.has(visitKey)) return null;
  const nextVisited = new Set(visited);
  nextVisited.add(visitKey);
  const sourceType = String(variable?.sourceType || 'BASE')
    .trim()
    .toUpperCase();
  if (sourceType === 'BASE') return [variable];
  // Only direct BASE contributions with independently validated full-credit values
  // can be inverted. Other derivations stay visible as rules.
  if (sourceType !== 'SUM_SCORE') return null;
  const sources = Array.isArray(variable?.deriveSources) ? variable.deriveSources : [];
  if (!sources.length) return null;

  const collected: CodingVariableLike[] = [];
  for (const source of sources) {
    const sourceVariable = findVariable(source, variables);
    if (!sourceVariable) return null;
    if (
      String(sourceVariable.sourceType || 'BASE')
        .trim()
        .toUpperCase() !== 'BASE'
    )
      return null;
    const sourceBases = collectBaseVariables(sourceVariable, variables, nextVisited);
    if (!sourceBases?.length) return null;
    collected.push(...sourceBases);
  }
  const seen = new Set<string>();
  return collected.filter((base) => {
    const key = normalizeSolutionIdentifier(base?.id || base?.alias);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const splitRuleParameters = (parameters: unknown): string[] =>
  (Array.isArray(parameters) ? parameters : [])
    .flatMap((parameter) => String(parameter).split(/\r?\n/))
    .filter((parameter) => parameter.length > 0);

const uniqueScalar = (values: SolutionScalar[]): SolutionScalar | null => {
  if (!values.length) return null;
  const first = values[0];
  return values.every((value) => Object.is(value, first)) ? first : null;
};

const deriveRuleValue = (rule: CodingRuleLike): SolutionScalar | null => {
  if (rule?.fragment !== undefined) return null;
  switch (rule?.method) {
    case 'IS_TRUE':
      return true;
    case 'IS_FALSE':
      return false;
    case 'MATCH':
      return uniqueScalar(splitRuleParameters(rule.parameters));
    case 'NUMERIC_MATCH': {
      const numericValues = splitRuleParameters(rule.parameters).map((value) => {
        const normalized = value.trim().replace(/\s+/g, '').replace(',', '.');
        if (!/^[-+]?\d+(\.\d+)?$/.test(normalized)) return Number.NaN;
        return Number.parseFloat(normalized);
      });
      return numericValues.every(Number.isFinite) ? uniqueScalar(numericValues) : null;
    }
    default:
      return null;
  }
};

const deriveRuleSetValue = (ruleSet: RuleSetLike): SolutionScalar | null => {
  if (ruleSet?.valueArrayPos !== undefined) return null;
  const rules = Array.isArray(ruleSet?.rules) ? ruleSet.rules : [];
  if (!rules.length) return null;
  const values = rules.map((rule) => deriveRuleValue(rule));
  if (values.some((value: SolutionScalar | null) => value === null)) return null;
  return uniqueScalar(values as SolutionScalar[]);
};

const deriveCodeValue = (code: CodeLike): SolutionScalar | null => {
  const ruleSets = Array.isArray(code?.ruleSets) ? code.ruleSets : [];
  if (!ruleSets.length) return null;
  const values = ruleSets.map((ruleSet) => deriveRuleSetValue(ruleSet));
  if (values.some((value: SolutionScalar | null) => value === null)) return null;
  return uniqueScalar(values as SolutionScalar[]);
};

const hasRules = (variable: CodingVariableLike): boolean =>
  (Array.isArray(variable?.codes) ? variable.codes : []).some(
    (code) => Array.isArray(code?.ruleSets) && code.ruleSets.length > 0,
  );

const analyzeVariableValue = (variable: CodingVariableLike): VariableValueAnalysis => {
  if (variable?.fragmenting || String(variable?.codeModel || '').toUpperCase() === 'MANUAL_ONLY') {
    return { status: 'rules' };
  }
  const codes = Array.isArray(variable?.codes) ? variable.codes : [];
  const fullCreditCodes = codes.filter(
    (code) => String(code?.type || '').toUpperCase() === 'FULL_CREDIT',
  );
  if (!fullCreditCodes.length) return { status: hasRules(variable) ? 'rules' : 'unavailable' };
  const values = fullCreditCodes.map((code) => deriveCodeValue(code));
  if (values.some((value) => value === null)) return { status: 'rules' };
  const value = uniqueScalar(values as SolutionScalar[]);
  if (value === null) return { status: 'multiple' };
  return { status: 'exact', value, codeIds: fullCreditCodes.map((code) => String(code.id)) };
};

const hasUnambiguousScoreContribution = (variable: CodingVariableLike): boolean => {
  const codes = Array.isArray(variable.codes) ? variable.codes : [];
  return codes.every((code) => {
    const type = String(code.type || '').toUpperCase();
    if (type === 'FULL_CREDIT') {
      const score = Number(code.score ?? 0);
      return Number.isFinite(score) && score > 0;
    }
    return (
      ['NO_CREDIT', 'RESIDUAL', 'RESIDUAL_AUTO'].includes(type) && Number(code.score || 0) === 0
    );
  });
};

const codeIsFullCredit = (variable: CodingVariableLike, codeId: unknown): boolean =>
  (Array.isArray(variable?.codes) ? variable.codes : []).some(
    (code) =>
      String(code?.id) === String(codeId) &&
      String(code?.type || '').toUpperCase() === 'FULL_CREDIT',
  );

const hasFullCreditCode = (variable: CodingVariableLike): boolean =>
  (Array.isArray(variable?.codes) ? variable.codes : []).some(
    (code) => String(code?.type || '').toUpperCase() === 'FULL_CREDIT',
  );

export function getValidatedFullCreditCodeId(
  selectedVariable: CodingVariableLike,
  variables: CodingVariableLike[],
  baseResponses: Array<{ variable: CodingVariableLike; value: SolutionResponseValue }>,
): string | null {
  try {
    const coded = CodingSchemeFactory.code(
      baseResponses.map(({ variable, value }) => ({
        id: String(variable?.alias || variable?.id || '').trim(),
        value,
        status: 'VALUE_CHANGED',
      })),
      variables as VariableCodingData[],
    );
    const selectedIdentifiers = variableIdentifiers(selectedVariable).map(
      normalizeSolutionIdentifier,
    );
    const selectedResponse = coded.find((response) =>
      selectedIdentifiers.includes(normalizeSolutionIdentifier(response?.id)),
    );
    return selectedResponse &&
      selectedResponse.status === 'CODING_COMPLETE' &&
      codeIsFullCredit(selectedVariable, selectedResponse.code)
      ? String(selectedResponse.code)
      : null;
  } catch (_error) {
    return null;
  }
}

export function deriveSolutionAnalysis(
  selectedVariable: CodingVariableLike | undefined,
  variables: CodingVariableLike[],
): SolutionAnalysis {
  if (!selectedVariable) {
    return fallback(
      'unavailable',
      'Für dieses Item konnte keine eindeutige Kodiervariable ermittelt werden.',
    );
  }
  if (!hasFullCreditCode(selectedVariable)) {
    return fallback(
      hasRules(selectedVariable) ? 'rules' : 'unavailable',
      'Die Kodiervariable enthält keinen ausdrücklich markierten FULL_CREDIT-Code.',
    );
  }

  const baseVariables = collectBaseVariables(selectedVariable, variables);
  if (!baseVariables?.length) {
    return fallback('rules', 'Die richtige Antwort ist nicht sicher auf Basisvariablen abbildbar.');
  }

  const selectedSourceType = String(selectedVariable.sourceType || 'BASE')
    .trim()
    .toUpperCase();
  const selectedValue = analyzeVariableValue(selectedVariable);
  if (selectedValue.status === 'multiple') {
    return fallback('multiple', 'Die Kodierung enthält mehrere gültige FULL_CREDIT-Antworten.');
  }
  if (
    selectedSourceType === 'SUM_SCORE' &&
    (selectedValue.status !== 'exact' ||
      typeof selectedValue.value !== 'number' ||
      baseVariables.some((variable) => !hasUnambiguousScoreContribution(variable)))
  ) {
    return fallback(
      'rules',
      'Die zusammengesetzte Kodierung enthält alternative oder partielle Lösungswege.',
    );
  }

  const analyzedBases = baseVariables.map((variable) => ({
    variable,
    result: analyzeVariableValue(variable),
  }));
  if (analyzedBases.some(({ result }) => result.status === 'multiple')) {
    return fallback('multiple', 'Die Kodierung enthält mehrere gültige Antwortalternativen.');
  }
  if (analyzedBases.some(({ result }) => result.status !== 'exact')) {
    return fallback(
      'rules',
      'Aus den FULL_CREDIT-Regeln lässt sich keine eindeutige Antwort erzeugen.',
    );
  }

  const answers = analyzedBases.map(({ variable, result }) => ({
    variable,
    value: (result as VariableValueExact).value,
    codeIds: (result as VariableValueExact).codeIds,
  }));
  const selectedCodeId = getValidatedFullCreditCodeId(
    selectedVariable,
    variables,
    answers.map(({ variable, value }) => ({ variable, value })),
  );
  if (selectedCodeId === null) {
    return fallback(
      'rules',
      'Die abgeleitete Antwort konnte mit dem vorhandenen Kodierschema nicht als richtig bestätigt werden.',
    );
  }

  return {
    status: 'exact',
    answers,
    selectedCodeId,
    message:
      answers.length === 1
        ? 'Eine eindeutige Musterlösung ist verfügbar.'
        : `${answers.length} eindeutige Teilantworten bilden die Musterlösung.`,
  };
}
