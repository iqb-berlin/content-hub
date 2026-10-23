import { BadRequestException, Injectable } from "@nestjs/common";
import { VomdItemData } from "../files/unit-parser.service";
import {
  buildItemRowKey,
  normalizeItemSubId,
  parseItemRowKeyParts,
} from "./item-row-key.util";

export type ImportAction = "keep" | "set" | "clear";
export type ImportScope = "row" | "item" | "unit";

type ImportedScalarProperty =
  | "empiricalDifficulty"
  | "bista"
  | "infit"
  | "discrimination"
  | "solutionRate"
  | "itemTimeSeconds"
  | "stimulusTimeSeconds";

type ImportedTextProperty = "textComplexity" | "competenceLevel";

type ImportedProperty =
  | ImportedScalarProperty
  | ImportedTextProperty
  | "bookletOccurrences"
  | "itemUuid"
  | "subId";

interface ImportMutationBase {
  scope: ImportScope;
  property: ImportedProperty;
}

export type ImportMutation =
  | (ImportMutationBase & { action: "keep" })
  | (ImportMutationBase & { action: "clear"; targetKeys: string[] })
  | (ImportMutationBase & {
      action: "set";
      targetKeys: string[];
      value: unknown;
    });

export interface ItemParameterImportPlan {
  mutations: ImportMutation[];
  updated: number;
  failed: Array<{ csvRow: string; reason: string }>;
  successes: Array<Record<string, unknown>>;
  warnings?: ItemParameterImportWarning[];
  requiresConfirmation?: boolean;
}

export interface ItemParameterImportWarning {
  code: "BOOKLET_OCCURRENCES_SKIPPED";
  message: string;
}

export interface ItemParameterImportRequest {
  fileBuffer: Buffer;
  items: VomdItemData[];
  itemProperties: Record<string, Record<string, unknown>>;
  requireEmpiricalDifficulty?: boolean;
  confirmWarnings?: boolean;
}

export interface ItemParameterImportResult {
  updated: number;
  failed: Array<{ csvRow: string; reason: string }>;
  successes: Array<Record<string, unknown>>;
  nextItemProperties: Record<string, Record<string, unknown>>;
  warnings?: ItemParameterImportWarning[];
  requiresConfirmation?: boolean;
}

const IMPORTED_SCALAR_COLUMNS: Array<{
  header: string;
  property: ImportedScalarProperty;
  scope: ImportScope;
  nonNegative?: boolean;
  maxDecimalPlaces?: number;
}> = [
  { header: "est", property: "empiricalDifficulty", scope: "row" },
  {
    header: "bista",
    property: "bista",
    scope: "row",
    maxDecimalPlaces: 2,
  },
  { header: "infit", property: "infit", scope: "row" },
  { header: "discrimination", property: "discrimination", scope: "row" },
  { header: "solution_rate", property: "solutionRate", scope: "row" },
  {
    header: "item_time_s",
    property: "itemTimeSeconds",
    scope: "item",
    nonNegative: true,
  },
  {
    header: "stimulus_time_s",
    property: "stimulusTimeSeconds",
    scope: "unit",
    nonNegative: true,
  },
];

const IMPORTED_TEXT_COLUMNS: Array<{
  header: string;
  property: ImportedTextProperty;
  scope: "row" | "item";
}> = [
  {
    header: "text_complexity",
    property: "textComplexity",
    scope: "row",
  },
  {
    header: "kstufe",
    property: "competenceLevel",
    scope: "item",
  },
];

const VALID_COMPETENCE_LEVELS = new Set(["I", "II", "III", "IV", "V"]);

const RESERVED_LEGACY_SUB_ID_HEADERS = new Set([
  "item",
  "sub_id",
  ...IMPORTED_SCALAR_COLUMNS.map((definition) => definition.header),
  ...IMPORTED_TEXT_COLUMNS.map((definition) => definition.header),
  "booklet",
  "position",
]);

interface ImportGroup {
  match: VomdItemData;
  subId: string;
  rowIndexes: number[];
  scalars: Map<ImportedScalarProperty, Set<number>>;
  texts: Map<ImportedTextProperty, Set<string>>;
  occurrences: Map<string, BookletOccurrence>;
  emptyOccurrenceRows: number[];
}

