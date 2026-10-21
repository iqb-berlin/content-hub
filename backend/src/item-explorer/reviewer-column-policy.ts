import type { ReviewBooklet, ReviewManifest } from "../review/review-manifest";
import type { NavigationNode } from "../review/booklet-parser";
import type { ExplorerMetadataColumns } from "./item-explorer-state.service";

/** Shared field mapping for JSON projections and spreadsheet/CSV columns.
 * Unknown item fields are not released by adding them to a response DTO.
 */
const FIELD_COLUMNS: Record<string, string> = Object.assign(
  Object.create(null),
  {
    unitLabel: "system:unitLabel",
    unitName: "system:unitLabel",
    rowNumber: "system:referenceNumber",
    subIdDisplay: "system:subId",
    empiricalDifficulty: "system:empiricalDifficulty",
    meanTaskDifficulty: "system:meanTaskDifficulty",
    tags: "system:tags",
    commentCount: "system:comments",
    bista: "metadata:bista",
    infit: "metadata:infit",
    discrimination: "metadata:discrimination",
    solutionRate: "metadata:solutionRate",
    textComplexity: "metadata:textComplexity",
    competenceLevel: "metadata:competenceLevel",
    itemTimeSeconds: "metadata:itemTimeSeconds",
    stimulusTimeSeconds: "metadata:stimulusTimeSeconds",
    booklets: "metadata:booklet",
    bookletPositions: "metadata:bookletPosition",
  },
);

const TIME_COLUMN_ALIASES: Readonly<Record<string, string>> = Object.assign(
  Object.create(null),
  {
    "metadata:iqb_time_item": "metadata:itemTimeSeconds",
    "metadata:iqb_item_time": "metadata:itemTimeSeconds",
    "metadata:iqb_time_stimulus": "metadata:stimulusTimeSeconds",
  },
);

const normalizeColumn = (column: string): string =>
  TIME_COLUMN_ALIASES[column] || column;

const IDENTITY_FIELDS = new Set([
  "id",
  "itemId",
  "uuid",
  "itemUuid",
  "rowKey",
  "unitId",
  "subId",
  "variableId",
  "sourceVariable",
  "variableReadOnlyId",
  "useUnitAliasAsPrefix",
  "previewTargetId",
  "previewStart",
  "excluded",
]);
const PERSONAL_EXPORT_FIELDS = new Set([
  "sequenceNumber",
  "markers",
  "note",
  "category",
  "personalCompetenceLevel",
]);
const POSITION_COLUMN_LAYOUT_SCHEMA_VERSION = 3;
const record = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

export class ReviewerColumnPolicy {
  readonly restricted: boolean;
  readonly allowedColumns: string[];
  private readonly legacyPositionVisible: boolean;

  constructor(
    columns?: Partial<ExplorerMetadataColumns>,
    readonly publishedVersion?: number,
  ) {
    this.restricted =
      columns?.restrictReviewerColumnsToManagerSelection === true;
    const layoutSchemaVersion = Number(columns?.layout?.schemaVersion);
    this.legacyPositionVisible =
      this.restricted &&
      (!Number.isInteger(layoutSchemaVersion) ||
        layoutSchemaVersion < POSITION_COLUMN_LAYOUT_SCHEMA_VERSION);
    // Enabling the option requires the editor to materialize the current layout.
    // Missing/legacy layouts fail closed for data-bearing columns. Position is a
    // locally computed legacy column and remains visible until schema 3 records
    // an explicit visibility choice.
    this.allowedColumns = [
      ...new Set(
        [
          ...(this.legacyPositionVisible ? ["system:position"] : []),
          "system:itemId",
          ...(columns?.layout?.configured ? columns.layout.visible : []),
        ].map(normalizeColumn),
      ),
    ].filter((key) => !key.startsWith("personal:"));
  }

  allows(column: string): boolean {
    return (
      !this.restricted ||
      column.startsWith("personal:") ||
      this.allowedColumns.includes(column)
    );
  }

  private allowsConfiguredColumn(column: string): boolean {
    return this.allows(normalizeColumn(column));
  }

  private allowsConfiguredMetadata(id: string): boolean {
    return this.allowsConfiguredColumn(FIELD_COLUMNS[id] || `metadata:${id}`);
  }

