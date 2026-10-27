import { createHash } from "node:crypto";
import {
  getAssessmentParts,
  getIndexUnits,
  toRuntimeAcpIndex,
} from "../acp/acp-index.utils";
import {
  BookletStructureError,
  NavigationNode,
  parseBookletXml,
} from "./booklet-parser";

export interface ReviewOccurrence {
  id: string;
  name: string;
  alias?: string;
  occurrenceId: string;
  linkId: string;
  blockPath: string[];
}
export interface ReviewBooklet {
  id: string;
  name: string;
  definitionId?: string;
  children: NavigationNode[];
  units: ReviewOccurrence[];
  legacy?: boolean;
  moduleIds?: string[];
}
export interface ReviewManifest {
  booklets: ReviewBooklet[];
  units: Array<{
    id: string;
    name: string;
    items: Array<{ id: string; name: string }>;
  }>;
  issues: Array<{
    severity: "error" | "warning";
    path: string;
    message: string;
  }>;
}

const list = (value: any): any[] => (Array.isArray(value) ? value : []);
const reference = (value: any): string =>
  typeof value === "string"
    ? value.trim()
    : String(value?.moduleId || value?.id || "").trim();

// Labels and source-file locations do not change navigation identity.
const navigationIdentity = (nodes: NavigationNode[]): unknown[] =>
  nodes.map((node) =>
    node.kind === "BLOCK"
      ? [node.kind, node.id, navigationIdentity(node.children || [])]
      : [node.kind, node.id, node.alias ?? null],
  );

/** Shared navigation/target contract; no persistence or presentation dependencies. */
export function buildReviewManifest(
  rawIndex: unknown,
  definitions: Map<string, string>,
): ReviewManifest {
  const index = toRuntimeAcpIndex(rawIndex as any);
  const result: ReviewManifest = {
    booklets: [],
    units: getIndexUnits(index).map((unit: any) => ({
      id: unit.id,
      name: unit.name || unit.id,
      items: list(unit.items).map((item) => ({
        id: item.id,
        name: item.name || item.id,
      })),
    })),
    issues: [],
  };
  const unitsById = new Map(result.units.map((unit) => [unit.id, unit]));
  const bookletIds = new Set<string>();
  const error = (path: string, message: string) =>
    result.issues.push({ severity: "error", path, message });
  const add = (booklet: ReviewBooklet, path: string) => {
    if (!booklet.id || (!booklet.legacy && bookletIds.has(booklet.id))) {
      error(path, "Booklet-ID fehlt oder ist ACP-weit doppelt.");
      return;
    }
    if (!booklet.legacy) bookletIds.add(booklet.id);
    const revision = createHash("sha256")
      .update(
        JSON.stringify([
          "booklet-task-link-v1",
          booklet.id,
          navigationIdentity(booklet.children),
        ]),
      )
      .digest();
    const walk = (nodes: NavigationNode[], labels: string[]) => {
      for (const node of nodes) {
        if (node.kind === "BLOCK")
          walk(node.children || [], [...labels, node.label]);
        else {
          if (!unitsById.has(node.id))
            error(node.path, `Unbekannte Unit: ${node.id}`);
          booklet.units.push({
            id: node.id,
            name: unitsById.get(node.id)?.name || node.id,
            alias: node.alias,
            occurrenceId: `${encodeURIComponent(booklet.id)}:${node.path}`,
            linkId: createHash("sha256")
              .update(revision)
              .update(`:${booklet.units.length}`)
              .digest("base64url")
              .slice(0, 16),
            blockPath: labels,
          });
        }
      }
    };
    walk(booklet.children, []);
    result.booklets.push(booklet);
  };
  for (const [partIndex, part] of getAssessmentParts(index).entries()) {
    const prefix = `assessmentParts[${partIndex}]`;
    const modules = list(part.bookletModules);
    const moduleNodes = (refs: any[], path: string): NavigationNode[] =>
      refs.flatMap((ref, position) => {
        const moduleId = reference(ref);
        const module = modules.find((entry) => entry.id === moduleId);
        const modulePath = `${path}[${position}]`;
        if (!module) {
          error(modulePath, `Unbekanntes Modul: ${moduleId}`);
          return [];
        }
        return [
          {
            kind: "BLOCK" as const,
            id: moduleId,
            label: module.name || moduleId,
            path: modulePath,
            children: [...list(module.units)]
              .sort((a, b) => (a?.order || 0) - (b?.order || 0))
              .map((unit, i) => ({
                kind: "UNIT" as const,
                id: reference(unit),
                label: unitsById.get(reference(unit))?.name || reference(unit),
                alias: unit?.alias,
                path: `${modulePath}.units[${i}]`,
              })),
          },
        ];
      });
    const entries = list(part.instruments).flatMap(
      (instrument, instrumentIndex) =>
        list(instrument.testcenterBooklet).map((booklet, bookletIndex) => ({
          booklet,
          path: `${prefix}.instruments[${instrumentIndex}].testcenterBooklet[${bookletIndex}]`,
        })),
    );
    for (const { booklet, path } of entries) {
      const definitionId =
        typeof booklet.definitionId === "string"
          ? booklet.definitionId
          : undefined;
      const xml = definitionId ? definitions.get(definitionId) : undefined;
      if (xml !== undefined) {
        try {
          const parsed = parseBookletXml(
            xml,
            `${path}.definitionId(${definitionId})`,
          );
          if (booklet.id && booklet.id !== parsed.id) {
            error(path, "Booklet-ID im Index widerspricht der XML-ID.");
            continue;
          }
          add(
            {
              id: booklet.id || parsed.id,
              name: booklet.name || parsed.label,
              definitionId,
              moduleIds: list(booklet.modules).map(reference),
              children: parsed.children,
              units: [],
            },
            path,
          );
        } catch (e) {
          if (!(e instanceof BookletStructureError)) throw e;
          error(e.path, e.message);
        }
      } else if (list(booklet.modules).length) {
        // Older indices have no canonical booklet ID. Keep these navigation-only.
        const legacy = !booklet.id;
        if (definitionId)
          result.issues.push({
            severity: "warning",
            path,
            message: `Booklet-Datei fehlt: ${definitionId}; vorhandene Module werden angezeigt.`,
          });
        add(
          {
            id: booklet.id || `legacy:${path}`,
            name: booklet.name || booklet.id || definitionId || "Booklet",
            legacy,
            definitionId,
            moduleIds: list(booklet.modules).map(reference),
            children: moduleNodes(booklet.modules, `${path}.modules`),
            units: [],
          },
          path,
        );
      } else {
        error(
          path,
          definitionId
            ? `Booklet-Datei fehlt: ${definitionId}`
            : "Booklet besitzt weder XML-Definition noch Module.",
        );
      }
    }
    // Unassigned legacy modules remain navigable with their original IDs.
    const assigned = new Set(
      entries.flatMap(({ booklet }) => list(booklet.modules).map(reference)),
    );
    modules.forEach((module, i) => {
      if (!assigned.has(module.id))
        add(
          {
            id: module.id,
            name: module.name || module.id,
            legacy: true,
            children: moduleNodes(
              [module.id],
              `${prefix}.bookletModules[${i}]`,
            ),
            units: [],
          },
          `${prefix}.bookletModules[${i}]`,
        );
    });
  }
  return result;
}
