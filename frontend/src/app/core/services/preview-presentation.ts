import {
  PreviewStart,
  PreviewSetup,
  PreviewNode,
  preparePreviewDefinition,
  resolveStaticPreviewState,
  isAlwaysVisible as always,
  previewNodes as nodes,
  previewSections,
  isPreviewSectionVisible as visible,
} from './preview-visibility';
export type { PreviewContext } from './preview-visibility';
import type { PreviewContext } from './preview-visibility';

export interface PreviewPresentation {
  kind: 'ready';
  page?: number;
  dataParts: Record<string, string>;
  /** Run the original player's page/trigger sequence instead of requiring a fixed point. */
  navigate?: number[];
  triggerIds?: string[];
  interactive?: boolean;
  printDataParts?: Record<string, string>;
  message: string;
}

/** A version key, not an authorization or integrity check. Includes embedded media. */
export function previewDefinitionKey(content: string): string {
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < content.length; i++) {
    a = Math.imul(a ^ content.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ content.charCodeAt(i);
  }
  return `${content.length}-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}

export function readPreviewContext(value: unknown): PreviewContext | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as PreviewContext;
  if (
    typeof raw.definitionKey !== 'string' ||
    !/^\d+-[\da-f]{1,8}-[\da-f]{1,8}$/.test(raw.definitionKey) ||
    typeof raw.target !== 'string' ||
    !raw.target.trim() ||
    raw.target.length > 256 ||
    !Number.isInteger(raw.page) ||
    raw.page < 0 ||
    raw.page >= 10000 ||
    !raw.dataParts ||
    typeof raw.dataParts !== 'object' ||
    Array.isArray(raw.dataParts)
  )
    return null;
  const entries = Object.entries(raw.dataParts);
  if (
    !entries.length ||
    entries.some(
      ([key, data]) =>
        !['elementCodes', 'stateVariableCodes', 'geometryVariableCodes'].includes(key) ||
        typeof data !== 'string',
    ) ||
    JSON.stringify(raw.dataParts).length > 524288
  )
    return null;
  try {
    if (entries.some(([, data]) => !Array.isArray(JSON.parse(data)))) return null;
  } catch {
    return null;
  }
  return {
    definitionKey: raw.definitionKey,
    target: raw.target.trim(),
    page: raw.page,
    dataParts: { ...raw.dataParts },
  };
}

/** Prepare presentation inputs only. Never infer or populate a pupil's answer.
 * Media progress is the earliest monotone threshold needed to open the item. The original
 * player still evaluates every rule and executes triggers in page order. Other response/
 * timer dependencies remain interactive, or use an explicitly captured reference context.
 */
export function preparePreviewPresentation(
  content: string,
  target: string,
  manual?: PreviewStart,
): PreviewPresentation | { kind: 'unavailable'; reason: string } {
  const setup = preparePreviewDefinition(content, target, manual);
  if (setup.kind === 'unavailable') return setup;
  const { definition, locations, location, navigable, page: targetPage, byId } = setup;
  const context = manual?.context;
  if (context) {
    const captured = readPreviewContext(context);
    if (
      !captured ||
      captured.definitionKey !== previewDefinitionKey(content) ||
      captured.target.toLowerCase() !== target.trim().toLowerCase() ||
      captured.page >= navigable.length ||
      (!always(definition.pages[location.pi]) && navigable[captured.page] !== location.pi)
    ) {
      return {
        kind: 'unavailable',
        reason:
          'Der gespeicherte Vorschaukontext passt nicht mehr zu Definition oder Ziel. Bitte neu übernehmen oder zurücksetzen.',
      };
    }
    return {
      kind: 'ready',
      page: captured.page,
      dataParts: captured.dataParts,
      message:
        'Übernommener Vorschaukontext. Dieser Kontext wird getrennt von Antworten verwendet.',
    };
  }
  const codes = needsVisibilityHistory(setup) ? null : resolveStaticPreviewState(setup, manual);
  if (codes)
    return {
      kind: 'ready',
      page: targetPage,
      dataParts: codes.length ? { stateVariableCodes: JSON.stringify(codes) } : {},
      message: '',
    };

  const variables = [...byId.values()];
  const all = nodes({ elements: definition.pages });
  const media = all.filter((node) => node.type === 'audio' || node.type === 'video');
  const values = new Map<string, string | number>(
    variables.map((variable) => [variable.id!, String(variable.value ?? '')]),
  );
  for (const [id, value] of Object.entries(manual?.values || {})) values.set(id, value);
  const mediaValues = new Map<PreviewNode, number>();
  const fired = new Set<PreviewNode>();
  const revealedSections = new Set<PreviewNode>();
  const isVisible = (section: PreviewNode) => {
    const shown = visible(section, values) || revealedSections.has(section);
    if (shown && section.enableReHide !== true) revealedSections.add(section);
    return shown;
  };
  const dataParts: Record<string, string> = {};
  if (Object.keys(manual?.values || {}).length)
    dataParts['stateVariableCodes'] = JSON.stringify(
      variables
        .filter((variable) => manual?.values[variable.id!] !== undefined)
        .map((variable) => ({
          id: variable.alias || variable.id,
          status: 'VALUE_CHANGED',
          value: manual!.values[variable.id!],
        })),
    );
  const interactive: PreviewPresentation = {
    kind: 'ready',
    page: 0,
    dataParts,
    interactive: true,
    navigate: [],
    message:
      'Diese Ansicht benötigt den regulären Aufgabenablauf. Öffnen Sie das Item im Player; anschließend kann die Ansicht als Vorschaukontext übernommen werden.',
  };
  let selectedPage = targetPage;
  const neededSections = new Set<PreviewNode>();
  const requireSection = (section: PreviewNode): boolean => {
    if (neededSections.has(section)) return true;
    neededSections.add(section);
    if (section.visibilityDelay || section.activeAfterID) return false;
    for (const rule of section.visibilityRules || []) {
      if (byId.has(rule.id)) continue;
      // Rules reference internal IDs; a different element can use that ID as public alias.
      const internal = media.filter((node) => node.id === rule.id);
      const found = internal.length ? internal : media.filter((node) => node.alias === rule.id);
      const threshold = Number(rule.value);
      if (
        found.length !== 1 ||
        !Number.isFinite(threshold) ||
        threshold < 0 ||
        threshold > 1 ||
        !['>', '≥', '='].includes(rule.operator)
      )
        return false;
      const value = rule.operator === '>' ? threshold + 0.001 : threshold;
      if (value > 1) return false;
      const model = found[0];
      mediaValues.set(model, Math.max(mediaValues.get(model) ?? 0, value));
      values.set(rule.id, mediaValues.get(model)!);
      if (model.id) values.set(model.id, mediaValues.get(model)!);
      const parent = locations.find((entry) => entry.node === model);
      if (
        !parent ||
        parent.section === section ||
        (targetPage !== undefined &&
          !always(definition.pages[parent.pi]) &&
          navigable.indexOf(parent.pi) > targetPage)
      )
        return false;
      if (!requireSection(parent.section)) return false;
    }
    return true;
  };
  // Follow only the item's dependencies. Completing a later outro or an unrelated media
  // branch would expose content that is not required for the item's entry context.
  if (!requireSection(location.section)) return interactive;
  // Seeding progress skips earlier media states. A section that stays visible may
  // have been revealed in one of those states; let the real player retain that history.
  if (
    mediaValues.size &&
    previewPathPages(setup).some((page) =>
      (page.sections || []).some(
        (section) => section.visibilityRules?.length && section.enableReHide !== true,
      ),
    )
  )
    return interactive;
  for (
    let page = 0;
    page < navigable.length && page <= (targetPage ?? navigable.length - 1);
    page++
  ) {
    const sections = previewSections(setup, page);
    if (
      sections.some(
        (section) =>
          section.visibilityDelay ||
          section.activeAfterID ||
          nodes(section).some(
            (node) =>
              node !== section &&
              (node.visibilityRules?.length || node.visibilityDelay || node.activeAfterID),
          ),
      )
    )
      return interactive;
    // Each trigger enters view once along this path. A global trigger that wrote 1 earlier
    // need not still write the final value 2: the player's ordered events are authoritative.
    for (let pass = 0; pass <= all.length; pass++) {
      let changed = false;
      for (const section of sections)
        if (isVisible(section))
          for (const node of nodes(section)) {
            if (node.type !== 'trigger' || node.action !== 'stateVariableChange' || fired.has(node))
              continue;
            if (!node.actionParam || !byId.has(node.actionParam.id)) {
              return interactive;
            }
            fired.add(node);
            values.set(node.actionParam.id, String(node.actionParam.value));
            changed = true;
          }
      if (!changed) break;
    }
    if (targetPage === undefined && isVisible(location.section)) {
      selectedPage = page;
      break;
    }
  }
  if (selectedPage === undefined || !isVisible(location.section)) return interactive;
  if (mediaValues.size)
    dataParts['elementCodes'] = JSON.stringify(
      [...mediaValues].map(([node, value]) => ({
        id: node.alias || node.id,
        status: 'VALUE_CHANGED',
        value,
      })),
    );
  return {
    kind: 'ready',
    page: 0,
    dataParts,
    interactive: false,
    triggerIds: [...fired].map((node) => node.id || '').filter(Boolean),
    printDataParts: {
      ...dataParts,
      stateVariableCodes: JSON.stringify(
        variables.map((variable) => ({
          id: variable.alias || variable.id,
          status: 'VALUE_CHANGED',
          value: values.get(variable.id!),
        })),
      ),
    },
    navigate: Array.from({ length: selectedPage }, (_, i) => i + 1),
    message: mediaValues.size
      ? 'Referenzansicht mit vorbereitetem Medienfortschritt. Die Sichtbarkeitsregeln bleiben aktiv.'
      : 'Referenzansicht aus dem regulären Aufgabenablauf.',
  };
}

/** A static final value cannot restore sections revealed earlier by viewport triggers.
 * Include ordinary task pages along the entry path, not only permanent stimulus pages.
 * Without a trigger path, unique equality contexts remain directly selectable.
 */
function needsVisibilityHistory(setup: PreviewSetup): boolean {
  const pages = previewPathPages(setup);
  const hasTriggers = pages.some((page) =>
    nodes(page).some((node) => node.type === 'trigger' && node.action === 'stateVariableChange'),
  );
  return pages.some(
    (page) =>
      (always(page) || hasTriggers) &&
      (page.sections || []).some(
        (section) => section.visibilityRules?.length && section.enableReHide !== true,
      ),
  );
}

function previewPathPages(setup: PreviewSetup): PreviewNode[] {
  return setup.definition.pages.filter(
    (page, pi) =>
      always(page) || setup.navigable.indexOf(pi) <= (setup.page ?? setup.navigable.length - 1),
  );
}