  allowsField(field: string): boolean {
    return (
      !this.restricted ||
      IDENTITY_FIELDS.has(field) ||
      (Boolean(FIELD_COLUMNS[field]) && this.allows(FIELD_COLUMNS[field]))
    );
  }

  allowsExportField(field: string): boolean {
    return (
      !this.restricted ||
      PERSONAL_EXPORT_FIELDS.has(field) ||
      field === "itemId" ||
      (field === "subId" && this.allows("system:subId")) ||
      (Boolean(FIELD_COLUMNS[field]) && this.allows(FIELD_COLUMNS[field]))
    );
  }

  allowsMetadata(id: string): boolean {
    return this.allows(FIELD_COLUMNS[id] || `metadata:${id}`);
  }

  projectMetadata(value: unknown): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(record(value)).filter(([id]) => this.allowsMetadata(id)),
    );
  }

  projectItem(value: unknown): Record<string, unknown> {
    if (!this.restricted) return record(value);
    const item = record(value);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (key === "metadata") result[key] = this.projectMetadata(value);
      else if (key === "bookletOccurrences") {
        if (
          this.allows("metadata:booklet") ||
          this.allows("metadata:bookletPosition")
        ) {
          result[key] = Array.isArray(value)
            ? value.map((entry) => ({
                ...(this.allows("metadata:booklet")
                  ? { booklet: entry.booklet }
                  : {}),
                ...(this.allows("metadata:bookletPosition")
                  ? { position: entry.position }
                  : {}),
              }))
            : [];
        }
      } else if (this.allowsField(key)) result[key] = value;
    }
    return result;
  }

  projectState(value: unknown): Record<string, unknown> {
    const state = record(value);
    return {
      ...state,
      // Shared filters can themselves contain unreleased values.
      ui: {},
      tags: this.allows("system:tags") ? state.tags : {},
      itemProperties: Object.fromEntries(
        Object.entries(record(state.itemProperties)).map(([key, item]) => [
          key,
          this.projectItem(item),
        ]),
      ),
      metadataColumns: this.projectColumnSettings(state.metadataColumns),
    };
  }

  projectColumnSettings(value: unknown): Record<string, unknown> {
    const columns = record(value);
    const layout = record(columns.layout);
    const filterKeys = (keys: unknown) =>
      Array.isArray(keys)
        ? keys.filter((key) => this.allowsConfiguredColumn(key))
        : [];
    const projectConfiguredMetadata = (metadata: unknown) =>
      Object.fromEntries(
        Object.entries(record(metadata)).filter(([id]) =>
          this.allowsConfiguredMetadata(id),
        ),
      );
    const visible = filterKeys(layout.visible);
    const defaultVisible = [
      ...(this.legacyPositionVisible ? ["system:position"] : []),
      "system:itemId",
    ];
    return {
      ...columns,
      visible: Array.isArray(columns.visible)
        ? columns.visible.filter((id) => this.allowsConfiguredMetadata(id))
        : [],
      order: Array.isArray(columns.order)
        ? columns.order.filter((id) => this.allowsConfiguredMetadata(id))
        : [],
      widths: projectConfiguredMetadata(columns.widths),
      definitions: Array.isArray(columns.definitions)
        ? columns.definitions.filter((c) => this.allowsConfiguredMetadata(c.id))
        : [],
      layout: {
        ...layout,
        configured: true,
        visible: [...new Set([...defaultVisible, ...visible])],
        order: [...new Set([...defaultVisible, ...filterKeys(layout.order)])],
        widths: Object.fromEntries(
          Object.entries(record(layout.widths)).filter(([key]) =>
            this.allowsConfiguredColumn(key),
          ),
        ),
      },
    };
  }

  /** Preserve review navigation identities independently of table visibility. */
  projectReviewBooklet(booklet: ReviewBooklet): ReviewBooklet {
    if (!this.restricted) return booklet;
    const bookletLabels = this.allows("metadata:booklet");
    const unitLabels = this.allows("system:unitLabel");
    const projectNode = (node: NavigationNode): NavigationNode => ({
      kind: node.kind,
      id: node.id,
      path: node.path,
      label: (node.kind === "UNIT" ? unitLabels : bookletLabels)
        ? node.label
        : "",
      ...(node.children ? { children: node.children.map(projectNode) } : {}),
    });
    return {
      id: booklet.id,
      name: bookletLabels ? booklet.name : "",
      legacy: booklet.legacy,
      children: booklet.children.map(projectNode),
      units: booklet.units.map((unit) => ({
        id: unit.id,
        name: unitLabels ? unit.name : "",
        occurrenceId: unit.occurrenceId,
        blockPath: bookletLabels ? [...unit.blockPath] : [],
      })),
    };
  }

  projectReviewManifest(manifest: ReviewManifest): ReviewManifest {
    if (!this.restricted) return manifest;
    const unitLabels = this.allows("system:unitLabel");
    return {
      booklets: manifest.booklets.map((booklet) =>
        this.projectReviewBooklet(booklet),
      ),
      units: manifest.units.map((unit) => ({
        id: unit.id,
        name: unitLabels ? unit.name : "",
        items: unit.items.map((item) => ({ id: item.id, name: "" })),
      })),
      // Parser diagnostics may quote unreleased labels or raw source values.
      issues: manifest.issues.map((issue) => ({
        severity: issue.severity,
        path: issue.path,
        message: "Die Review-Navigation enthält einen Strukturfehler.",
      })),
    };
  }

  /** Structured response projection. Never mutates a parser or shared-state cache. */
  projectResponse(value: any, context = ""): any {
    if (!this.restricted || value == null) return value;
    if (Array.isArray(value))
      return value.map((entry) => this.projectResponse(entry, context));
    if (typeof value !== "object" || value instanceof Date) return value;
    if (
      ("itemId" in value || (context === "items" && "id" in value)) &&
      !("targetType" in value) &&
      context !== "counts"
    )
      return this.projectItem(value);
    if ("publishedState" in value && "draftState" in value) {
      const published = this.projectState(value.publishedState);
      return {
        ...value,
        activeState: published,
        publishedState: published,
        draftState: published,
      };
    }
    // Summary endpoints carry labels outside the full review manifest. Keep only
    // navigation identities when the corresponding booklet column is hidden.
    if (context === "sequences" && !this.allows("metadata:booklet")) {
      return {
        id: value.id,
        ...(value.kind ? { kind: value.kind } : {}),
        ...(Array.isArray(value.units)
          ? { units: this.projectResponse(value.units, "units") }
          : {}),
      };
    }
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (
        context === "units" &&
        ![
          "id",
          "unitId",
          "name",
          "lang",
          "items",
          "dependencies",
          "codingScheme",
          "richText",
        ].includes(key)
      )
        continue;
      if (key === "counts" && !this.allows("system:comments")) {
        result[key] = [];
        continue;
      }
      if (key === "acpIndex" || key === "validationResult") continue;
      if (key === "itemProperties") {
        result[key] = Object.fromEntries(
          Object.entries(record(entry)).map(([id, item]) => [
            id,
            this.projectItem(item),
          ]),
        );
      } else if (key === "metadata") result[key] = this.projectMetadata(entry);
      else if (key === "metadataColumns")
        result[key] = this.projectColumnSettings(entry);
      else if (key === "columns" && Array.isArray(entry))
        result[key] = entry.filter((c) => this.allowsMetadata(c.id));
      else if (key === "unitMetadata") {
        result[key] = Object.fromEntries(
          Object.entries(record(entry)).map(([id, entries]) => [
            id,
            Array.isArray(entries)
              ? entries.filter((e) => this.allowsMetadata(e.id))
              : [],
          ]),
        );
      } else if (key === "dependencies" && Array.isArray(entry)) {
        result[key] = entry.filter((dependency) =>
          ["PLAYER", "UNIT_DEFINITION", "CODING_SCHEME"].includes(
            dependency.type,
          ),
        );
      } else if (
        ["name", "description"].includes(key) &&
        context === "units" &&
        !this.allows("system:unitLabel")
      )
        continue;
      else if (FIELD_COLUMNS[key] && !this.allows(FIELD_COLUMNS[key])) continue;
      else if (["rowData", "codingSchemes"].includes(key)) result[key] = entry;
      else result[key] = this.projectResponse(entry, key);
    }
    return result;
  }
}
