import { ReviewReadinessService } from "./review-readiness.service";

function setup(overrides: Record<string, any> = {}) {
  const uploadedFile = {
    id: "file-1",
    filePath: "/nonexistent/review-test-file",
    checksum: "v1",
    validationResult: { valid: true, issues: [] },
  };
  const files = {
    find: jest.fn().mockResolvedValue([uploadedFile]),
  };
  const validation = {
    autoValidateUploadedFiles: jest.fn().mockResolvedValue({
      files: [uploadedFile],
      summary: {
        totalFiles: 1,
        validFiles: 1,
        invalidFiles: 0,
        semanticValid: true,
        semanticIssueCount: 0,
        timestamp: "2026-09-14T12:00:00.000Z",
      },
    }),
  };
  const unitParser = {
    validateUnitFiles: jest.fn().mockResolvedValue([
      {
        unitId: "unit-1",
        unitLabel: "Unit 1",
        valid: true,
        files: {
          xml: { expected: "unit.xml", found: true },
          definition: { expected: "definition.voud", found: true },
          codingScheme: { expected: "coding.vocs", found: true },
          metadata: { expected: "metadata.vomd", found: true },
          player: { expected: "player", found: true },
        },
      },
    ]),
  };
  const manifest = {
    getManifest: jest.fn().mockResolvedValue({
      booklets: [
        {
          id: "booklet-1",
          name: "Booklet 1",
          units: [{ id: "unit-1" }],
        },
      ],
      issues: [],
    }),
  };
  Object.assign(files, overrides.files);
  Object.assign(validation, overrides.validation);
  Object.assign(unitParser, overrides.unitParser);
  Object.assign(manifest, overrides.manifest);
  const ap = { apIndex: { version: "1" } };
  let snapshot: any = null;
  const snapshots = {
    findOne: jest.fn(async () => snapshot),
    upsert: jest.fn(async (value) => {
      snapshot = structuredClone(value);
    }),
  };
  return {
    ap,
    uploadedFile,
    files,
    snapshots,
    validation,
    service: new ReviewReadinessService(
      files as any,
      validation as any,
      unitParser as any,
      manifest as any,
      { findOne: async () => ap } as any,
      snapshots as any,
    ),
  };
}

describe("ReviewReadinessService", () => {
  it("reports a technically complete AP as ready", async () => {
    const { service } = setup();

    await expect(service.check("ap-1")).resolves.toMatchObject({
      status: "READY",
      blockers: [],
      warnings: [],
      summary: { bookletCount: 1, unitCount: 1 },
    });
  });

  it("blocks missing referenced units without considering unrelated Unit files", async () => {
    const { service } = setup({
      unitParser: {
        validateUnitFiles: jest.fn().mockResolvedValue([
          {
            unitId: "other-unit",
            unitLabel: "Other Unit",
            files: {
              xml: { expected: "unit.xml", found: true },
              definition: { expected: "definition.voud", found: true },
              codingScheme: { expected: "coding.vocs", found: true },
              metadata: { expected: "metadata.vomd", found: false },
              player: { expected: "player", found: true },
            },
          },
        ]),
      },
    });

    const result = await service.check("ap-1");
    expect(result.status).toBe("BLOCKED");
    expect(result.blockers).toContain(
      "Für die referenzierte Unit „unit-1“ wurde keine Unit-Datei gefunden.",
    );
    expect(result.warnings).toEqual([]);
  });

  it("reports optional files of referenced Units as warnings", async () => {
    const { service } = setup({
      unitParser: {
        validateUnitFiles: jest.fn().mockResolvedValue([
          {
            unitId: "unit-1",
            unitLabel: "Unit 1",
            files: {
              xml: { expected: "unit.xml", found: true },
              definition: { expected: "definition.voud", found: true },
              codingScheme: { expected: "coding.vocs", found: true },
              metadata: { expected: "metadata.vomd", found: false },
              player: { expected: "player", found: true },
            },
          },
        ]),
      },
    });

    const result = await service.check("ap-1");
    expect(result.status).toBe("WARNING");
    expect(result.warnings).toContain(
      "Unit „Unit 1“: Metadaten „metadata.vomd“ fehlen.",
    );
  });
});

describe("persisted readiness", () => {
  it("loads the saved result and detects changes to files, index, and rules", async () => {
    const { service, ap, uploadedFile } = setup();
    expect(await service.getLast("ap-1")).toBeNull();
    const result = await service.check("ap-1");
    expect(await service.getLast("ap-1")).toEqual(result);
    uploadedFile.checksum = "v2";
    expect((await service.getLast("ap-1"))?.stale).toBe(true);
    await service.check("ap-1");
    expect((await service.getLast("ap-1"))?.stale).toBe(false);
    ap.apIndex.version = "2";
    expect((await service.getLast("ap-1"))?.stale).toBe(true);
    await service.check("ap-1");
    (service as any).rulesVersion = "new-rules";
    expect((await service.getLast("ap-1"))?.stale).toBe(true);
  });
  it("marks a result stale when content changes during validation", async () => {
    const { service, validation, uploadedFile } = setup();
    const response = await validation.autoValidateUploadedFiles();
    validation.autoValidateUploadedFiles.mockImplementation(async () => {
      uploadedFile.checksum = "changed-during-check";
      return response;
    });
    expect((await service.check("ap-1")).stale).toBe(true);
    expect((await service.getLast("ap-1"))?.stale).toBe(true);
  });
});
