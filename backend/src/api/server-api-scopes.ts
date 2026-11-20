export const ALL_SERVER_API_SCOPES = [
  "ap.read",
  "transfer.read",
  "transfer.write",
  "index.read",
  "index.write",
  "files.read",
  "files.write",
  "audit.read",
] as const;

export type ServerApiScope = (typeof ALL_SERVER_API_SCOPES)[number];

export const ALL_SERVER_API_SCOPE_SET = new Set<string>(ALL_SERVER_API_SCOPES);
