import { Inject, Injectable } from '@angular/core';
import DOMPurify from 'dompurify';
import { CodingSchemeTextFactory, CodingAsText } from '@iqb/responses';
import { VoudService } from '../../core/services/voud.service';
import {
  CodingVariableFocusResolution,
  CodingVariableFocusStatus,
  DeepReadonly,
  PreviewTargetOption,
  PreviewTargetResolution,
  ReadonlyExplorerItem,
} from './item-explorer.models';
import {
  derivePlayerSolutionPrefill,
  PlayerSolutionPrefill,
} from './item-explorer-solution-prefill';

type ExplorerCodingAsText = CodingAsText & {
  generalInstructionText?: string | null;
  codes: Array<CodingAsText['codes'][number] & { manualInstructionText?: string | null }>;
};

type CodingVariableMatchStatus = 'unique' | 'missing-target' | 'not-found' | 'ambiguous';
interface CodingVariableMatch {
  status: CodingVariableMatchStatus;
  reference: string;
  variable?: any;
  index?: number;
  matchIndices: number[];
  usedLegacyFallback?: boolean;
  requestedInternalId?: string;
}

/** Owns coding display and target resolution; selection and player definition are explicit inputs. */
@Injectable()
export class ItemExplorerCodingService {
  constructor(@Inject(VoudService) private readonly voudService: VoudService) {}

  setScheme(scheme: any): void {
    this.currentCodingScheme = scheme;
    this.currentCodingSchemeAsText = scheme
      ? this.createCodingSchemeAsText(Array.isArray(scheme) ? scheme : scheme.variableCodings || [])
      : null;
  }

  currentCodingScheme: any = null;

  currentCodingSchemeAsText: CodingAsText[] | null = null;

  showAudioVideoCodingVariables = true;

  showGeneralCodingInstructions = false;

  preferManualCodingInstructions = true;

  codingSearchText = '';

  codingSortField: 'id' | 'label' = 'id';

  codingSortDir: 'asc' | 'desc' = 'asc';

  correctSolutionPrefill: PlayerSolutionPrefill = {
    status: 'unavailable',
    responses: [],
    message: 'Für dieses Item wurde noch keine Musterlösung ermittelt.',
  };

  selectedPreviewTargetId = '';

  customPreviewTargetDraft = '';

  previewTargetResolution: PreviewTargetResolution = {
    itemTarget: '',
    isDerived: false,
    options: [],
    defaultTargetId: '',
  };

  filteredCodingSchemeAsText(
    selectedItem: ReadonlyExplorerItem | null,
    definition: string | null,
  ): CodingAsText[] {
    if (!this.currentCodingSchemeAsText) return [];

    const focus = this.codingVariableFocus(selectedItem, definition);
    let list = focus.status === 'unique' ? [...focus.matches] : [...this.currentCodingSchemeAsText];

    if (!this.showAudioVideoCodingVariables) {
      list = list.filter((c) => !this.isAudioVideoCodingVariable(c));
    }

    // Search
    if (focus.status !== 'unique' && this.codingSearchText) {
      const term = this.codingSearchText.toLowerCase();
      list = list.filter(
        (c) =>
          c.id.toLowerCase().includes(term) || (c.label && c.label.toLowerCase().includes(term)),
      );
    }

    // Sort
    return list.sort((a, b) => {
      const aVal = (this.codingSortField === 'id' ? a.id : a.label || a.id).toLowerCase();
      const bVal = (this.codingSortField === 'id' ? b.id : b.label || b.id).toLowerCase();

      const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
      return this.codingSortDir === 'asc' ? cmp : -cmp;
    });
  }

  shouldShowGeneralCodingInstruction(coding: DeepReadonly<CodingAsText>): boolean {
    return Boolean(this.showGeneralCodingInstructions && (coding as any).generalInstructionText);
  }

  getCodingVariableDisplayLabel(coding: DeepReadonly<CodingAsText>): string {
    const id = String(coding.id || '').trim();
    const label = String(coding.label || '').trim();
    if (!label || label.toLowerCase() === id.toLowerCase()) {
      return '';
    }
    if (/^\d+$/.test(id) && /^\d+$/.test(label)) {
      return '';
    }
    return label;
  }

