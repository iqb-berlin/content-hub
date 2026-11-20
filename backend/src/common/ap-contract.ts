import { BadRequestException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";

/** Only application envelope fields are translated; package contents stay opaque. */
const LEGACY_FIELDS = new Map(
  Object.entries({
    acp: "ap",
    acps: "aps",
    acpId: "apId",
    acpIds: "apIds",
    acpName: "apName",
    acpRoles: "apRoles",
    acpIndex: "apIndex",
    acpIndexSnapshot: "apIndexSnapshot",
    defaultAcpIndex: "defaultApIndex",
    allowedAcpId: "allowedApId",
    allowedAcpIds: "allowedApIds",
  }),
);
const CANONICAL_FIELDS = new Map(
  [...LEGACY_FIELDS].map(([legacy, current]) => [current, legacy]),
);
const ENVELOPES = new Set([
  "ap",
  "aps",
  "apRoles",
  "roles",
  "user",
  "users",
  "files",
  "snapshots",
  "snapshotFiles",
  "accessConfigs",
  "accessConfig",
  "tokens",
  "results",
  "details",
  "query",
]);

export function normalizeApScope(scope: string): string {
  return scope === "acp.read" ? "ap.read" : scope;
}

export function normalizeApRole(role: string): string {
  return role === "ACP_MANAGER" ? "AP_MANAGER" : role;
}

export function normalizeApAction(action: string): string {
  return action.replace(/^acp(?=[.-]|$)/, "ap");
}

export function legacyApAction(action: string): string {
  return action.replace(/^ap(?=[.-]|$)/, "acp");
}

/** Legacy aliases never take precedence over a conflicting canonical value. */
export function translateApContract(
  value: unknown,
  legacy = false,
  responseEnvelopes: readonly string[] = [],
): unknown {
  if (Array.isArray(value))
    return value.map((entry) => translateApContract(entry, legacy));
  if (
    !value ||
    typeof value !== "object" ||
    value instanceof Date ||
    Buffer.isBuffer(value)
  ) {
    return value;
  }
  const input = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(input)) {
    const canonical = LEGACY_FIELDS.get(key) || key;
    const target = legacy
      ? CANONICAL_FIELDS.get(canonical) || canonical
      : canonical;
    if (
      !legacy &&
      canonical !== key &&
      Object.prototype.hasOwnProperty.call(input, canonical) &&
      !isDeepStrictEqual(entry, input[canonical])
    ) {
      throw new BadRequestException(
        `Conflicting ${key} and ${canonical} values`,
      );
    }
    let mapped =
      ENVELOPES.has(canonical) || responseEnvelopes.includes(canonical)
        ? translateApContract(entry, legacy)
        : entry;
    if (
      ["role", "actorRole", "updatedByRole"].includes(canonical) &&
      typeof entry === "string"
    ) {
      mapped = legacy
        ? entry === "AP_MANAGER"
          ? "ACP_MANAGER"
          : entry
        : normalizeApRole(entry);
    }
    if (
      ["action", "resourceType"].includes(canonical) &&
      typeof entry === "string"
    ) {
      mapped = legacy ? legacyApAction(entry) : normalizeApAction(entry);
    }
    if (canonical === "downloadUrl" && legacy && typeof entry === "string") {
      mapped = entry.replace(/^(\/api(?:\/(?:server|view))?)\/ap\//, "$1/acp/");
    }
    if (canonical === "scopes" && Array.isArray(entry)) {
      mapped = entry.map((scope) =>
        legacy
          ? scope === "ap.read"
            ? "acp.read"
            : scope
          : typeof scope === "string"
            ? normalizeApScope(scope)
            : scope,
      );
    }
    if (
      canonical === "capabilities" &&
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry)
    ) {
      // Server API scope capabilities, unlike per-package capability arrays.
      mapped = Object.fromEntries(
        Object.entries(entry).map(([scope, granted]) => [
          legacy
            ? scope === "ap.read"
              ? "acp.read"
              : scope
            : normalizeApScope(scope),
          granted,
        ]),
      );
    }
    Object.defineProperty(result, target, {
      value: mapped,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

/** Raw AP-Index endpoints carry user-owned JSON, not an application envelope. */
export function isRawApIndexPath(path: string): boolean {
  return /^\/api\/(?:view\/)?ap\/[^/]+\/index(?:\/(?:import|export))?\/?$/i.test(
    path,
  );
}
