/** Existing VOMD/AP item references and coding labels; no player or definition format is inspected. */
export interface ReviewCodingVariable {
  id: string;
  alias?: string;
  label?: string;
}

export interface ReviewCodingLabel {
  title: string;
  subtitle: string;
}

export const unnamedReviewCoding = 'Kodierung ohne Bezeichnung';

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function key(value: unknown): string {
  return text(value).toLowerCase();
}

function descriptiveLabel(value: unknown, identifiers: unknown[]): string {
  const label = text(value);
  return label && !identifiers.some((id) => key(id) === key(label)) ? label : '';
}

function itemLabels(
  variables: readonly ReviewCodingVariable[],
  items: readonly unknown[],
): Map<ReviewCodingVariable, Set<string>> {
  const labels = new Map<ReviewCodingVariable, Set<string>>();
  for (const value of items) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const internalId = key(item['variableReadOnlyId']);
    const reference = key(item['sourceVariable']) || key(item['variableId']);
    // A declared internal ID is authoritative; legacy references use the public alias first.
    const byAlias =
      internalId || !reference ? [] : variables.filter((v) => key(v.alias) === reference);
    const matches = internalId
      ? variables.filter((v) => key(v.id) === internalId)
      : byAlias.length
        ? byAlias
        : reference
          ? variables.filter((v) => key(v.id) === reference)
          : [];
    if (matches.length !== 1) continue;
    const variable = matches[0];
    const identifiers = [variable.id, variable.alias];
    const label =
      descriptiveLabel(item['description'], identifiers) ||
      descriptiveLabel(item['name'], [...identifiers, item['id']]);
    const candidates = labels.get(variable) ?? new Set<string>();
    candidates.add(label);
    labels.set(variable, candidates);
  }
  return labels;
}

/** File metadata takes precedence over index copies. Conflicting or missing names use the coding label. */
export function buildReviewCodingLabels(
  variables: readonly ReviewCodingVariable[],
  indexItems: readonly unknown[] = [],
  metadataItems: readonly unknown[] = [],
  taskNumbers: ReadonlyMap<string, string> = new Map(),
): Map<string, ReviewCodingLabel> {
  const indexLabels = itemLabels(variables, indexItems);
  const metadataLabels = itemLabels(variables, metadataItems);
  return new Map(
    variables.map((variable) => {
      const codingLabel = descriptiveLabel(variable.label, [variable.id, variable.alias]);
      const candidates = metadataLabels.get(variable) ?? indexLabels.get(variable);
      const itemLabel = candidates?.size === 1 ? [...candidates][0] : '';
      const taskNumber = taskNumbers.get(variable.alias || variable.id);
      const descriptions = [
        ...new Set([itemLabel, codingLabel].filter((label) => label && label !== taskNumber)),
      ];
      return [
        variable.alias || variable.id,
        {
          title: taskNumber || itemLabel || codingLabel || unnamedReviewCoding,
          subtitle: taskNumber
            ? descriptions.join(' – ')
            : itemLabel && codingLabel && itemLabel !== codingLabel
              ? codingLabel
              : '',
        },
      ];
    }),
  );
}
