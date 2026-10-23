import { AcpIndexService } from "./acp-index.service";

const name = [{ lang: "de", value: "Test" }];
const baseScale = {
  id: "base",
  method: "SCORE_SUM",
  items: [{ id: "alias_x" }],
};
const derivedScale = {
  id: "derived",
  name,
  sources: ["base"],
  method: "MAP",
  mappings: [
    {
      method: "MORE_THAN",
      parameters: ["0"],
      newValue: { value: 1, label: name },
    },
  ],
  mappingsElse: { value: 0 },
};
function indexWith(scales: Record<string, unknown> = {}): Record<string, any> {
  return {
    packageId: "pkg",
    version: "2.3.4",
    name,
    assessmentParts: [
      {
        id: "part",
        name,
        units: [
          {
            id: "u1",
            items: [{ id: "x", sourceVariable: "score" }],
            dependencies: [{ id: "u1.xml", type: "UNIT_INDEX" }],
          },
        ],
        bookletModules: [
          { id: "module", units: [{ id: "u1", alias: "alias" }] },
        ],
        instruments: [{ id: "booklet", name, testcenterBooklet: [] }],
        ...scales,
      },
    ],
  };
}

describe("ACP index 0.6", () => {
  let service: AcpIndexService;
  let acpRepository: any;
  let snapshots: any;
  beforeEach(() => {
    acpRepository = { findOne: jest.fn() };
    snapshots = { create: jest.fn() };
    service = new AcpIndexService(
      acpRepository,
      {
        find: jest
          .fn()
          .mockResolvedValue([
            { originalName: "u1.xml", relativePath: "u1.xml" },
          ]),
      } as any,
      {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((value) => value),
        save: jest.fn(),
      } as any,
      snapshots,
    );
  });

  it("validates the official base and derived scale structures and unit aliases", async () => {
    const report = await service.validateCandidate(
      "acp",
      indexWith({ baseScales: [baseScale], derivedScales: [derivedScale] }),
    );
    expect(report).toMatchObject({
      schemaId: "acp-index@0.6",
      valid: true,
      publishable: true,
      issues: [],
    });
  });

  it("rejects the old scales property and numeric mapping outputs", async () => {
    const old = await service.validateCandidate(
      "acp",
      indexWith({ scales: [] }),
    );
    expect(old.valid).toBe(false);
    const invalid = await service.validateCandidate(
      "acp",
      indexWith({
        baseScales: [baseScale],
        derivedScales: [
          {
            ...derivedScale,
            mappings: [{ method: "MAX", parameters: [], newValue: 1 }],
          },
        ],
      }),
    );
    expect(invalid.valid).toBe(false);
  });

  it("reports unknown items, unknown sources, duplicate scale IDs and cycles", async () => {
    const report = await service.validateCandidate(
      "acp",
      indexWith({
        baseScales: [{ ...baseScale, items: [{ id: "missing" }] }],
        derivedScales: [
          { id: "base", name, sources: ["missing"] },
          { id: "cycle-a", name, sources: ["cycle-b"] },
          { id: "cycle-b", name, sources: ["cycle-a"] },
        ],
      }),
    );
    expect(report.valid).toBe(true);
    expect(report.publishable).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "UNKNOWN_SCALE_ITEM",
        "UNKNOWN_SCALE_REFERENCE",
        "DUPLICATE_SCALE_ID",
        "CYCLIC_SCALE_REFERENCE",
      ]),
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "UNKNOWN_SCALE_REFERENCE",
        path: "/assessmentParts/0/derivedScales/0/sources/0",
      }),
    );
  });

  it("does not resolve scale references from a different assessment part", async () => {
    const index = indexWith({ baseScales: [baseScale] });
    const other = indexWith({ derivedScales: [derivedScale] })
      .assessmentParts[0];
    other.id = "other";
    index.assessmentParts.push(other);
    const report = await service.validateCandidate("acp", index);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "UNKNOWN_SCALE_REFERENCE",
        path: "/assessmentParts/1/derivedScales/0/sources/0",
      }),
    );
  });

  it("reports malformed scale structures without throwing", async () => {
    const report = await service.validateCandidate(
      "acp",
      indexWith({
        baseScales: [null],
        derivedScales: [{ id: "broken", sources: "base" }],
      }),
    );
    expect(report.valid).toBe(false);
  });

  it("checks both mapping and fallback references against the public vocabulary", async () => {
    const url = "https://8.8.8.8/vocabulary";
    const load = jest
      .spyOn(service as any, "loadExternalJson")
      .mockResolvedValue({
        payload: { hasTopConcept: [{ id: `${url}#valid` }] },
        check: { url, status: "cached" },
      });
    const candidate = indexWith({
      baseScales: [baseScale],
      derivedScales: [
        {
          ...derivedScale,
          publicVocabularyUrl: url,
          mappings: [
            {
              method: "MAX",
              parameters: [],
              newValue: { value: 1, publicVocabularyEntry: "#valid" },
            },
          ],
          mappingsElse: { value: 0, publicVocabularyEntry: "#missing" },
        },
      ],
    });
    const report = await service.validateCandidate("acp", candidate, {
      external: true,
      forPublication: true,
    });
    expect(load).toHaveBeenCalledWith(url, true);
    expect(report.publishable).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "UNKNOWN_SCALE_VOCABULARY_ENTRY",
        path: "/assessmentParts/0/derivedScales/0/mappingsElse/publicVocabularyEntry",
      }),
    ]);
    candidate.assessmentParts[0].derivedScales[0].mappingsElse.publicVocabularyEntry =
      "#valid";
    await expect(
      service.validateCandidate("acp", candidate, { external: true }),
    ).resolves.toMatchObject({ publishable: true });
  });

  it("requires a vocabulary URL for vocabulary suffixes and blocks unavailable vocabularies", async () => {
    const candidate = indexWith({
      baseScales: [baseScale],
      derivedScales: [
        {
          ...derivedScale,
          mappingsElse: { value: 0, publicVocabularyEntry: "#x" },
        },
      ],
    });
    const report = await service.validateCandidate("acp", candidate);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "MISSING_SCALE_VOCABULARY" }),
    );
    candidate.assessmentParts[0].derivedScales[0].publicVocabularyUrl =
      "https://8.8.8.8/vocabulary";
    jest.spyOn(service as any, "loadExternalJson").mockResolvedValue({
      check: { url: "https://8.8.8.8/vocabulary", status: "unavailable" },
    });
    await expect(
      service.validateCandidate("acp", candidate, { external: true }),
    ).resolves.toMatchObject({
      publishable: false,
      issues: [
        expect.objectContaining({ code: "SCALE_VOCABULARY_UNAVAILABLE" }),
      ],
    });
  });

  it("migrates base, mapped and unweighted aggregate scales without changing the package version", async () => {
    const old = indexWith({
      scales: [
        {
          id: "base",
          name,
          scaleType: "BASE",
          typeParameters: {
            method: "SCORE_SUM",
            items: [{ id: "alias_x", weight: 2 }],
          },
        },
        {
          id: "mapped",
          name,
          scaleType: "DERIVED",
          typeParameters: {
            source: "base",
            mappings: [
              {
                method: "MORE_THAN",
                parameters: ["0"],
                newValue: 1,
                valueLabel: name,
                valueDescription: name,
              },
            ],
            elseValueLabel: name,
          },
        },
        {
          id: "total",
          name,
          scaleType: "AGGREGATED",
          typeParameters: {
            sources: [{ id: "base" }, { id: "mapped", weight: 1 }],
          },
        },
      ],
    });
    const original = structuredClone(old);
    acpRepository.findOne.mockResolvedValue({
      acpIndex: old,
      updatedAt: new Date("2026-10-23T12:00:00Z"),
    });
    const preview = await service.migrationPreview("acp");
    expect(preview.validation).toMatchObject({
      valid: true,
      publishable: true,
    });
    expect(preview.candidateIndex.version).toBe("2.3.4");
    const part = (preview.candidateIndex as any).assessmentParts[0];
    expect(part.scales).toBeUndefined();
    expect(part.baseScales[0].items[0].weight).toBe(2);
    expect(part.derivedScales[0]).toMatchObject({
      sources: ["base"],
      method: "MAP",
      mappings: [{ newValue: { value: 1, label: name, description: name } }],
      mappingsElse: { value: 0, label: name },
    });
    expect(part.derivedScales[1]).toMatchObject({
      method: "SUM",
      sources: ["base", "mapped"],
    });
    expect(old).toEqual(original);
    acpRepository.findOne.mockResolvedValue({
      acpIndex: preview.candidateIndex,
      updatedAt: new Date(),
    });
    expect((await service.migrationPreview("acp")).changes).toEqual([]);
  });

  it.each(["weights", "vocabularies", "invalid"])(
    "keeps %s requiring review and refuses to apply a lossy migration",
    async (reason) => {
      const scale =
        reason === "weights"
          ? {
              id: "legacy",
              name,
              scaleType: "AGGREGATED",
              typeParameters: {
                sources: [{ id: "a", weight: 0.5 }, { id: "b" }],
              },
            }
          : reason === "vocabularies"
            ? {
                id: "legacy",
                name,
                scaleType: "DERIVED",
                typeParameters: {
                  source: "a",
                  mappings: [{ method: "MAX", parameters: ["0"], newValue: 1 }],
                  relatedVocabularies: [
                    {
                      url: "https://example.org/vocabulary",
                      values: [
                        { value: 1, url: "https://example.org/vocabulary#x" },
                      ],
                    },
                  ],
                },
              }
            : { id: "legacy", scaleType: "UNKNOWN" };
      acpRepository.findOne.mockResolvedValue({
        acpIndex: indexWith({ scales: [scale] }),
        updatedAt: new Date(),
      });
      const preview = await service.migrationPreview("acp");
      expect((preview.candidateIndex as any).assessmentParts[0].scales).toEqual(
        [scale],
      );
      expect(preview.unresolved).toContainEqual(
        expect.objectContaining({ code: "SCALE_MIGRATION_REVIEW_REQUIRED" }),
      );
      await expect(service.migrate("acp", "revision")).rejects.toThrow(
        "Migration has unresolved schema errors",
      );
      expect(snapshots.create).not.toHaveBeenCalled();
    },
  );
});