interface BookletOccurrence {
  booklet: string;
  position: number | null;
}

@Injectable()
export class ItemParameterImportPipeline {
  execute(request: ItemParameterImportRequest): ItemParameterImportResult {
    const plan = this.buildPlan(request);
    return {
      updated: plan.updated,
      failed: plan.failed,
      successes: plan.successes,
      nextItemProperties: this.applyPlan(request.itemProperties, plan),
      ...(plan.warnings?.length ? { warnings: plan.warnings } : {}),
      ...(plan.requiresConfirmation !== undefined
        ? { requiresConfirmation: plan.requiresConfirmation }
        : {}),
    };
  }

  buildPlan(request: ItemParameterImportRequest): ItemParameterImportPlan {
    const { fileBuffer, items } = request;
    const requireEmpiricalDifficulty =
      request.requireEmpiricalDifficulty === true;
    const lines = fileBuffer.toString("utf-8").split(/\r?\n/);
    const headers = this.parseCsvLine(lines[0] || "").map((header, index) =>
      header
        .replace(index === 0 ? /^\uFEFF/ : /$^/, "")
        .trim()
        .toLowerCase(),
    );
    const itemIdx = headers.indexOf("item");
    const estIdx = headers.indexOf("est");
    const canonicalSubIdIdx = headers.indexOf("sub_id");
    const subIdIdx =
      canonicalSubIdIdx >= 0
        ? canonicalSubIdIdx
        : requireEmpiricalDifficulty &&
            headers.length > 2 &&
            !RESERVED_LEGACY_SUB_ID_HEADERS.has(headers[1])
          ? 1
          : -1;
    const declaredBookletIdx = headers.indexOf("booklet");
    const declaredPositionIdx = headers.indexOf("position");
    const hasBookletColumn = declaredBookletIdx >= 0;
    const hasPositionColumn = declaredPositionIdx >= 0;

    if (itemIdx === -1 || (requireEmpiricalDifficulty && estIdx < 0)) {
      throw new BadRequestException(
        requireEmpiricalDifficulty
          ? 'CSV must contain "item" and "est" columns'
          : 'CSV must contain an "item" column',
      );
    }
    const scalarColumns = IMPORTED_SCALAR_COLUMNS.map((definition) => ({
      ...definition,
      index: headers.indexOf(definition.header),
    })).filter((definition) => definition.index >= 0);
    const textColumns = IMPORTED_TEXT_COLUMNS.map((definition) => ({
      ...definition,
      index: headers.indexOf(definition.header),
    })).filter((definition) => definition.index >= 0);

    const occurrenceColumnState = this.resolveOccurrenceColumnState(
      lines,
      declaredBookletIdx,
      declaredPositionIdx,
      scalarColumns.length > 0 || textColumns.length > 0,
    );
    const bookletIdx = occurrenceColumnState.importOccurrences
      ? declaredBookletIdx
      : -1;
    const positionIdx = occurrenceColumnState.importOccurrences
      ? declaredPositionIdx
      : -1;
    const warnings = occurrenceColumnState.warning
      ? [occurrenceColumnState.warning]
      : [];

    if (!scalarColumns.length && !textColumns.length && bookletIdx < 0) {
      throw new BadRequestException(
        'CSV must contain at least one supported item parameter column: "est", "bista", "infit", "discrimination", "solution_rate", "item_time_s", "stimulus_time_s", "text_complexity", "kstufe", or "booklet"',
      );
    }

    const failed: Array<{ csvRow: string; reason: string }> = [];
    const successes: Array<Record<string, unknown>> = [];
    const matchedItemModes = new Map<
      string,
      { mode: "standard" | "partial"; rowIndex: number }
    >();
    const groups = new Map<string, ImportGroup>();

    for (let index = 1; index < lines.length; index++) {
      const line = lines[index].trim();
      if (!line) continue;

      const row = this.parseCsvLine(line);
      if (row.every((cell) => cell.trim() === "")) continue;
      const itemValRaw = row[itemIdx]?.trim() || "";
      const subId = subIdIdx >= 0 ? normalizeItemSubId(row[subIdIdx]) : "";
      if (!itemValRaw) {
        failed.push({ csvRow: `Zeile ${index + 1}`, reason: "Item fehlt" });
        continue;
      }
      if (requireEmpiricalDifficulty) {
        const empiricalValue = Number(
          (row[estIdx] || "").trim().replace(",", "."),
        );
        if (!Number.isFinite(empiricalValue)) continue;
      }

      const match = this.findItem(items, itemValRaw);
      if (!match) {
        failed.push({
          csvRow: itemValRaw,
          reason: "Kein passendes Item gefunden",
        });
        continue;
      }

      const rowKey = buildItemRowKey(match.uuid, subId);
      const mode = subId ? "partial" : "standard";
      let group = groups.get(rowKey);
      if (!group) {
        group = {
          match,
          subId,
          rowIndexes: [],
          scalars: new Map(),
          texts: new Map(),
          occurrences: new Map(),
          emptyOccurrenceRows: [],
        };
        groups.set(rowKey, group);
      }
      if (
        !hasBookletColumn &&
        !hasPositionColumn &&
        group.rowIndexes.length > 0
      ) {
        throw new BadRequestException(
          `Konflikt: Die Zeile für Item "${match.itemId}"${subId ? ` und Sub-ID "${subId}"` : ""} kommt mehrfach in der CSV vor.`,
        );
      }

      const rowScalars = new Map<ImportedScalarProperty, number>();
      const rowTexts = new Map<ImportedTextProperty, string>();
      let invalidReason = "";
      for (const definition of scalarColumns) {
        const rawValue = row[definition.index]?.trim() || "";
        if (!rawValue) continue;
        const value = Number(rawValue.replace(",", "."));
        if (!Number.isFinite(value)) {
          invalidReason = `Ungültiger Zahlenwert in ${definition.header}`;
          break;
        }
        if (
          definition.maxDecimalPlaces !== undefined &&
          !this.hasAtMostDecimalPlaces(rawValue, definition.maxDecimalPlaces)
        ) {
          invalidReason = `${definition.header} darf höchstens ${definition.maxDecimalPlaces} Nachkommastellen haben`;
          break;
        }
        if (definition.nonNegative && value < 0) {
          invalidReason = `${definition.header} darf nicht negativ sein`;
          break;
        }
        rowScalars.set(definition.property, value);
      }
      for (const definition of textColumns) {
        const rawValue = row[definition.index]?.trim() || "";
        const value =
          definition.property === "competenceLevel"
            ? rawValue.toUpperCase()
            : rawValue;
        if (
          value &&
          definition.property === "competenceLevel" &&
          !VALID_COMPETENCE_LEVELS.has(value)
        ) {
          invalidReason = "kstufe muss I, II, III, IV oder V sein";
          break;
        }
        if (value) rowTexts.set(definition.property, value);
      }
      if (invalidReason) {
        failed.push({ csvRow: itemValRaw, reason: invalidReason });
        if (!group.rowIndexes.length) groups.delete(rowKey);
        continue;
      }

      const occurrence = this.parseOccurrence(
        row,
        bookletIdx,
        positionIdx,
        group,
        match,
        subId,
        itemValRaw,
        failed,
      );
      if (occurrence === null) {
        if (!group.rowIndexes.length) groups.delete(rowKey);
        continue;
      }

      const previousMode = matchedItemModes.get(match.uuid);
      if (previousMode && previousMode.mode !== mode) {
        throw new BadRequestException(
          `Konflikt: Das Item "${match.itemId}" wird in derselben CSV sowohl mit als auch ohne Sub-ID verwendet (Zeile ${previousMode.rowIndex + 1} und Zeile ${index + 1}). Bitte verwenden Sie pro Item nur eine Darstellungsform.`,
        );
      }
      matchedItemModes.set(match.uuid, { mode, rowIndex: index });
      rowScalars.forEach((value, property) => {
        const values = group.scalars.get(property) || new Set<number>();
        values.add(value);
        group.scalars.set(property, values);
      });
      rowTexts.forEach((value, property) => {
        const values = group.texts.get(property) || new Set<string>();
        values.add(value);
        group.texts.set(property, values);
      });
      if (occurrence && "value" in occurrence) {
        group.occurrences.set(occurrence.key, occurrence.value);
      } else if (occurrence && "empty" in occurrence) {
        group.emptyOccurrenceRows.push(index);
      }
      group.rowIndexes.push(index);
    }

    this.validateGroupConflicts(groups);
    const itemTimesByUuid = this.collectScopedValues(
      groups,
      scalarColumns,
      "itemTimeSeconds",
      (group) => group.match.uuid,
    );
    const stimulusTimesByUnit = this.collectScopedValues(
      groups,
      scalarColumns,
      "stimulusTimeSeconds",
      (group) => group.match.unitId,
    );
    const competenceLevelsByItem = this.collectScopedTextValues(
      groups,
      textColumns,
      "competenceLevel",
      (group) => group.match.uuid,
    );
    this.validateScopedConflicts(itemTimesByUuid, "item");
    this.validateScopedConflicts(stimulusTimesByUnit, "unit");
    this.validateCompetenceLevelConflicts(competenceLevelsByItem);

    const mutations: ImportMutation[] = [];
    const importedScalarProperties = new Set(
      scalarColumns.map((definition) => definition.property),
    );
    for (const definition of IMPORTED_SCALAR_COLUMNS) {
      if (importedScalarProperties.has(definition.property)) continue;
      mutations.push({
        action: "keep",
        scope: definition.scope,
        property: definition.property,
      });
    }
    const importedTextProperties = new Set(
      textColumns.map((definition) => definition.property),
    );
    for (const definition of IMPORTED_TEXT_COLUMNS) {
      if (importedTextProperties.has(definition.property)) continue;
      mutations.push({
        action: "keep",
        scope: definition.scope,
        property: definition.property,
      });
    }
    if (bookletIdx < 0) {
      mutations.push({
        action: "keep",
        scope: "row",
        property: "bookletOccurrences",
      });
    }
    const importedRowScalarProperties = scalarColumns.filter(
      (definition) => definition.scope === "row",
    );
    const importedRowTextProperties = textColumns.filter(
      (definition) => definition.scope === "row",
    );
    const importedRowMutationDefinitions: Array<{
      property: ImportedProperty;
      scope: ImportScope;
    }> = [...importedRowScalarProperties, ...importedRowTextProperties].map(
      (definition) => ({
        property: definition.property,
        scope: definition.scope,
      }),
    );
    if (bookletIdx >= 0) {
      importedRowMutationDefinitions.push({
        property: "bookletOccurrences",
        scope: "row",
      });
    }

    for (const [rowKey, group] of groups.entries()) {
      const partialRowKeys = this.getPartialCreditRowKeys(
        request.itemProperties,
        group.match.uuid,
      );
      const affectedRowKeys =
        !group.subId && partialRowKeys.length ? partialRowKeys : [rowKey];

      if (group.subId || affectedRowKeys.length > 1) {
        for (const definition of importedRowMutationDefinitions) {
          mutations.push({
            action: "clear",
            scope: definition.scope,
            property: definition.property,
            targetKeys: [group.match.uuid],
          });
        }
      }

      if (group.subId) {
        mutations.push(
          {
            action: "set",
            scope: "row",
            property: "itemUuid",
            targetKeys: [rowKey],
            value: group.match.uuid,
          },
          {
            action: "set",
            scope: "row",
            property: "subId",
            targetKeys: [rowKey],
            value: group.subId,
          },
        );
      }

      for (const definition of importedRowScalarProperties) {
        const values = group.scalars.get(definition.property);
        if (values?.size) {
          mutations.push({
            action: "set",
            scope: "row",
            property: definition.property,
            targetKeys: affectedRowKeys,
            value: Array.from(values)[0],
          });
        } else {
          mutations.push({
            action: "clear",
            scope: "row",
            property: definition.property,
            targetKeys: affectedRowKeys,
          });
        }
      }
      for (const definition of importedRowTextProperties) {
        const values = group.texts.get(definition.property);
        if (values?.size) {
          mutations.push({
            action: "set",
            scope: "row",
            property: definition.property,
            targetKeys: affectedRowKeys,
            value: Array.from(values)[0],
          });
        } else {
          mutations.push({
            action: "clear",
            scope: "row",
            property: definition.property,
            targetKeys: affectedRowKeys,
          });
        }
      }

      const importedBookletOccurrences =
        bookletIdx >= 0
          ? this.sortBookletOccurrences(Array.from(group.occurrences.values()))
          : undefined;
      let reportedBookletOccurrences = importedBookletOccurrences;
      if (importedBookletOccurrences) {
        const resolvedByTarget = affectedRowKeys.map((targetKey) => {
          const existingOccurrences =
            request.itemProperties[targetKey]?.bookletOccurrences ??
            request.itemProperties[group.match.uuid]?.bookletOccurrences;
          const resolved = this.preserveKnownOccurrencePositions(
            importedBookletOccurrences,
            existingOccurrences,
          );
          mutations.push({
            action: "set",
            scope: "row",
            property: "bookletOccurrences",
            targetKeys: [targetKey],
            value: resolved,
          });
          return resolved;
        });
        if (resolvedByTarget.length === 1) {
          reportedBookletOccurrences = resolvedByTarget[0];
        }
      }

      successes.push({
        itemId: group.match.itemId,
        unitId: group.match.unitId,
        ...(affectedRowKeys.length === 1 ? { rowKey: affectedRowKeys[0] } : {}),
        affectedRowKeys,
        subId: group.subId || undefined,
        ...(!requireEmpiricalDifficulty
          ? {
              fields: [
                ...scalarColumns.map((definition) => definition.header),
                ...textColumns.map((definition) => definition.header),
                ...(bookletIdx >= 0
                  ? ["booklet", ...(hasPositionColumn ? ["position"] : [])]
                  : []),
              ],
            }
          : {}),
        ...(group.scalars.get("empiricalDifficulty")?.size
          ? {
              value: Array.from(
                group.scalars.get("empiricalDifficulty") as Set<number>,
              )[0],
            }
          : {}),
        ...(!requireEmpiricalDifficulty && bookletIdx >= 0
          ? { bookletOccurrences: reportedBookletOccurrences }
          : {}),
      });
    }

    this.addItemScopeMutations(
      mutations,
      itemTimesByUuid,
      request.itemProperties,
    );
    this.addCompetenceLevelMutations(
      mutations,
      competenceLevelsByItem,
      request.itemProperties,
    );
    this.addUnitScopeMutations(
      mutations,
      stimulusTimesByUnit,
      items,
      request.itemProperties,
    );

    return {
      mutations,
      updated: groups.size,
      failed,
      successes,
      ...(warnings.length ? { warnings } : {}),
      ...(warnings.length
        ? { requiresConfirmation: request.confirmWarnings !== true }
        : {}),
    };
  }

