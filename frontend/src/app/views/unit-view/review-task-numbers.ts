import type { ReviewCodingVariable } from './review-coding-labels';

export interface ReviewTaskVariable extends ReviewCodingVariable {
  sourceType?: string;
  deriveSources?: string[];
}

type RecordValue = Record<string, unknown>;
interface ResponseNode {
  id?: string;
  alias?: string;
  type: string;
}
interface AspectFormat {
  aliases: 'none' | 'aspect2' | 'aspect3';
  geometryObjects: boolean;
  clozeTypes: ReadonlySet<string>;
}
interface SectionEntry {
  page: number;
  position: number;
  number?: string;
  value: RecordValue;
  nodes: ResponseNode[];
}
interface ResponseEntry {
  node: ResponseNode;
  section?: SectionEntry;
}

function record(value: unknown): value is RecordValue {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const aspect2ClozeTypes = new Set(['TextField', 'DropList', 'ToggleButton', 'Button', 'Checkbox']);
const aspect3ClozeTypes = new Set([...aspect2ClozeTypes, 'Dropdown']);

function responseNode(node: RecordValue, type: string, format: AspectFormat): ResponseNode {
  const id = typeof node['id'] === 'string' && node['id'] ? node['id'] : undefined;
  let alias: unknown = node['alias'];
  if (format.aliases === 'none') alias = id;
  else if (format.aliases === 'aspect3') alias ??= id;
  else if (node['id'] !== undefined && node['isRelevantForPresentationComplete'] !== undefined) {
    // The complete-model branch in ASPECT 2.6–2.12 uses alias || id.
    alias ||= id;
  }
  // Incomplete 2.x models can receive a generated alias. Never assume it equals
  // the ID; an explicitly supplied alias still participates in collision checks.
  return { id, alias: typeof alias === 'string' ? alias : undefined, type };
}

function geometryNames(node: RecordValue, format: AspectFormat): string[] | undefined {
  const names = new Set<string>();
  for (const key of format.geometryObjects
    ? ['trackedVariables', 'trackedExpectedVariables']
    : ['trackedVariables']) {
    const values = node[key] ?? [];
    if (!Array.isArray(values)) return undefined;
    // Since 2.11, trackedVariables also accepts legacy string arrays. Expected
    // variables use objects, and earlier definitions only know string arrays.
    const strings =
      !format.geometryObjects ||
      (key === 'trackedVariables' && values.every((value) => typeof value === 'string'));
    for (const value of values) {
      const name: unknown = strings ? value : record(value) ? value['id'] : undefined;
      if (typeof name !== 'string') return undefined;
      names.add(name);
    }
  }
  return [...names];
}

// Only actual model containers belong to a section. An ID in an option,
// visibility rule or arbitrary metadata object is not a response element.
function elementNodes(values: unknown, format: AspectFormat): ResponseNode[] | undefined {
  type Context = 'model' | 'document' | 'likert-row';
  const pending: { value: unknown; context: Context }[] = [];
  const nodes: ResponseNode[] = [];
  function enqueue(children: unknown, context: Context) {
    if (Array.isArray(children)) {
      for (const value of children) pending.push({ value, context });
    }
  }
  enqueue(values, 'model');
  // Walk iteratively and completely: cutting off a deep branch could hide a
  // duplicate alias and turn an ambiguous response key into a false singleton.
  while (pending.length) {
    const { value: node, context } = pending.pop()!;
    if (!record(node)) continue;
    if (context === 'document') {
      // ASPECT also visits content below custom document nodes.
      enqueue(node['content'], 'document');
      if (format.clozeTypes.has(String(node['type'])) && record(node['attrs'])) {
        pending.push({ value: node['attrs']['model'], context: 'model' });
      }
      continue;
    }
    // Likert constructs rows directly; their class supplies this type even if
    // the stored row omits it. Other containers dispatch using the stored type.
    const type = context === 'likert-row' ? 'likert-row' : node['type'];
    if (typeof type !== 'string') continue;
    // A public alias still participates in collision checks when an export has
    // omitted its internal ID; ignoring that model would create false uniqueness.
    const response = responseNode(node, type, format);
    if (response.id || response.alias) nodes.push(response);
    if (type === 'geometry') {
      const names = geometryNames(node, format);
      if (!names) return undefined;
      for (const name of names) {
        nodes.push({
          id: response.id === undefined ? undefined : `${response.id}_${name}`,
          alias: response.alias === undefined ? undefined : `${response.alias}_${name}`,
          type: 'geometry-variable',
        });
      }
    }
    // A missing parent ID must not conceal identifiable child responses.
    if (type === 'likert') enqueue(node['rows'], 'likert-row');
    else if (type === 'table') enqueue(node['elements'], 'model');
    else if (type === 'cloze' && record(node['document'])) {
      enqueue(node['document']['content'], 'document');
    }
  }
  return nodes;
}

// VOUD versions, not player versions: automatic section numbering starts with
// ASPECT 2.5 / definition 4.6.0. The same counter is used through 2.12.6 (4.11.0)
// and 3.0.1 (4.12.0). Unknown formats are deliberately not extrapolated.
const aspect2: AspectFormat = {
  aliases: 'aspect2',
  geometryObjects: false,
  clozeTypes: aspect2ClozeTypes,
};
const formats = new Map<string, AspectFormat>([
  ['4.6.0', { ...aspect2, aliases: 'none' }],
  ['4.7.0', aspect2],
  ['4.8.0', aspect2],
  ['4.9.0', aspect2],
  ['4.10.0', { ...aspect2, geometryObjects: true }],
  ['4.11.0', { ...aspect2, geometryObjects: true }],
  ['4.12.0', { aliases: 'aspect3', geometryObjects: true, clozeTypes: aspect3ClozeTypes }],
]);

/** Read-only ASPECT adapter. No rendered markup, authored text or ID suffix is interpreted. */
export function readReviewTaskNumbers(
  definition: string | null,
  variables: readonly ReviewTaskVariable[],
  printMode = false,
): Map<string, string> {
  const result = new Map<string, string>();
  let unit: unknown;
  try {
    unit = JSON.parse(definition || 'null');
  } catch {
    return result;
  }
  if (
    !record(unit) ||
    unit['type'] !== 'aspect-unit-definition' ||
    unit['enableSectionNumbering'] !== true ||
    !Array.isArray(unit['pages'])
  )
    return result;
  const format = formats.get(String(unit['version']));
  if (!format) return result;

  const sections: SectionEntry[] = [];
  let counter = 0;
  let fixedPages = 0;
  for (const [pageIndex, page] of unit['pages'].entries()) {
    if (
      !record(page) ||
      !Array.isArray(page['sections']) ||
      (page['alwaysVisible'] !== undefined && typeof page['alwaysVisible'] !== 'boolean')
    )
      return result;
    if (page['alwaysVisible'] && ++fixedPages > 1) return result;
    for (const [position, section] of page['sections'].entries()) {
      if (
        !record(section) ||
        !Array.isArray(section['elements']) ||
        (section['ignoreNumbering'] !== undefined &&
          typeof section['ignoreNumbering'] !== 'boolean')
      )
        return result;
      // Hidden sections count too. Only the interactive layout excludes fixed
      // stimulus pages; the print layout numbers every page in document order.
      const number =
        (printMode || !page['alwaysVisible']) && !section['ignoreNumbering']
          ? `${++counter}.`
          : undefined;
      const nodes = elementNodes(section['elements'], format);
      if (!nodes) return result;
      sections.push({
        page: pageIndex,
        position,
        number,
        value: section,
        nodes,
      });
    }
  }
  const entries: ResponseEntry[] = sections.flatMap((section) =>
    section.nodes.map((node) => ({ node, section })),
  );
  const stateVariables = unit['stateVariables'] === undefined ? [] : unit['stateVariables'];
  if (!Array.isArray(stateVariables)) return result;
  for (const state of stateVariables) {
    if (!record(state)) return result;
    const id = state['id'];
    // Unlike 2.x element models, state variables retain an explicit empty alias.
    const alias = format.aliases === 'none' ? id : (state['alias'] ?? id);
    if (typeof id !== 'string' || typeof alias !== 'string') return result;
    // State responses can collide with section responses, but have no section
    // of their own and must never acquire a task number.
    entries.push({ node: { id, alias, type: 'state-variable' } });
  }
  const byId = (id: unknown) => entries.filter((entry) => entry.node['id'] === id);
  // ID and alias namespaces remain separate; compare effective player identities.
  const byAlias = (alias: string) => entries.filter(({ node }) => node.alias === alias);

  function sectionNumber(section: SectionEntry): string | undefined {
    if (section.number) return section.number;
    // Narrow layout used by DHV004: one numbered audio header on the page,
    // immediately followed by an answer section revealed by that very audio.
    const headers = sections.filter((entry) => entry.page === section.page && entry.number);
    const rules = section.value['visibilityRules'];
    if (headers.length !== 1 || !Array.isArray(rules) || rules.length !== 1) return undefined;
    const header = headers[0];
    const rule: unknown = rules[0];
    if (
      header.position + 1 !== section.position ||
      !record(rule) ||
      rule['operator'] !== '>' ||
      !['0', 0].includes(rule['value'] as string | number)
    )
      return undefined;
    const sources = byId(rule['id']);
    if (
      sources.length !== 1 ||
      sources[0].section !== header ||
      sources[0].node['type'] !== 'audio'
    )
      return undefined;
    const headerElements = header.value['elements'];
    if (
      !Array.isArray(headerElements) ||
      !headerElements.every(
        (node: unknown) =>
          record(node) &&
          typeof node['id'] === 'string' &&
          !!node['id'] &&
          ['audio', 'button'].includes(String(node['type'])),
      )
    )
      return undefined;
    return header.number;
  }

  const resolved = new Map<ReviewTaskVariable, string | undefined>();
  const visiting = new Set<ReviewTaskVariable>();
  function resolve(variable: ReviewTaskVariable): string | undefined {
    if (resolved.has(variable)) return resolved.get(variable);
    const key = variable.alias || variable.id;
    if (
      variables.filter((entry) => (entry.alias || entry.id) === key).length !== 1 ||
      variables.filter((entry) => entry.id === variable.id).length !== 1
    )
      return undefined;
    if (visiting.has(variable)) return undefined;
    visiting.add(variable);
    let number: string | undefined;
    if (
      variable.sourceType === undefined ||
      ['BASE', 'BASE_NO_VALUE'].includes(variable.sourceType)
    ) {
      const canonical = byId(variable.id);
      const aliases = byAlias(key);
      const legacy = !variable.alias || variable.alias === variable.id;
      const matches = canonical.length ? canonical : legacy ? aliases : [];
      if (
        matches.length === 1 &&
        aliases.length === 1 &&
        matches[0] === aliases[0] &&
        matches[0].section
      )
        number = sectionNumber(matches[0].section);
    } else if (Array.isArray(variable.deriveSources) && variable.deriveSources.length) {
      const sources = variable.deriveSources.map((id) => {
        const matches = variables.filter((source) => source.id === id);
        return matches.length === 1 ? resolve(matches[0]) : undefined;
      });
      if (sources.every((source) => source !== undefined && source === sources[0]))
        number = sources[0];
    }
    visiting.delete(variable);
    resolved.set(variable, number);
    return number;
  }
  for (const variable of variables) {
    const key = variable.alias || variable.id;
    const number = resolve(variable);
    if (number) result.set(key, number);
  }
  return result;
}
