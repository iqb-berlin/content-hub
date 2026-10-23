/** Prefer a person's name or username; legacy email snapshots are not display names. */
export function commentAuthorName(
  ...candidates: unknown[]
): string | undefined {
  return candidates
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find((value) => value.length > 0 && !value.includes("@"));
}
