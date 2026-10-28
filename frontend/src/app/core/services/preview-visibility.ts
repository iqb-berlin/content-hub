import { collectVoudNodes, findVoudIdentifierMatches } from './voud-nodes';
export interface PreviewContext {
  definitionKey: string;
  target: string;
  page: number;
  dataParts: Record<string, string>;
}

/** Preview state is a transient input to the player, never an answer. */
export interface PreviewStart {
  page?: number;
  values: Record<string, string>;
  context?: PreviewContext;
}
export interface PreviewNode {
  id?: string;
  alias?: string;
  value?: string;
  type?: string;
  action?: string;
  actionParam?: { id: string; value: string };
  alwaysVisible?: boolean | string | number;
  sections?: PreviewNode[];
  elements?: PreviewNode[];
  visibilityRules?: { id: string; operator: string; value: string }[];
  logicalConnectiveOfRules?: string;
  visibilityDelay?: number;
  activeAfterID?: string;
  enableReHide?: boolean;
}
export interface PreviewDefinition {
  pages: PreviewNode[];
  stateVariables?: PreviewNode[];
}
export interface PreviewStateCode {
  id: string;
  status: string;
  value: string;
}

export function readPreviewDefinition(content: string): PreviewDefinition | null {
  try {
    const parsed = JSON.parse(content);
    const validNodes = (nodes: unknown): boolean =>
      Array.isArray(nodes) &&
      nodes.every((node) => {
        if (!node || typeof node !== 'object') return false;
        return (
          ['id', 'alias'].every((key) => node[key] == null || typeof node[key] === 'string') &&
          (node.sections === undefined || validNodes(node.sections)) &&
          (node.elements === undefined || validNodes(node.elements)) &&
          (node.visibilityRules === undefined ||
            (Array.isArray(node.visibilityRules) &&
              node.visibilityRules.every(
                (rule: unknown) =>
                  rule &&
                  typeof rule === 'object' &&
                  typeof (rule as Record<string, unknown>)['id'] === 'string',
              )))
        );
      });
    return validNodes(parsed.pages) &&
      (parsed.stateVariables === undefined || validNodes(parsed.stateVariables))
      ? parsed
      : null;
  } catch {
    return null;
  }
}
export const isAlwaysVisible = (node: PreviewNode) =>
  node.alwaysVisible === true || node.alwaysVisible === 'true' || node.alwaysVisible === 1;
export const previewNodes = (node: PreviewNode): PreviewNode[] =>
  collectVoudNodes(node) as PreviewNode[];

export interface PreviewSetup {
  kind: 'ready';
  definition: PreviewDefinition;
  locations: { node: PreviewNode; section: PreviewNode; pi: number }[];
  location: PreviewSetup['locations'][number];
  navigable: number[];
  page?: number;
  byId: Map<string, PreviewNode>;
}

/** Parse and validate identities, pages and state inputs once for both start strategies. */
export function preparePreviewDefinition(
  content: string,
  target: string,
  manual?: PreviewStart,
): PreviewSetup | { kind: 'unavailable'; reason: string } {
  const fail = (reason: string) => ({ kind: 'unavailable' as const, reason });
  const definition = readPreviewDefinition(content);
  if (!definition) return fail('Die Aufgabendefinition kann nicht gelesen werden.');
  const locations = definition.pages.flatMap((page, pi) =>
    (page.sections || []).flatMap((section) =>
      previewNodes(section).map((node) => ({ node, section, pi })),
    ),
  );
  const targets = findVoudIdentifierMatches(locations, target);
  if (targets.length !== 1) return fail('Das Player-Ziel fehlt oder ist nicht eindeutig.');
  const location = targets[0];
  const navigable = definition.pages
    .map((page, i) => (isAlwaysVisible(page) ? -1 : i))
    .filter((i) => i >= 0);
  // Only permanently visible targets can choose their task-page context.
  const page = isAlwaysVisible(definition.pages[location.pi])
    ? manual?.page
    : navigable.indexOf(location.pi);
  if (page !== undefined && (!Number.isInteger(page) || page < 0 || page >= navigable.length))
    return fail('Die konfigurierte Vorschauseite existiert nicht.');
  const variables = definition.stateVariables || [];
  const byId = new Map(variables.map((variable) => [variable.id!, variable]));
  if (byId.size !== variables.length || variables.some((variable) => !variable.id))
    return fail('Die Zustandsvariablen sind nicht eindeutig.');
  if (
    Object.entries(manual?.values || {}).some(
      ([id, value]) => !byId.has(id) || typeof value !== 'string',
    )
  )
    return fail('Eine konfigurierte Zustandsvariable ist ungültig.');
  return { kind: 'ready', definition, locations, location, navigable, page, byId };
}

