import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ApIndexService } from "../ap/ap-index.service";
import { IndexGenerationService } from "./index-generation.service";

describe("IndexGenerationService", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ap-index-generator-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("keeps duplicate unit ids separate by part and creates modules/instruments", async () => {
    const definitions = [
      ["units/Ma1/shared.xml", unitXml("shared")],
      ["units/Ma1/ma.xml", unitXml("ma")],
      ["units/Sp1/shared.xml", unitXml("shared")],
      ["units/Sp1/sp.xml", unitXml("sp")],
      [
        "booklets/ma.xml",
        bookletXml("ma-booklet", ["shared", "ma", "missing"]),
      ],
      ["booklets/sp.xml", bookletXml("sp-booklet", ["shared", "sp"])],
    ];
    const files: any[] = [];
    for (const [relativePath, content] of definitions) {
      const filePath = path.join(tempDir, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
      files.push({
        id: crypto.randomUUID(),
        apId: "ap",
        filePath,
        originalName: path.basename(relativePath),
        relativePath,
        checksum: crypto.createHash("sha256").update(content).digest("hex"),
        fileSize: content.length,
      });
    }
    const ap = {
      id: "ap",
      packageId: "pkg",
      name: "Paket",
      description: "",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      itemProperties: {},
      apIndex: {
        packageId: "pkg",
        version: "1.0.0",
        name: [{ lang: "de", value: "Paket" }],
        status: "IN_DEVELOPMENT",
        assessmentParts: [
          {
            id: "ma1",
            units: [
              {
                id: "shared",
                dependencies: [{ id: "manual.html", type: "WIDGET" }],
                name: "Manuell benannt",
                items: [{ id: "item-1", sourceVariable: "score" }],
              },
              {
                id: "only-in-index",
                dependencies: [{ id: "manual.html", type: "WIDGET" }],
                items: [{ id: "x", sourceVariable: "v" }],
              },
            ],
          },
          {
            id: "manual",
            name: [{ lang: "de", value: "Manuell" }],
            units: [
              {
                id: "manual-unit",
                dependencies: [{ id: "units/Ma1/ma.xml", type: "UNIT_INDEX" }],
              },
            ],
            bookletModules: [
              { id: "manual-module", units: [{ id: "manual-unit" }] },
            ],
            instruments: [
              {
                id: "manual-instrument",
                name: [{ lang: "de", value: "Manuell" }],
                testcenterBooklet: [
                  {
                    definitionId: "booklets/manual.xml",
                    modules: [{ moduleId: "manual-module" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const apRepository = {
      findOne: jest.fn(async () => ap),
      save: jest.fn(async (value) => value),
    } as any;
    const fileRepository = { find: jest.fn(async () => files) } as any;
    const cacheRepository = {
      findOne: jest.fn(async () => null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    } as any;
    const snapshotsService = { create: jest.fn() } as any;
    const indexService = new ApIndexService(
      apRepository,
      fileRepository,
      cacheRepository,
      snapshotsService,
    );
    const service = new IndexGenerationService(
      apRepository,
      fileRepository,
      indexService,
      snapshotsService,
    );

    const preview = await service.preview("ap");
    const parts = (preview.candidateIndex as any).assessmentParts;
    expect(parts.map((part: any) => [part.id, part.units.length])).toEqual([
      ["ma1", 3],
      ["sp1", 2],
      ["manual", 1],
    ]);
    expect(
      parts[0].bookletModules[0].units.map((entry: any) => entry.id),
    ).toEqual(["shared", "ma", "missing"]);
    expect(parts[0].instruments[0].testcenterBooklet[0].definitionId).toBe(
      "booklets/ma.xml",
    );
    expect(parts[0].units[0].items).toEqual([
      { id: "item-1", sourceVariable: "score" },
    ]);
    expect(parts[0].units[1]).toEqual(ap.apIndex.assessmentParts[0].units[1]);
    expect(parts[0].units[0].name).toBe("Manuell benannt");
    expect(parts[0].units[0].dependencies).toContainEqual({
      id: "manual.html",
      type: "WIDGET",
    });
    expect(preview.warnings).toContainEqual(
      expect.stringContaining("only-in-index"),
    );
    expect(parts[2]).toEqual(ap.apIndex.assessmentParts[1]);
    expect(preview.validation.valid).toBe(true);
    expect(preview.validation.publishable).toBe(false);
    expect(preview.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNKNOWN_UNIT_REFERENCE" }),
      ]),
    );

    const applied = await service.apply("ap", {
      sourceRevision: preview.sourceRevision,
      expectedUpdatedAt: preview.sourceUpdatedAt,
    });
    expect(applied.index).toEqual(preview.candidateIndex);
    expect((await service.preview("ap")).candidateIndex).toEqual(applied.index);
    expect(snapshotsService.create).toHaveBeenCalledTimes(1);
    snapshotsService.create.mockClear();

    files[0].checksum = "changed-after-preview";
    await expect(
      service.apply("ap", {
        sourceRevision: preview.sourceRevision,
        expectedUpdatedAt: preview.sourceUpdatedAt,
      }),
    ).rejects.toThrow("Files changed since index preview");
    expect(snapshotsService.create).not.toHaveBeenCalled();
  });
});

function unitXml(id: string): string {
  return `<Unit><Metadata><Id>${id}</Id><Label>${id}</Label></Metadata></Unit>`;
}

function bookletXml(id: string, unitIds: string[]): string {
  return `<Booklet><Metadata><Id>${id}</Id><Label>${id}</Label></Metadata><Units>${unitIds
    .map((unitId) => `<Unit id="${unitId}"/>`)
    .join("")}</Units></Booklet>`;
}
