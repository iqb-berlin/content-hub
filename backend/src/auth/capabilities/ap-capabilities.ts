import { BadRequestException } from "@nestjs/common";

export const AP_CAPABILITIES = [
  "review:participate",
  "review:manage",
  "item-explorer:view",
  "item-explorer:edit",
] as const;
export type ApCapability = (typeof AP_CAPABILITIES)[number];
export function normalizeGrants(value: unknown): ApCapability[] {
  if (
    !Array.isArray(value) ||
    value.some((v) => !AP_CAPABILITIES.includes(v))
  ) {
    throw new BadRequestException("Ungültige Berechtigungen");
  }
  return [...new Set(value)] as ApCapability[];
}
export function hasCapability(
  grants: readonly string[],
  capability: ApCapability,
): boolean {
  return (
    grants.includes(capability) ||
    (capability === "item-explorer:view" &&
      grants.includes("item-explorer:edit"))
  );
}
export function profileGrants(
  profile = "CUSTOM",
  custom: unknown = [],
): ApCapability[] {
  switch (profile) {
    case "REVIEW_ONLY":
      return ["review:participate"];
    case "ITEM_EXPLORER_ONLY":
      return ["item-explorer:view"];
    case "BOTH":
      return ["review:participate", "item-explorer:view"];
    case "CUSTOM":
      return normalizeGrants(custom);
    default:
      throw new BadRequestException("Ungültiges Berechtigungsprofil");
  }
}

/** Preserve the existing management override while honoring the AP feature switch. */
export function isExplorerAvailable(
  req: { apAccessLevel?: string; user?: { isAppAdmin?: boolean } },
  featureConfig?: Record<string, unknown>,
): boolean {
  return (
    req.user?.isAppAdmin === true ||
    req.apAccessLevel === "ADMIN" ||
    req.apAccessLevel === "MANAGER" ||
    featureConfig?.enableItemList !== false
  );
}