  private resolveOccurrenceColumnState(
    lines: string[],
    bookletIdx: number,
    positionIdx: number,
    hasParameterColumns: boolean,
  ): {
    importOccurrences: boolean;
    warning?: ItemParameterImportWarning;
  } {
    const hasBookletColumn = bookletIdx >= 0;
    const hasPositionColumn = positionIdx >= 0;
    if (!hasBookletColumn && !hasPositionColumn) {
      return { importOccurrences: false };
    }

    if (!hasBookletColumn) {
      return {
        importOccurrences: false,
        warning: {
          code: "BOOKLET_OCCURRENCES_SKIPPED",
          message:
            'Die Spalte "booklet" fehlt. Booklet-Zuordnungen werden nicht importiert; bereits vorhandene Zuordnungen bleiben unverändert.',
        },
      };
    }

    let hasBookletValue = false;
    let hasPositionWithoutBooklet = false;
    for (let index = 1; index < lines.length; index++) {
      const line = lines[index].trim();
      if (!line) continue;
      const row = this.parseCsvLine(line);
      const booklet = row[bookletIdx]?.trim() || "";
      const position = positionIdx >= 0 ? row[positionIdx]?.trim() || "" : "";
      if (booklet) hasBookletValue = true;
      if (!booklet && position) hasPositionWithoutBooklet = true;
    }

    if (
      !hasPositionWithoutBooklet &&
      (hasBookletValue || !hasParameterColumns)
    ) {
      return { importOccurrences: true };
    }

    return {
      importOccurrences: false,
      warning: {
        code: "BOOKLET_OCCURRENCES_SKIPPED",
        message: hasPositionWithoutBooklet
          ? 'Mindestens eine Zeile enthält eine "position" ohne "booklet". Alle Booklet-Zuordnungen werden übersprungen; bereits vorhandene Zuordnungen bleiben unverändert.'
          : 'Die Spalte "booklet" enthält keine Zuordnung. Booklet-Zuordnungen werden nicht importiert; bereits vorhandene Zuordnungen bleiben unverändert.',
      },
    };
  }

