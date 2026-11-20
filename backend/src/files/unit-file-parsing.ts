import type { Logger } from "@nestjs/common";
import { SaxesParser } from "saxes";
import type { UnitXmlData } from "./unit-parser.types";

type ParsingLogger = Pick<Logger, "error">;

export function getXmlRootElement(xmlContent: string): string | undefined {
  let rootElement: string | undefined;
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tag) => {
    rootElement ??= tag.name;
  });

  try {
    parser.write(xmlContent).close();
  } catch {
    return undefined;
  }

  return rootElement;
}

export function isUnitXmlFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.endsWith(".xml") &&
    !lower.startsWith("booklet") &&
    !lower.startsWith("testtaker")
  );
}

export function compareUnitXmlFilenames(
  unitId: string,
  left: string,
  right: string,
): number {
  const conventionalName = `${unitId}.xml`;
  if (left === right) return 0;
  if (left === conventionalName) return -1;
  if (right === conventionalName) return 1;
  // Keep the result independent of database order or upload order.
  return left < right ? -1 : 1;
}

export function parseUnitXml(
  xmlContent: string,
  xmlFilename: string,
  logger: ParsingLogger,
): UnitXmlData | null {
  try {
    const idMatch = xmlContent.match(/<Id>([^<]+)<\/Id>/);
    const unitId = idMatch?.[1] || "";
    const labelMatch = xmlContent.match(/<Label>([^<]+)<\/Label>/);
    const unitLabel = labelMatch?.[1] || unitId;
    const descMatch = xmlContent.match(/<Description>([^<]*)<\/Description>/);
    const description = descMatch?.[1] || undefined;
    const defRefMatch = xmlContent.match(
      /<DefinitionRef[^>]*>([^<]+)<\/DefinitionRef>/,
    );
    const definitionRef = defRefMatch?.[1]?.trim() || "";
    const playerAttrMatch = xmlContent.match(
      /<DefinitionRef[^>]*player="([^"]+)"/,
    );
    const playerRef = playerAttrMatch?.[1] || "";
    const codingRefMatch = xmlContent.match(
      /<CodingSchemeRef[^>]*>([^<]+)<\/CodingSchemeRef>/,
    );
    const codingSchemeRef = codingRefMatch?.[1]?.trim() || undefined;
    const metaRefMatch = xmlContent.match(/<Reference>([^<]+)<\/Reference>/);
    const metadataRef = metaRefMatch?.[1]?.trim() || undefined;
    const commentsRef =
      xmlContent
        .match(/<UnitCommentsRef[^>]*>([^<]+)<\/UnitCommentsRef>/)?.[1]
        ?.trim() || undefined;

    return {
      unitId,
      unitLabel,
      description,
      definitionRef,
      playerRef,
      codingSchemeRef,
      metadataRef,
      commentsRef,
    };
  } catch (error) {
    logger.error(`Failed to parse unit XML ${xmlFilename}: ${error}`);
    return null;
  }
}