  shouldShowAutomaticCodingRules(code: DeepReadonly<CodingAsText['codes'][number]>): boolean {
    if (!code.ruleSetDescriptions.length) return false;
    if (!this.preferManualCodingInstructions) return true;
    return !(code as any).manualInstructionText;
  }

  codingVariableFocus(
    selectedItem: ReadonlyExplorerItem | null,
    definition: string | null,
  ): CodingVariableFocusResolution {
    const rawVariables = this.getCurrentCodingVariables();
    const variableMatch = this.resolveItemCodingVariable(selectedItem, rawVariables);
    const targetId = variableMatch.reference;
    const emptyResolution = (
      status: Exclude<CodingVariableFocusStatus, 'unique'>,
      matches: CodingAsText[] = [],
    ): CodingVariableFocusResolution => ({
      status,
      targetId,
      internalId: '',
      codingId: '',
      playerTargetId: '',
      usedLegacyFallback: false,
      requestedInternalId: variableMatch.requestedInternalId || '',
      matches,
      isDerived: false,
      sourceIds: [],
    });

    if (variableMatch.status === 'missing-target') {
      return emptyResolution('missing-target');
    }

    const codings = this.currentCodingSchemeAsText || [];
    if (variableMatch.status === 'ambiguous') {
      return emptyResolution(
        'ambiguous',
        variableMatch.matchIndices
          .map((index) => codings[index])
          .filter((coding): coding is CodingAsText => Boolean(coding)),
      );
    }

    if (
      variableMatch.status === 'not-found' &&
      String(selectedItem?.variableReadOnlyId || '').trim()
    ) {
      return emptyResolution('not-found');
    }

    if (variableMatch.status === 'unique' && variableMatch.index !== undefined) {
      const matchIndex = variableMatch.index;
      const textMatch = codings[matchIndex];
      if (!textMatch) {
        return emptyResolution('not-found');
      }

      const effectiveTextMatch = this.enrichDerivedCodingDisplay(
        selectedItem,
        rawVariables,
        variableMatch,
        textMatch,
        codings,
      );

      const rawVariable = variableMatch.variable;
      const sourceType = this.getCodingVariableSourceType(rawVariable);
      return {
        status: 'unique',
        targetId,
        internalId: this.getCodingVariableId(rawVariable, targetId),
        codingId: effectiveTextMatch.id,
        playerTargetId: this.resolvePlayerVariableReference(
          definition,
          rawVariable,
          this.getVisiblePlayerTarget(selectedItem),
        ),
        usedLegacyFallback: Boolean(variableMatch.usedLegacyFallback),
        requestedInternalId: variableMatch.requestedInternalId || '',
        matches: [effectiveTextMatch],
        isDerived: sourceType !== 'BASE' && sourceType !== 'BASE_NO_VALUE',
        sourceIds: this.getCodingVariableSources(rawVariable),
      };
    }

    const normalizedTarget = targetId.toLowerCase();
    const directMatches = codings.filter(
      (coding) =>
        String(coding.id || '')
          .trim()
          .toLowerCase() === normalizedTarget,
    );
    if (directMatches.length !== 1) {
      return emptyResolution(directMatches.length ? 'ambiguous' : 'not-found', directMatches);
    }

    return {
      status: 'unique',
      targetId,
      internalId: targetId,
      codingId: directMatches[0].id,
      playerTargetId: this.getPlayerTarget(selectedItem),
      usedLegacyFallback: false,
      requestedInternalId: '',
      matches: directMatches,
      isDerived: false,
      sourceIds: [],
    };
  }

