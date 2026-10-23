import { BadRequestException } from "@nestjs/common";

export const ACP_CAPABILITIES = [
  "review:participate",
  "review:manage",
  "item-explorer:view",
  "item-explorer:edit",
] as const;
export type AcpCapability = (typeof ACP_CAPABILITIES)[number];
export function normalizeGrants(value: unknown): AcpCapability[] {
  if (
    !Array.isArray(value) ||
    value.some((v) => !ACP_CAPABILITIES.includes(v))
  ) {
    throw new BadRequestException("Ungültige Berechtigungen");
  }
  return [...new Set(value)] as AcpCapability[];
}
export function hasCapability(
  grants: readonly string[],
  capability: AcpCapability,
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
): AcpCapability[] {
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

/** Preserve the existing management override while honoring the ACP feature switch. */
export function isExplorerAvailable(
  req: { acpAccessLevel?: string; user?: { isAppAdmin?: boolean } },
  featureConfig?: Record<string, unknown>,
): boolean {
  return (
    req.user?.isAppAdmin === true ||
    req.acpAccessLevel === "ADMIN" ||
    req.acpAccessLevel === "MANAGER" ||
    featureConfig?.enableItemList !== false
  );
}
