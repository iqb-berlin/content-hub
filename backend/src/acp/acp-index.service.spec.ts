import { AcpIndexService } from "./acp-index.service";

describe("AcpIndexService", () => {
  const acpRepository = {
    findOne: jest.fn(),
    save: jest.fn(async (value) => value),
  } as any;
  const fileRepository = { find: jest.fn(async () => []) } as any;
  const cacheRepository = {
    findOne: jest.fn(async () => null),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  } as any;
  const snapshotsService = { create: jest.fn() } as any;

  let service: AcpIndexService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AcpIndexService(
      acpRepository,
      fileRepository,
      cacheRepository,
      snapshotsService,
    );
  });

  it("accepts the schema-conformant empty index and rejects legacy top-level fields", async () => {
    const empty = {
      packageId: "pkg",
      version: "1.0.0",
      name: [{ lang: "de", value: "Paket" }],
      status: "IN_DEVELOPMENT",
    };
    await expect(
      service.validateCandidate("acp", empty),
    ).resolves.toMatchObject({
      schemaId: "acp-index@0.6",
      valid: true,
      publishable: true,
    });

    const invalid = await service.validateCandidate("acp", {
      ...empty,
      units: [],
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SCHEMA_ADDITIONALPROPERTIES" }),
      ]),
    );
  });

  it("reports SemVer and part-scoped semantic/file errors", async () => {
    const report = await service.validateCandidate("acp", {
      packageId: "pkg",
      version: "latest",
      name: [{ lang: "de", value: "Paket" }],
      assessmentParts: [
        {
          id: "p1",
          name: [{ lang: "de", value: "Teil" }],
          units: [
            {
              id: "u1",
              dependencies: [{ id: "units/p1/u1.xml", type: "UNIT_INDEX" }],
            },
          ],
          bookletModules: [{ id: "m1", units: [{ id: "missing" }] }],
          instruments: [
            {
              id: "i1",
              name: [{ lang: "de", value: "I" }],
              testcenterBooklet: [
                {
                  definitionId: "booklets/i1.xml",
                  modules: [{ moduleId: "missing-module" }],
                },
              ],
              handOutsForTestTaker: [
                {
                  file: [
                    [
                      {
                        id: "missing-handout.pdf",
                        lang: "de",
                        label: "Handout",
                      },
                    ],
                  ],
                },
              ],
            },
          ],
          additionalDocuments: [
            {
              contentType: "STUDY_BACKGROUND",
              targeting: ["TEACHER"],
              file: [
                {
                  id: "missing-background.pdf",
                  lang: "de",
                  label: "Hintergrund",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "INVALID_SEMVER",
        "MISSING_FILE",
        "MISSING_BOOKLET_FILE",
        "UNKNOWN_UNIT_REFERENCE",
        "UNKNOWN_MODULE_REFERENCE",
      ]),
    );
    expect(report.publishable).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MISSING_FILE",
          path: expect.stringContaining("handOutsForTestTaker"),
        }),
        expect.objectContaining({
          code: "MISSING_FILE",
          path: expect.stringContaining("additionalDocuments"),
        }),
      ]),
    );
  });

  it("migrates dependency objects/types and item metadata without data loss", async () => {
    acpRepository.findOne.mockResolvedValue({
      id: "acp",
      packageId: "pkg",
      name: "Paket",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      itemProperties: {},
      acpIndex: {
        packageId: "pkg",
        version: "1.0.0",
        name: [{ lang: "de", value: "Paket" }],
        assessmentParts: [
          {
            id: "p1",
            name: [{ lang: "de", value: "Teil" }],
            units: [
              {
                id: "u1",
                dependencies: { id: "./u1.voud", type: "UNIT_DEFINITION" },
                items: [{ id: "x", sourceVariable: "v", metadata: { a: "b" } }],
              },
            ],
            bookletModules: [{ id: "m", units: [{ id: "u1" }] }],
            instruments: [
              {
                id: "i",
                name: [{ lang: "de", value: "I" }],
                testcenterBooklet: [
                  { definitionId: "booklet.xml", modules: [{ moduleId: "m" }] },
                ],
              },
            ],
          },
        ],
      },
    });
    fileRepository.find.mockResolvedValue([
      { originalName: "u1.voud", relativePath: "u1.voud" },
      { originalName: "booklet.xml", relativePath: "booklet.xml" },
    ]);

    const preview = await service.migrationPreview("acp");
    const unit = (preview.candidateIndex as any).assessmentParts[0].units[0];
    expect(unit.dependencies).toEqual([
      { id: "u1.voud", type: "UNIT_UI_DEFINITION" },
    ]);
    expect(unit.items[0].metadata).toBeUndefined();
    expect(preview.candidateItemProperties["p1/u1/x"]).toEqual({
      metadata: { a: "b" },
    });
  });

  it("accepts a successful vocabulary cache for at most seven days on publish", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("offline"));
    const url = "https://8.8.8.8/vocabulary";
    cacheRepository.findOne.mockResolvedValue({
      url,
      payload: { id: url, hasTopConcept: [] },
      status: "valid",
      lastSuccessAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
    });
    const fresh = await (service as any).loadExternalJson(url, true);
    expect(fresh.check.status).toBe("cached");

    cacheRepository.findOne.mockResolvedValue({
      url,
      payload: { id: url, hasTopConcept: [] },
      status: "valid",
      lastSuccessAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    const stale = await (service as any).loadExternalJson(url, true);
    expect(stale.check.status).toBe("unavailable");
    fetchSpy.mockRestore();
  });

  it("uses a cache younger than 24 hours without a network request", async () => {
    const url = "https://8.8.8.8/profile";
    cacheRepository.findOne.mockResolvedValue({
      url,
      payload: { id: url, groups: [] },
      status: "valid",
      lastSuccessAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const fetchSpy = jest.spyOn(global, "fetch");

    const result = await (service as any).loadExternalJson(url, true);

    expect(result.check.status).toBe("cached");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("refreshes the successful cache timestamp after HTTP 304", async () => {
    const url = "https://8.8.8.8/profile";
    const cached = {
      url,
      payload: { id: url, groups: [] },
      status: "valid",
      lastSuccessAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      etag: '"profile-v1"',
    };
    cacheRepository.findOne.mockResolvedValue(cached);
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, {
        status: 304,
        headers: { etag: '"profile-v1"' },
      }),
    );

    const result = await (service as any).loadExternalJson(url, true);

    expect(result.check.status).toBe("valid");
    expect(cached.lastSuccessAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(cacheRepository.save).toHaveBeenCalledWith(cached);
    fetchSpy.mockRestore();
  });

  it("does not use an old cache when the current resource is known to be invalid", async () => {
    const url = "https://8.8.8.8/profile";
    const cached = {
      url,
      payload: { id: url, groups: [] },
      status: "valid",
      lastSuccessAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    };
    cacheRepository.findOne.mockResolvedValue(cached);
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockRejectedValue(new Error("offline"));

    const result = await (service as any).loadExternalJson(url, true);
    const retry = await (service as any).loadExternalJson(url, true);
    const laterRetry = await (service as any).loadExternalJson(url, true);

    expect(result.payload).toBeUndefined();
    expect(result.check.status).toBe("invalid");
    expect(cached.status).toBe("invalid");
    expect(retry.payload).toBeUndefined();
    expect(retry.check.status).toBe("unavailable");
    expect(laterRetry.payload).toBeUndefined();
    expect(laterRetry.check.status).toBe("unavailable");
    fetchSpy.mockRestore();
  });

  it("aborts an external response once the streamed body exceeds 1 MB", async () => {
    const url = "https://8.8.8.8/profile";
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024));
            controller.enqueue(new Uint8Array([1]));
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );

    const result = await (service as any).loadExternalJson(url, true);

    expect(result.payload).toBeUndefined();
    expect(result.check.status).toBe("invalid");
    fetchSpy.mockRestore();
  });

  it("blocks private IPv4-mapped IPv6 addresses", () => {
    expect((service as any).isPrivateAddress("::ffff:7f00:1")).toBe(true);
    expect((service as any).isPrivateAddress("2001:4860:4860::8888")).toBe(
      false,
    );
  });
});
