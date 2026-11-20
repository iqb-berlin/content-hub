import * as crypto from "crypto";

const TOKEN_PREFIX = "ch";
const TOKEN_SECRET_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 14;

export function generateServerApiToken(): string {
  return `${TOKEN_PREFIX}_${crypto.randomBytes(TOKEN_SECRET_BYTES).toString("base64url")}`;
}

export function hashServerApiToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function getServerApiTokenDisplayPrefix(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= DISPLAY_PREFIX_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, DISPLAY_PREFIX_LENGTH)}...`;
}
