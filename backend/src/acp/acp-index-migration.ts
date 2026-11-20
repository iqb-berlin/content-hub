import { isDeepStrictEqual } from "node:util";
import { AcpIndexValidationIssue } from "./acp-index.types";

// Older indexes also stored a flattened copy of the part entries at the root.
export function reconcileLegacyEntries(
  candidate: Record<string, unknown>,
  parts: Record<string, any>[],
  field: "units" | "scales",
  changes: { path: string; message: string }[],
  issues: AcpIndexValidationIssue[],
): void {
  const root = candidate[field];
  if (!Array.isArray(root)) return;
  const byId = new Map<string, unknown[]>();
  for (const part of parts) {
    for (const entry of Array.isArray(part?.[field]) ? part[field] : []) {
      if (typeof entry?.id !== "string") continue;
      const matches = byId.get(entry.id) || [];
      matches.push(entry);
      byId.set(entry.id, matches);
    }
  }

  const unresolved = [];
  for (const entry of root) {
    const matches = byId.get(entry?.id) || [];
    if (matches.some((other) => isDeepStrictEqual(other, entry))) continue;
    const target = parts.length === 1 ? parts[0] : undefined;
    if (
      !matches.length &&
      typeof entry?.id === "string" &&
      target &&
      (target[field] === undefined || Array.isArray(target[field]))
    ) {
      (target[field] ??= []).push(entry);
      byId.set(entry.id, [entry]);
    } else {
      issues.push({
        code: "LEGACY_ENTRY_CONFLICT",
        scope: "semantic",
        severity: "error",
        path: `/${field}/${unresolved.length}`,
        message: `Eintrag ${entry?.id ?? "ohne ID"} erfordert eine eindeutige Zuordnung oder hat abweichende Inhalte im Assessment-Part.`,
      });
      unresolved.push(entry);
    }
  }
  if (unresolved.length) candidate[field] = unresolved;
  else delete candidate[field];
  if (root.length > unresolved.length)
    changes.push({
      path: `/${field}`,
      message: "Top-Level-Einträge mit den Assessment-Parts abgeglichen.",
    });
}
