import { BadRequestException } from "@nestjs/common";
import * as path from "path";

export function normalizeRelativePath(input: unknown): string {
  const raw = String(input ?? "")
    .replace(/\\/g, "/")
    .trim();
  if (
    !raw ||
    raw.includes("\0") ||
    raw.startsWith("/") ||
    /^[A-Za-z]:\//.test(raw)
  ) {
    throw new BadRequestException(
      "relativePath must be a non-empty relative POSIX path",
    );
  }
  const normalized = path.posix.normalize(raw).replace(/^\.\//, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.endsWith("/") ||
    normalized.startsWith("../") ||
    normalized.split("/").includes("..")
  ) {
    throw new BadRequestException(`Unsafe relativePath: ${raw}`);
  }
  return normalized;
}

export function getUploadRelativePath(file: Express.Multer.File): string {
  return normalizeRelativePath(
    (file as Express.Multer.File & { relativePath?: string }).relativePath ||
      file.originalname,
  );
}

export function normalizePartId(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "part"
  );
}