export function previewSections(setup: PreviewSetup, page = setup.page): PreviewNode[] {
  return setup.definition.pages.flatMap((model, pi) =>
    isAlwaysVisible(model) ||
    pi === (page === undefined ? setup.location.pi : setup.navigable[page])
      ? model.sections || []
      : [],
  );
}

/** One rule evaluator for static contexts and the ordered trigger path. */
export function isPreviewSectionVisible(
  section: PreviewNode,
  values: ReadonlyMap<string, string | number>,
): boolean {
  const matches = (rule: NonNullable<PreviewNode['visibilityRules']>[number]) => {
    if (!values.has(rule.id)) return false;
    const value = values.get(rule.id)!;
    switch (rule.operator) {
      case '=':
        return String(value) === String(rule.value);
      case '≠':
        return String(value) !== String(rule.value);
      case '>':
        return Number(value) > Number(rule.value);
      case '≥':
        return Number(value) >= Number(rule.value);
      case '<':
        return Number(value) < Number(rule.value);
      case '≤':
        return Number(value) <= Number(rule.value);
      default:
        return false;
    }
  };
  const rules = section.visibilityRules || [];
  return (
    !rules.length ||
    (section.logicalConnectiveOfRules === 'disjunction'
      ? rules.some(matches)
      : rules.every(matches))
  );
}

/** Choose a unique equality context. Historical visibility is handled by the original player. */
export function resolveStaticPreviewState(
  setup: PreviewSetup,
  manual?: PreviewStart,
): PreviewStateCode[] | null {
  const {
    definition: { pages },
    location,
    page,
    byId,
  } = setup;
  const sections = previewSections(setup);
  const relevant = new Set<string>();
  for (const section of sections) {
    if (section.visibilityDelay || section.activeAfterID) return null;
    for (const rule of section.visibilityRules || []) {
      if (!byId.has(rule.id) || rule.operator !== '=') return null;
      relevant.add(rule.id);
    }
    for (const node of previewNodes(section)) {
      if (
        node !== section &&
        (node.visibilityRules?.length || node.visibilityDelay || node.activeAfterID)
      ) {
        return null;
      }
      if (node.type === 'trigger' && node.action === 'stateVariableChange') {
        if (!node.actionParam || !byId.has(node.actionParam.id)) return null;
        relevant.add(node.actionParam.id);
      }
    }
  }
  if (page === undefined && relevant.size > 0) {
    return null;
  }
  const domains = new Map(
    [...relevant].map((id) => [id, new Set([String(byId.get(id)!.value ?? '')])]),
  );
  // Constants from all pages may describe the state required on the target page.
  for (const p of pages)
    for (const s of p.sections || []) {
      for (const r of s.visibilityRules || [])
        if (r.operator === '=') domains.get(r.id)?.add(String(r.value));
      for (const n of previewNodes(s))
        if (n.action === 'stateVariableChange' && n.actionParam)
          domains.get(n.actionParam.id)?.add(String(n.actionParam.value));
    }
  for (const [id, value] of Object.entries(manual?.values || {})) domains.set(id, new Set([value]));
  let assignments: Record<string, string>[] = [{}];
  for (const [id, values] of domains) {
    if (assignments.length * values.size > 4096) return null;
    assignments = assignments.flatMap((a) => [...values].map((value) => ({ ...a, [id]: value })));
  }
  const candidates = assignments
    .map((a) => new Map(Object.entries(a)))
    .filter(
      (a) =>
        isPreviewSectionVisible(location.section, a) &&
        sections.every(
          (s) =>
            !isPreviewSectionVisible(s, a) ||
            previewNodes(s).every(
              (n) =>
                n.type !== 'trigger' ||
                n.action !== 'stateVariableChange' ||
                a.get(n.actionParam!.id) === String(n.actionParam!.value),
            ),
        ),
    );
  if (candidates.length !== 1) return null;
  return [...candidates[0]].map(([id, value]) => ({
    id: byId.get(id)!.alias || id,
    status: 'VALUE_CHANGED',
    value,
  }));
}