  applyPlan(
    source: Record<string, Record<string, unknown>>,
    plan: ItemParameterImportPlan,
  ): Record<string, Record<string, unknown>> {
    const next = this.cloneItemProperties(source);
    for (const mutation of plan.mutations) {
      if (mutation.action === "keep") continue;
      for (const targetKey of mutation.targetKeys) {
        if (mutation.action === "set") {
          next[targetKey] = { ...(next[targetKey] || {}) };
          next[targetKey][mutation.property] = mutation.value;
        } else if (next[targetKey]) {
          next[targetKey] = { ...next[targetKey] };
          delete next[targetKey][mutation.property];
        }
      }
    }
    return next;
  }

  private findItem(
    items: VomdItemData[],
    rawItemId: string,
  ): VomdItemData | undefined {
    const normalizedCsvItem = this.normalizeItemReference(rawItemId);
    return items.find((item) => {
      const combinedName1 =
        this.normalizeItemReference(item.unitId) +
        this.normalizeItemReference(item.itemId);
      const combinedName2 =
        this.normalizeItemReference(item.unitLabel) +
        this.normalizeItemReference(item.itemId);
      return (
        this.normalizeItemReference(item.itemId) === normalizedCsvItem ||
        combinedName1 === normalizedCsvItem ||
        combinedName2 === normalizedCsvItem
      );
    });
  }