  codingVariableFocusMessage(
    selectedItem: ReadonlyExplorerItem | null,
    definition: string | null,
  ): string {
    const focus = this.codingVariableFocus(selectedItem, definition);
    if (focus.status === 'missing-target') {
      return 'Dem ausgewählten Item ist keine Variable zugeordnet. Das vollständige Kodierschema wird angezeigt.';
    }
    if (focus.status === 'not-found') {
      return `Die zugeordnete Variable „${focus.targetId}“ wurde im Kodierschema nicht gefunden. Das vollständige Kodierschema wird angezeigt.`;
    }
    if (focus.status === 'ambiguous') {
      return `Die zugeordnete Variable „${focus.targetId}“ kommt im Kodierschema nicht eindeutig vor. Das vollständige Kodierschema wird angezeigt.`;
    }
    return '';
  }

  private isAudioVideoCodingVariable(coding: CodingAsText): boolean {
    const id = coding.id?.toLowerCase() || '';
    const label = coding.label?.toLowerCase() || '';
    return (
      id.includes('audio') ||
      id.includes('video') ||
      label.includes('audio') ||
      label.includes('video')
    );
  }

  toggleCodingSort(field: 'id' | 'label') {
    if (this.codingSortField === field) {
      this.codingSortDir = this.codingSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.codingSortField = field;
      this.codingSortDir = 'asc';
    }
  }

  getCodingSortIndicator(field: 'id' | 'label'): string {
    if (this.codingSortField !== field) return '';
    return this.codingSortDir === 'asc' ? '↑' : '↓';
  }

  getPlayerTarget(item?: ReadonlyExplorerItem | null): string {
    if (!item) return '';
    return this.getVisiblePlayerTarget(item) || this.getItemCodingTarget(item);
  }

  getItemCodingTarget(item?: ReadonlyExplorerItem | null): string {
    if (!item) return '';
    return String(item.variableReadOnlyId || item.sourceVariable || item.variableId || '').trim();
  }

  syncPreviewTargetResolution(definition: string | null, item?: ReadonlyExplorerItem | null) {
    const resolution = this.buildPreviewTargetResolution(definition, item);
    const selectedId = this.getStoredPreviewTargetId(item);
    this.previewTargetResolution = resolution;
    const selectedOption = this.findPreviewTargetOption(definition, selectedId, resolution.options);
    this.selectedPreviewTargetId = selectedOption?.id || '';
    this.customPreviewTargetDraft = selectedId && !selectedOption ? selectedId : '';
  }

  findPreviewTargetOption(
    definition: string | null,
    targetId: string,
    options: PreviewTargetOption[],
  ): PreviewTargetOption | undefined {
    const normalizedTarget = String(targetId || '')
      .trim()
      .toLowerCase();
    if (!normalizedTarget) return undefined;

    const exactOption = options.find((option) => option.id.toLowerCase() === normalizedTarget);
    if (exactOption || !definition) return exactOption;

    const equivalentIdentifiers = new Set(
      this.voudService
        .getFocusIdentifiers(definition, targetId)
        .map((identifier) => identifier.toLowerCase()),
    );
    return options.find((option) => equivalentIdentifiers.has(option.id.toLowerCase()));
  }

