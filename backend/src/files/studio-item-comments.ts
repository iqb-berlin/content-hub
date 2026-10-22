import { isRecord } from "./unit-file-parsing";
import type { StudioItemComment } from "./unit-parser.types";

/** Read Studio's VOUC export without creating Content Pool review comments. */
export function parseStudioItemComments(
  content: string,
): Map<string, StudioItemComment[]> {
  const data: unknown = JSON.parse(content);
  if (!Array.isArray(data))
    throw new Error("VOUC must contain a comment array");
  const records = new Map<number, Record<string, unknown>>();
  for (const entry of data) {
    if (
      isRecord(entry) &&
      typeof entry.id === "number" &&
      Number.isSafeInteger(entry.id) &&
      entry.id > 0 &&
      !records.has(entry.id)
    ) {
      records.set(entry.id, entry);
    }
  }

  const byItem = new Map<string, StudioItemComment[]>();
  // Studio exports comments in creation order. Preserve that order, including
  // replies, and inherit a parent's item assignment only for unassigned replies.
  for (const [id, entry] of records) {
    if (typeof entry.body !== "string" || !entry.body.trim()) continue;
    const visited = new Set<number>();
    let current: Record<string, unknown> | undefined = entry;
    let targets: string[] = [];
    while (current && !visited.has(current.id as number)) {
      visited.add(current.id as number);
      if (Array.isArray(current.itemUuids) && current.itemUuids.length) {
        targets = current.itemUuids
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean);
        break;
      }
      current =
        typeof current.parentId === "number"
          ? records.get(current.parentId)
          : undefined;
    }
    if (!targets.length) continue;
    const createdAt =
      typeof entry.createdAt === "string" &&
      Number.isFinite(Date.parse(entry.createdAt))
        ? new Date(entry.createdAt).toISOString()
        : undefined;
    const comment: StudioItemComment = {
      id,
      body: entry.body,
      ...(typeof entry.userName === "string" && entry.userName.trim()
        ? { userName: entry.userName.trim() }
        : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(typeof entry.parentId === "number" && entry.parentId > 0
        ? { parentId: entry.parentId }
        : {}),
      hidden: entry.hidden === true,
    };
    for (const uuid of new Set(targets)) {
      const comments = byItem.get(uuid) || [];
      comments.push(comment);
      byItem.set(uuid, comments);
    }
  }
  return byItem;
}