  private normalizeItemReference(value: string): string {
    return (value || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  }

  private hasAtMostDecimalPlaces(
    rawValue: string,
    maxDecimalPlaces: number,
  ): boolean {
    const decimalPattern = new RegExp(
      `^[+-]?\\d+(?:[.,]\\d{1,${maxDecimalPlaces}})?$`,
    );
    return decimalPattern.test(rawValue);
  }

  private parseOccurrence(
    row: string[],
    bookletIdx: number,
    positionIdx: number,
    group: ImportGroup,
    match: VomdItemData,
    subId: string,
    itemValRaw: string,
    failed: Array<{ csvRow: string; reason: string }>,
  ):
    | { key: string; value: BookletOccurrence }
    | { empty: true }
    | undefined
    | null {
    if (bookletIdx < 0) return undefined;
    const booklet = row[bookletIdx]?.trim() || "";
    const rawPosition = positionIdx >= 0 ? row[positionIdx]?.trim() || "" : "";
    if (!booklet && !rawPosition) {
      if (group.emptyOccurrenceRows.length > 0) {
        throw new BadRequestException(
          `Konflikt: Die leere Booklet-Zuordnung für Item "${match.itemId}"${subId ? ` und Sub-ID "${subId}"` : ""} kommt mehrfach vor.`,
        );
      }
      return { empty: true };
    }
    if (!booklet) {
      failed.push({
        csvRow: itemValRaw,
        reason:
          "Eine Position darf nur gemeinsam mit einem Booklet gesetzt sein",
      });
      return null;
    }
    if (!rawPosition) {
      const key = `${booklet}\u0000`;
      if (group.occurrences.has(key)) {
        throw new BadRequestException(
          `Konflikt: Booklet "${booklet}" ohne Position kommt für Item "${match.itemId}"${subId ? ` und Sub-ID "${subId}"` : ""} mehrfach vor.`,
        );
      }
      return { key, value: { booklet, position: null } };
    }
    const position = Number(rawPosition);
    if (!Number.isInteger(position) || position <= 0) {
      failed.push({
        csvRow: itemValRaw,
        reason: "Position muss eine positive Ganzzahl sein",
      });
      return null;
    }
    const key = `${booklet}\u0000${position}`;
    if (group.occurrences.has(key)) {
      throw new BadRequestException(
        `Konflikt: Booklet "${booklet}" und Position ${position} kommen für Item "${match.itemId}"${subId ? ` und Sub-ID "${subId}"` : ""} mehrfach vor.`,
      );
    }
    return { key, value: { booklet, position } };
  }

  private preserveKnownOccurrencePositions(
    imported: BookletOccurrence[],
    existingValue: unknown,
  ): BookletOccurrence[] {
    const existing = this.normalizeBookletOccurrences(existingValue);
    const resolved = imported.flatMap((occurrence) => {
      if (occurrence.position !== null) return [occurrence];
      const matchingExisting = existing.filter(
        (candidate) => candidate.booklet === occurrence.booklet,
      );
      return matchingExisting.length ? matchingExisting : [occurrence];
    });
    return this.sortBookletOccurrences(resolved);
  }

  private normalizeBookletOccurrences(value: unknown): BookletOccurrence[] {
    if (!Array.isArray(value)) return [];
    return this.sortBookletOccurrences(
      value.flatMap((entry): BookletOccurrence[] => {
        if (!entry || typeof entry !== "object" || !("booklet" in entry)) {
          return [];
        }
        const booklet = String(
          (entry as { booklet?: unknown }).booklet || "",
        ).trim();
        if (!booklet) return [];
        const rawPosition = (entry as { position?: unknown }).position;
        if (
          rawPosition === null ||
          rawPosition === undefined ||
          rawPosition === ""
        ) {
          return [{ booklet, position: null }];
        }
        const position = Number(rawPosition);
        return Number.isInteger(position) && position > 0
          ? [{ booklet, position }]
          : [];
      }),
    );
  }

  private sortBookletOccurrences(
    occurrences: BookletOccurrence[],
  ): BookletOccurrence[] {
    return [...occurrences].sort((left, right) => {
      const bookletComparison = left.booklet.localeCompare(
        right.booklet,
        "de",
        { numeric: true },
      );
      if (bookletComparison) return bookletComparison;
      if (left.position === right.position) return 0;
      if (left.position === null) return 1;
      if (right.position === null) return -1;
      return left.position - right.position;
    });
  }

  private validateGroupConflicts(groups: Map<string, ImportGroup>): void {
    for (const group of groups.values()) {
      for (const [property, values] of group.scalars.entries()) {
        if (values.size > 1) {
          throw new BadRequestException(
            `Konflikt: Für Item "${group.match.itemId}"${group.subId ? ` und Sub-ID "${group.subId}"` : ""} wurden unterschiedliche Werte für ${property} geliefert.`,
          );
        }
      }
      for (const [property, values] of group.texts.entries()) {
        if (values.size > 1) {
          throw new BadRequestException(
            `Konflikt: Für Item "${group.match.itemId}"${group.subId ? ` und Sub-ID "${group.subId}"` : ""} wurden unterschiedliche Werte für ${property} geliefert.`,
          );
        }
      }
    }
  }

  private collectScopedValues(
    groups: Map<string, ImportGroup>,
    scalarColumns: Array<{ property: ImportedScalarProperty }>,
    property: "itemTimeSeconds" | "stimulusTimeSeconds",
    getScopeKey: (group: ImportGroup) => string,
  ): Map<string, Set<number>> {
    if (!scalarColumns.some((definition) => definition.property === property)) {
      return new Map();
    }
    const valuesByScope = new Map<string, Set<number>>();
    for (const group of groups.values()) {
      const scopeKey = getScopeKey(group);
      const values = valuesByScope.get(scopeKey) || new Set<number>();
      const groupValues = group.scalars.get(property);
      if (groupValues?.size) values.add(Array.from(groupValues)[0]);
      valuesByScope.set(scopeKey, values);
    }
    return valuesByScope;
  }

  private validateScopedConflicts(
    valuesByScope: Map<string, Set<number>>,
    scope: "item" | "unit",
  ): void {
    for (const [scopeKey, values] of valuesByScope.entries()) {
      if (values.size <= 1) continue;
      throw new BadRequestException(
        scope === "unit"
          ? `Konflikt: Für Unit "${scopeKey}" wurden unterschiedliche Stimuluszeiten geliefert.`
          : `Konflikt: Für Item "${scopeKey}" wurden unterschiedliche Itemzeiten geliefert.`,
      );
    }
  }

  private collectScopedTextValues(
    groups: Map<string, ImportGroup>,
    textColumns: Array<{ property: ImportedTextProperty }>,
    property: "competenceLevel",
    getScopeKey: (group: ImportGroup) => string,
  ): Map<string, Set<string>> {
    if (!textColumns.some((definition) => definition.property === property)) {
      return new Map();
    }
    const valuesByScope = new Map<string, Set<string>>();
    for (const group of groups.values()) {
      const scopeKey = getScopeKey(group);
      const values = valuesByScope.get(scopeKey) || new Set<string>();
      const groupValues = group.texts.get(property);
      if (groupValues?.size) values.add(Array.from(groupValues)[0]);
      valuesByScope.set(scopeKey, values);
    }
    return valuesByScope;
  }

  private validateCompetenceLevelConflicts(
    valuesByItem: Map<string, Set<string>>,
  ): void {
    for (const [itemUuid, values] of valuesByItem.entries()) {
      if (values.size <= 1) continue;
      throw new BadRequestException(
        `Konflikt: Für Item "${itemUuid}" wurden unterschiedliche Werte für kstufe geliefert.`,
      );
    }
  }

  private addItemScopeMutations(
    mutations: ImportMutation[],
    valuesByItem: Map<string, Set<number>>,
    source: Record<string, Record<string, unknown>>,
  ): void {
    for (const [itemUuid, values] of valuesByItem.entries()) {
      if (values.size) {
        mutations.push({
          action: "set",
          scope: "item",
          property: "itemTimeSeconds",
          targetKeys: [itemUuid],
          value: Array.from(values)[0],
        });
      } else {
        mutations.push({
          action: "clear",
          scope: "item",
          property: "itemTimeSeconds",
          targetKeys: [itemUuid],
        });
      }
      mutations.push({
        action: "clear",
        scope: "item",
        property: "itemTimeSeconds",
        targetKeys: this.getPartialCreditRowKeys(source, itemUuid),
      });
    }
  }

  private addCompetenceLevelMutations(
    mutations: ImportMutation[],
    valuesByItem: Map<string, Set<string>>,
    source: Record<string, Record<string, unknown>>,
  ): void {
    for (const [itemUuid, values] of valuesByItem.entries()) {
      if (values.size) {
        mutations.push({
          action: "set",
          scope: "item",
          property: "competenceLevel",
          targetKeys: [itemUuid],
          value: Array.from(values)[0],
        });
      } else {
        mutations.push({
          action: "clear",
          scope: "item",
          property: "competenceLevel",
          targetKeys: [itemUuid],
        });
      }
      mutations.push({
        action: "clear",
        scope: "item",
        property: "competenceLevel",
        targetKeys: this.getPartialCreditRowKeys(source, itemUuid),
      });
    }
  }

  private addUnitScopeMutations(
    mutations: ImportMutation[],
    valuesByUnit: Map<string, Set<number>>,
    items: VomdItemData[],
    source: Record<string, Record<string, unknown>>,
  ): void {
    const itemUuidsByUnit = new Map<string, Set<string>>();
    for (const item of items) {
      const itemUuids = itemUuidsByUnit.get(item.unitId) || new Set<string>();
      itemUuids.add(item.uuid);
      itemUuidsByUnit.set(item.unitId, itemUuids);
    }
    for (const [unitId, values] of valuesByUnit.entries()) {
      for (const itemUuid of itemUuidsByUnit.get(unitId) || []) {
        if (values.size) {
          mutations.push({
            action: "set",
            scope: "unit",
            property: "stimulusTimeSeconds",
            targetKeys: [itemUuid],
            value: Array.from(values)[0],
          });
        } else {
          mutations.push({
            action: "clear",
            scope: "unit",
            property: "stimulusTimeSeconds",
            targetKeys: [itemUuid],
          });
        }
        mutations.push({
          action: "clear",
          scope: "unit",
          property: "stimulusTimeSeconds",
          targetKeys: this.getPartialCreditRowKeys(source, itemUuid),
        });
      }
    }
  }

  private getPartialCreditRowKeys(
    itemProperties: Record<string, Record<string, unknown>>,
    itemUuid: string,
  ): string[] {
    return Object.keys(itemProperties).filter(
      (rowKey) => parseItemRowKeyParts(rowKey)?.itemUuid === itemUuid,
    );
  }

  private parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      if (character === '"') {
        if (quoted && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (character === ";" && !quoted) {
        cells.push(current);
        current = "";
      } else {
        current += character;
      }
    }
    cells.push(current);
    return cells;
  }

  private cloneItemProperties(
    source: Record<string, Record<string, unknown>>,
  ): Record<string, Record<string, unknown>> {
    return JSON.parse(JSON.stringify(source || {}));
  }
}