  private buildPreviewTargetResolution(
    definition: string | null,
    item?: ReadonlyExplorerItem | null,
  ): PreviewTargetResolution {
    const codingVariables = this.getCurrentCodingVariables();
    const fallbackOptions = this.getAllPreviewTargetOptions(definition, codingVariables);
    const itemTarget = this.getItemCodingTarget(item);
    const visiblePlayerTarget = this.getVisiblePlayerTarget(item);
    if (!itemTarget) {
      return {
        itemTarget: '',
        isDerived: false,
        options: fallbackOptions,
        defaultTargetId: '',
      };
    }

    if (!codingVariables.length) {
      const fallbackTarget = visiblePlayerTarget || itemTarget;
      return {
        itemTarget,
        isDerived: false,
        options: [this.createFallbackPreviewTargetOption(fallbackTarget)],
        defaultTargetId: fallbackTarget,
      };
    }

    const variableMatch = this.resolveItemCodingVariable(item, codingVariables);
    if (variableMatch.status !== 'unique' || !variableMatch.variable) {
      const hasStrictInternalReference = Boolean(String(item?.variableReadOnlyId || '').trim());
      const blocksAutomaticTarget =
        variableMatch.status === 'ambiguous' ||
        (hasStrictInternalReference && variableMatch.status === 'not-found');
      return {
        itemTarget,
        isDerived: false,
        isAmbiguous: variableMatch.status === 'ambiguous',
        blocksAutomaticTarget,
        options: this.dedupePreviewTargetOptions([
          ...fallbackOptions,
          this.createFallbackPreviewTargetOption(itemTarget),
        ]),
        defaultTargetId: blocksAutomaticTarget ? '' : itemTarget,
      };
    }

    const selectedCodingVariable = variableMatch.variable;
    const resolvedItemTarget = this.getCodingVariableId(selectedCodingVariable, itemTarget);
    const derivedOptions = this.collectBasePreviewTargetOptions(
      definition,
      selectedCodingVariable,
      codingVariables,
      visiblePlayerTarget,
    );
    const isDerived = this.isDerivedCodingVariable(selectedCodingVariable);
    const basePlayerTarget = this.resolvePlayerVariableReference(
      definition,
      selectedCodingVariable,
      visiblePlayerTarget,
    );
    const defaultTargetId =
      isDerived && derivedOptions.length ? derivedOptions[0].id : basePlayerTarget;

    return {
      itemTarget: resolvedItemTarget,
      isDerived,
      options: this.dedupePreviewTargetOptions([
        ...derivedOptions,
        ...fallbackOptions,
        this.createPreviewTargetOption(
          selectedCodingVariable,
          isDerived ? resolvedItemTarget : basePlayerTarget,
          !isDerived,
        ),
      ]),
      defaultTargetId,
    };
  }

  private getCurrentCodingVariables(): any[] {
    if (Array.isArray(this.currentCodingScheme)) {
      return this.currentCodingScheme;
    }
    return Array.isArray(this.currentCodingScheme?.variableCodings)
      ? this.currentCodingScheme.variableCodings
      : [];
  }

  refreshCorrectSolutionPrefill(
    selectedItem: ReadonlyExplorerItem | null,
    definition: string | null,
  ): void {
    const variables = this.getCurrentCodingVariables();
    const variableMatch = this.resolveItemCodingVariable(selectedItem, variables);
    if (variableMatch.status !== 'unique' || !variableMatch.variable) {
      this.correctSolutionPrefill = {
        status: 'unavailable',
        responses: [],
        message: 'Für dieses Item konnte keine eindeutige Kodiervariable ermittelt werden.',
      };
      return;
    }
    if (!definition) {
      this.correctSolutionPrefill = {
        status: 'unavailable',
        responses: [],
        message: 'Für dieses Item ist keine auswertbare Player-Definition verfügbar.',
      };
      return;
    }

    this.correctSolutionPrefill = derivePlayerSolutionPrefill(
      variableMatch.variable,
      variables,
      (variable) => {
        const candidates = Array.from(
          new Set(
            [variable?.['alias'], variable?.['id']]
              .map((value) => String(value || '').trim())
              .filter((value) => value.length > 0),
          ),
        );
        for (const candidate of candidates) {
          const target = this.voudService.resolvePlayerResponseTarget(definition!, candidate);
          if (target) return target;
        }
        return undefined;
      },
    );
  }

  createCodingSchemeAsText(codings: any[]): ExplorerCodingAsText[] {
    const codingSchemeAsText = CodingSchemeTextFactory.asText(codings) as ExplorerCodingAsText[];
    codingSchemeAsText.forEach((coding, index) => {
      const rawVariable = codings[index];
      if (!rawVariable) {
        return;
      }

      (coding as any).generalInstructionText = this.sanitizeManualInstruction(
        rawVariable.manualInstruction,
      );
      coding.codes.forEach((code) => {
        const rawCode = rawVariable.codes?.find(
          (candidate: any) =>
            String(candidate?.id === null ? 'null' : candidate?.id) === String(code.id),
        );
        if (rawCode) {
          (code as any).manualInstructionText = this.sanitizeManualInstruction(
            rawCode.manualInstruction,
          );
        }
      });
    });
    return codingSchemeAsText;
  }

