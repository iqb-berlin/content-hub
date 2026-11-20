import { Ap, ApFile } from "../database/entities";
import {
  AuthenticatedServerApiClient,
  AuthenticatedServerApiRequest,
} from "../api/server-api.types";

export const TEST_UUIDS = {
  ap: "11111111-1111-4111-8111-111111111111",
  otherAp: "22222222-2222-4222-8222-222222222222",
  file: "33333333-3333-4333-8333-333333333333",
  otherFile: "44444444-4444-4444-8444-444444444444",
  unknownAp: "99999999-9999-4999-8999-999999999999",
} as const;

export function createApFixture(overrides: Partial<Ap> = {}): Ap {
  return {
    id: TEST_UUIDS.ap,
    packageId: "pkg-1",
    name: "Test AP",
    description: "Test fixture",
    apIndex: {},
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as Ap;
}

export function createApFileFixture(overrides: Partial<ApFile> = {}): ApFile {
  return {
    id: TEST_UUIDS.file,
    apId: TEST_UUIDS.ap,
    filePath: "/uploads/test/file.json",
    originalName: "file.json",
    fileType: "application/json",
    fileSize: 2,
    checksum: "fixture-checksum",
    uploadedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as ApFile;
}

export function createServerApiRequest(
  overrides: Partial<AuthenticatedServerApiClient> = {},
): AuthenticatedServerApiRequest {
  return {
    serverApiClient: {
      id: "test-client",
      scopes: [],
      allowedApIds: null,
      ...overrides,
    },
  } as AuthenticatedServerApiRequest;
}