export function parseVomd(
  vomdContent: string,
  strictStructure: boolean,
  logger: ParsingLogger,
): { unitProfiles: any[]; items: any[] } | null {
  try {
    const data: unknown = JSON.parse(vomdContent);
    if (!isRecord(data)) {
      throw new Error("VOMD root must be an object");
    }

    const unitProfiles = data.profiles === undefined ? [] : data.profiles;
    const items = data.items === undefined ? [] : data.items;
    if (
      !Array.isArray(unitProfiles) ||
      !Array.isArray(items) ||
      (strictStructure &&
        (!Object.prototype.hasOwnProperty.call(data, "items") ||
          !unitProfiles.every(isValidVomdProfile) ||
          !items.every(isValidVomdItem)))
    ) {
      throw new Error("VOMD has an invalid structure");
    }

    return { unitProfiles, items };
  } catch (error) {
    logger.error(`Failed to parse .vomd: ${error}`);
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidVomdProfile(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const entries = value.entries === undefined ? [] : value.entries;
  return Array.isArray(entries) && entries.every(isRecord);
}

export function isValidVomdItem(
  value: unknown,
): value is Record<string, any> & { id: string; profiles?: any[] } {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    return false;
  }
  const profiles = value.profiles === undefined ? [] : value.profiles;
  return Array.isArray(profiles) && profiles.every(isValidVomdProfile);
}

export function resolveVomdItemId(
  unitId: string,
  item: { id: string; useUnitAliasAsPrefix?: boolean },
): string {
  return item.useUnitAliasAsPrefix === false ? item.id : `${unitId}_${item.id}`;
}

export function findReferencedMetadataFile<T extends { originalName: string }>(
  files: readonly T[],
  reference: string,
): T | undefined {
  return (
    files.find((file) => file.originalName === reference) ??
    files.find((file) => file.originalName === `${reference}.json`)
  );
}

export function matchIndexedVomdItem<T>(
  unitId: string,
  item: { id: string; useUnitAliasAsPrefix?: boolean },
  indexedItems: ReadonlyMap<string, T>,
  fileItemIds: ReadonlySet<string>,
): { indexedItem?: T; wasSeparateTarget: boolean } {
  const exact = indexedItems.get(item.id);
  if (exact !== undefined)
    return { indexedItem: exact, wasSeparateTarget: false };

  const prefix = `${unitId}_`;
  if (item.id.startsWith(prefix)) {
    const raw = item.id.slice(prefix.length);
    const legacy = raw ? indexedItems.get(raw) : undefined;
    if (legacy !== undefined) {
      // When both raw IDs occur in the VOMD, the exact item owns the indexed ID.
      return {
        indexedItem: fileItemIds.has(raw) ? undefined : legacy,
        wasSeparateTarget: false,
      };
    }
  }

  const prefixedId = resolveVomdItemId(unitId, item);
  // An existing backward alias owns the index ID before a generated prefix
  // can claim it. With distinct file items, the generated item keeps its raw ID.
  const existingAlias = `${prefix}${prefixedId}`;
  const aliasOwnsIndex =
    fileItemIds.has(existingAlias) && !indexedItems.has(existingAlias);
  const indexedItem =
    prefixedId !== item.id && !fileItemIds.has(prefixedId) && !aliasOwnsIndex
      ? indexedItems.get(prefixedId)
      : undefined;
  return { indexedItem, wasSeparateTarget: true };
}

export function findPlayerFile(
  playerRef: string,
  fileNames: string[],
): string | undefined {
  if (!playerRef) return undefined;
  const [baseName, version] = playerRef.split("@");
  return fileNames.find((name) => {
    const lower = name.toLowerCase();
    return (
      lower.includes(baseName.toLowerCase()) &&
      (version ? lower.includes(version) : true) &&
      lower.endsWith(".html")
    );
  });
}

export function extractLabelText(label: any): string {
  if (!label) return "";
  if (typeof label === "string") return label;
  if (Array.isArray(label)) {
    const de = label.find((entry: any) => entry.lang === "de");
    return de?.value || label[0]?.value || "";
  }
  return "";
}

export function extractValueText(valueAsText: any): string {
  if (!valueAsText) return "";
  if (typeof valueAsText === "string") return valueAsText;
  if (Array.isArray(valueAsText)) {
    const de = valueAsText.find((entry: any) => entry.lang === "de");
    return de?.value || valueAsText[0]?.value || "";
  }
  if (typeof valueAsText === "object" && valueAsText.value) {
    return valueAsText.value;
  }
  return "";
}

export function extractVomdTimeSeconds(
  profiles: unknown,
  entryId: "iqb_time_item" | "iqb_item_time" | "iqb_time_stimulus",
): number | undefined {
  if (!Array.isArray(profiles)) return undefined;

  for (const profile of profiles) {
    if (!isRecord(profile) || !Array.isArray(profile.entries)) continue;

    for (const entry of profile.entries) {
      if (!isRecord(entry) || entry.id !== entryId) continue;
      const rawValue = entry.value;
      if (
        typeof rawValue !== "number" &&
        (typeof rawValue !== "string" || rawValue.trim().length === 0)
      ) {
        continue;
      }
      const seconds = Number(rawValue);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds;
    }
  }

  return undefined;
}