  private sanitizeManualInstruction(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }

    const sanitizedHtml = DOMPurify.sanitize(value, {
      USE_PROFILES: { html: true },
    }).trim();
    if (!sanitizedHtml) {
      return null;
    }

    const content = document.createElement('div');
    content.innerHTML = sanitizedHtml;
    const textContent = (content.textContent || '').replace(/\u00a0/g, ' ').trim();
    const hasMeaningfulMedia = Boolean(
      content.querySelector('img, audio, video, svg, math, table'),
    );
    return textContent || hasMeaningfulMedia ? sanitizedHtml : null;
  }

  private resolveItemCodingVariable(
    item: ReadonlyExplorerItem | null | undefined,
    variables: any[],
  ): CodingVariableMatch {
    if (!item) {
      return { status: 'missing-target', reference: '', matchIndices: [] };
    }

    const internalId = String(item.variableReadOnlyId || '').trim();
    if (internalId) {
      const internalMatch = this.resolveCodingVariableReference(internalId, variables, false);
      if (internalMatch.status !== 'not-found') {
        return internalMatch;
      }

      const legacyReference = String(item.sourceVariable || item.variableId || '').trim();
      const legacyMatch = this.resolveUniqueCodingVariableIdentifier(legacyReference, variables);
      if (legacyMatch.status === 'unique') {
        return {
          ...legacyMatch,
          reference: internalId,
          usedLegacyFallback: true,
          requestedInternalId: internalId,
        };
      }

      return internalMatch;
    }

    const legacyReference = String(item.sourceVariable || item.variableId || '').trim();
    return this.resolveCodingVariableReference(legacyReference, variables, true);
  }

  private resolveUniqueCodingVariableIdentifier(
    reference: string,
    variables: any[],
  ): CodingVariableMatch {
    const normalizedReference = String(reference || '')
      .trim()
      .toLowerCase();
    if (!normalizedReference) {
      return { status: 'missing-target', reference: '', matchIndices: [] };
    }

    const matchIndices = variables.flatMap((variable, index) =>
      this.getCodingVariableIdentifiers(variable).some(
        (identifier) => identifier.toLowerCase() === normalizedReference,
      )
        ? [index]
        : [],
    );
    if (matchIndices.length === 1) {
      const index = matchIndices[0];
      return {
        status: 'unique',
        reference: String(reference).trim(),
        variable: variables[index],
        index,
        matchIndices,
      };
    }

    return {
      status: matchIndices.length ? 'ambiguous' : 'not-found',
      reference: String(reference).trim(),
      matchIndices,
    };
  }

  private resolveCodingVariableReference(
    reference: string,
    variables: any[],
    allowAliasFallback: boolean,
  ): CodingVariableMatch {
    const normalizedReference = String(reference || '')
      .trim()
      .toLowerCase();
    if (!normalizedReference) {
      return { status: 'missing-target', reference: '', matchIndices: [] };
    }

    const idMatches = variables.flatMap((variable, index) =>
      String(variable?.id || '')
        .trim()
        .toLowerCase() === normalizedReference
        ? [index]
        : [],
    );
    if (idMatches.length === 1) {
      const index = idMatches[0];
      return {
        status: 'unique',
        reference: String(reference).trim(),
        variable: variables[index],
        index,
        matchIndices: idMatches,
      };
    }
    if (idMatches.length > 1) {
      return {
        status: 'ambiguous',
        reference: String(reference).trim(),
        matchIndices: idMatches,
      };
    }

    if (allowAliasFallback) {
      const aliasMatches = variables.flatMap((variable, index) =>
        String(variable?.alias || '')
          .trim()
          .toLowerCase() === normalizedReference
          ? [index]
          : [],
      );
      if (aliasMatches.length === 1) {
        const index = aliasMatches[0];
        return {
          status: 'unique',
          reference: String(reference).trim(),
          variable: variables[index],
          index,
          matchIndices: aliasMatches,
        };
      }
      if (aliasMatches.length > 1) {
        return {
          status: 'ambiguous',
          reference: String(reference).trim(),
          matchIndices: aliasMatches,
        };
      }
    }

    return {
      status: 'not-found',
      reference: String(reference).trim(),
      matchIndices: [],
    };
  }

  private enrichDerivedCodingDisplay(
    item: ReadonlyExplorerItem | null | undefined,
    variables: any[],
    identityMatch: CodingVariableMatch,
    identityCoding: CodingAsText,
    codings: CodingAsText[],
  ): CodingAsText {
    if (
      identityMatch.status !== 'unique' ||
      !identityMatch.variable ||
      !this.isDerivedCodingVariable(identityMatch.variable)
    ) {
      return identityCoding;
    }

    const visibleReference = this.getVisiblePlayerTarget(item).toLowerCase();
    if (!visibleReference) return identityCoding;

    for (const sourceReference of this.getCodingVariableSources(identityMatch.variable)) {
      const sourceMatch = this.resolveCodingVariableReference(sourceReference, variables, true);
      if (
        sourceMatch.status !== 'unique' ||
        !sourceMatch.variable ||
        sourceMatch.index === undefined
      ) {
        continue;
      }

      const matchesVisibleReference = this.getCodingVariableIdentifiers(sourceMatch.variable).some(
        (identifier) => identifier.toLowerCase() === visibleReference,
      );
      if (!matchesVisibleReference) continue;

      const sourceCoding = codings[sourceMatch.index];
      if (!sourceCoding) return identityCoding;

      const identityGeneralInstruction = (identityCoding as any).generalInstructionText;
      const sourceGeneralInstruction = (sourceCoding as any).generalInstructionText;
      const inheritGeneralInstruction = !identityGeneralInstruction && sourceGeneralInstruction;
      const inheritCodes = !identityCoding.codes.length && sourceCoding.codes.length;
      if (!inheritGeneralInstruction && !inheritCodes) return identityCoding;

      return {
        ...identityCoding,
        ...(inheritGeneralInstruction
          ? {
              generalInstructionText: sourceGeneralInstruction,
            }
          : {}),
        ...(inheritCodes ? { codes: sourceCoding.codes } : {}),
      } as CodingAsText;
    }

    return identityCoding;
  }

  private getAllPreviewTargetOptions(
    definition: string | null,
    variables: any[],
  ): PreviewTargetOption[] {
    return this.dedupePreviewTargetOptions(
      variables.map((variable) => {
        const playerTarget = this.resolvePlayerVariableReference(definition, variable);
        return this.createPreviewTargetOption(variable, playerTarget, true);
      }),
    );
  }

  private collectBasePreviewTargetOptions(
    definition: string | null,
    variable: any,
    variables: any[],
    preferredReference = '',
    visited = new Set<string>(),
  ): PreviewTargetOption[] {
    const variableId = this.getCodingVariableId(variable);
    const visitKey = variableId.toLowerCase();
    if (visitKey) {
      if (visited.has(visitKey)) {
        return [];
      }
      visited.add(visitKey);
    }

    const deriveSources = this.getCodingVariableSources(variable);
    if (!deriveSources.length) {
      const playerTarget = this.resolvePlayerVariableReference(definition, variable, variableId);
      return [this.createPreviewTargetOption(variable, playerTarget, true)];
    }

    const options = deriveSources.flatMap((sourceId) => {
      const sourceMatch = this.resolveCodingVariableReference(sourceId, variables, true);
      if (sourceMatch.status !== 'unique' || !sourceMatch.variable) {
        return [this.createFallbackPreviewTargetOption(sourceId)];
      }
      const sourceVariable = sourceMatch.variable;
      const sourcePlayerReference = this.getPreferredDerivedSourceReference(
        sourceVariable,
        sourceId,
        preferredReference,
      );
      if (!this.isDerivedCodingVariable(sourceVariable)) {
        const playerTarget = this.resolvePlayerVariableReference(
          definition,
          sourceVariable,
          sourcePlayerReference,
        );
        return [this.createPreviewTargetOption(sourceVariable, playerTarget, true)];
      }
      return this.collectBasePreviewTargetOptions(
        definition,
        sourceVariable,
        variables,
        sourcePlayerReference,
        new Set(visited),
      );
    });

    return this.dedupePreviewTargetOptions(options);
  }

  private getPreferredDerivedSourceReference(
    sourceVariable: any,
    sourceReference: string,
    parentPlayerReference: string,
  ): string {
    const sourceId = String(sourceReference || '').trim();
    const alias = String(sourceVariable?.alias || '').trim();
    if (!alias) return sourceId;

    const referenceScore = (candidate: string): number => {
      const normalizedCandidate = candidate.trim().toLowerCase().replace(/^_+/, '');
      const normalizedParent = parentPlayerReference.trim().toLowerCase().replace(/^_+/, '');
      if (!normalizedCandidate || !normalizedParent) return 0;
      if (normalizedCandidate === normalizedParent) return 2;
      return normalizedCandidate.startsWith(normalizedParent) ? 1 : 0;
    };

    return referenceScore(alias) > referenceScore(sourceId) ? alias : sourceId;
  }

  private createPreviewTargetOption(
    variable: any,
    fallbackId = '',
    useFallbackAsTarget = false,
  ): PreviewTargetOption {
    const id = useFallbackAsTarget
      ? String(fallbackId || '').trim() || this.getCodingVariableId(variable)
      : this.getCodingVariableId(variable, fallbackId);
    const label = this.getCodingVariableLabel(variable, id);
    return {
      id,
      label: this.formatPreviewTargetLabel(id, label),
      sourceType: this.getCodingVariableSourceType(variable),
    };
  }

  private createFallbackPreviewTargetOption(id: string): PreviewTargetOption {
    return {
      id,
      label: this.formatPreviewTargetLabel(id, id),
      sourceType: 'BASE',
    };
  }

  private dedupePreviewTargetOptions(options: PreviewTargetOption[]): PreviewTargetOption[] {
    const seen = new Set<string>();
    const deduped: PreviewTargetOption[] = [];

    options.forEach((option) => {
      const id = String(option.id || '').trim();
      if (!id) {
        return;
      }
      const key = id.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      deduped.push({
        ...option,
        id,
      });
    });

    return deduped;
  }

  private getCodingVariableIdentifiers(variable: any): string[] {
    return Array.from(
      new Set(
        [variable?.id, variable?.alias]
          .map((value) => String(value || '').trim())
          .filter((value) => value.length > 0),
      ),
    );
  }

  buildPrintLabelOverrides(
    definition: string | null,
    items: readonly ReadonlyExplorerItem[],
    unitId: string,
  ): Record<string, string> {
    const variables = this.getCurrentCodingVariables();

    if (!variables.length || !unitId) return {};

    const labelsByIdentifier = new Map<string, Set<string>>();
    items
      .filter((item) => item.unitId === unitId)
      .forEach((item) => {
        const match = this.resolveItemCodingVariable(item, variables);
        if (match.status !== 'unique' || !match.variable) return;

        const itemLabel = this.formatPrintItemId(item);
        this.collectBaseCodingVariables(match.variable, variables).forEach((variable) => {
          const preferredReference =
            variable === match.variable ? this.getVisiblePlayerTarget(item) : '';
          const playerReference = this.resolvePlayerVariableReference(
            definition,
            variable,
            preferredReference,
          );
          if (!playerReference) return;

          const key = playerReference.toLowerCase();
          const labels = labelsByIdentifier.get(key) || new Set<string>();
          labels.add(itemLabel);
          labelsByIdentifier.set(key, labels);
        });
      });

    const overrides: Record<string, string> = {};
    labelsByIdentifier.forEach((labels, identifier) => {
      if (labels.size === 1) {
        overrides[identifier] = Array.from(labels)[0];
      }
    });
    return overrides;
  }

  private collectBaseCodingVariables(
    variable: any,
    variables: any[],
    visited = new Set<string>(),
  ): any[] {
    const variableId = this.getCodingVariableId(variable).toLowerCase();
    if (variableId) {
      if (visited.has(variableId)) return [];
      visited.add(variableId);
    }

    const sources = this.getCodingVariableSources(variable);
    if (!sources.length) return [variable];

    return sources.flatMap((sourceId) => {
      const sourceMatch = this.resolveCodingVariableReference(sourceId, variables, true);
      if (sourceMatch.status !== 'unique' || !sourceMatch.variable) return [];
      return this.collectBaseCodingVariables(sourceMatch.variable, variables, new Set(visited));
    });
  }

  private formatPrintItemId(item: ReadonlyExplorerItem): string {
    const unitId = String(item.unitId || '').trim();
    const itemId = String(item.itemId || '').trim();
    if (!unitId) return itemId;
    if (item.useUnitAliasAsPrefix === false) return itemId;

    const withoutRepeatedUnit = itemId.toLowerCase().startsWith(unitId.toLowerCase())
      ? itemId.slice(unitId.length).replace(/^[_-]+/, '')
      : itemId;
    return `${unitId}${withoutRepeatedUnit}`;
  }

  private getVisiblePlayerTarget(item?: ReadonlyExplorerItem | null): string {
    if (!item) return '';
    return String(item.sourceVariable || item.variableId || '').trim();
  }

  private resolvePlayerVariableReference(
    definition: string | null,
    variable: any,
    preferredReference = '',
  ): string {
    const candidates = Array.from(
      new Set(
        [preferredReference, variable?.alias, variable?.id]
          .map((value) => String(value || '').trim())
          .filter((value) => value.length > 0),
      ),
    );
    if (!candidates.length) return '';

    if (definition) {
      const definitionTarget = candidates.find((candidate) =>
        Boolean(this.voudService.resolvePlayerTargetLocation(definition!, candidate)),
      );
      if (definitionTarget) return definitionTarget;
    }

    return candidates[0];
  }

  private getCodingVariableId(variable: any, fallbackId = ''): string {
    const directId = String(variable?.id || '').trim();
    if (directId) {
      return directId;
    }
    const alias = String(variable?.alias || '').trim();
    return alias || fallbackId;
  }

  private getCodingVariableLabel(variable: any, fallbackId: string): string {
    const variableId = this.getCodingVariableId(variable, fallbackId);
    const variableIndex = this.getCurrentCodingVariables().indexOf(variable);
    const indexedCoding =
      variableIndex >= 0 ? this.currentCodingSchemeAsText?.[variableIndex] : undefined;
    const indexedTextLabel = indexedCoding ? this.getCodingVariableDisplayLabel(indexedCoding) : '';
    if (indexedTextLabel) {
      return indexedTextLabel;
    }

    const textLabel = String(
      this.currentCodingSchemeAsText?.find((coding) => coding.id === variableId)?.label || '',
    ).trim();
    if (textLabel) {
      return textLabel;
    }

    const rawLabel = variable?.label;
    if (typeof rawLabel === 'string' && rawLabel.trim()) {
      return rawLabel.trim();
    }

    if (Array.isArray(rawLabel)) {
      const localizedLabel = rawLabel
        .map((entry: any) => String(entry?.value || '').trim())
        .find((value: string) => value.length > 0);
      if (localizedLabel) {
        return localizedLabel;
      }
    }

    return fallbackId;
  }

  private getCodingVariableSourceType(variable: any): string {
    const sourceType = String(variable?.sourceType || '')
      .trim()
      .toUpperCase();
    return sourceType || 'BASE';
  }

  private getCodingVariableSources(variable: any): string[] {
    if (!Array.isArray(variable?.deriveSources)) {
      return [];
    }
    return variable.deriveSources
      .map((value: unknown) => String(value || '').trim())
      .filter((value: string) => value.length > 0);
  }

  private isDerivedCodingVariable(variable: any): boolean {
    return this.getCodingVariableSources(variable).length > 0;
  }

  private formatPreviewTargetLabel(id: string, label: string): string {
    return label && label !== id ? `${label} (${id})` : id;
  }

  getStoredPreviewTargetId(item?: ReadonlyExplorerItem | null): string {
    return String(item?.previewTargetId || '').trim();
  }
}
