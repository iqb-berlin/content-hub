import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AcpIndexService } from "../acp/acp-index.service";
import { IndexGenerationService } from "./index-generation.service";

describe("IndexGenerationService", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "acp-index-generator-"));
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
        acpId: "acp",
        filePath,
        originalName: path.basename(relativePath),
        relativePath,
        checksum: crypto.createHash("sha256").update(content).digest("hex"),
        fileSize: content.length,
      });
    }
    const acp = {
      id: "acp",
      packageId: "pkg",
      name: "Paket",
      description: "",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      itemProperties: {},
      acpIndex: {
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
                dependencies: [],
                items: [{ id: "item-1", sourceVariable: "score" }],
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
    const acpRepository = {
      findOne: jest.fn(async () => acp),
      save: jest.fn(async (value) => value),
    } as any;
    const fileRepository = { find: jest.fn(async () => files) } as any;
    const cacheRepository = {
      findOne: jest.fn(async () => null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    } as any;
    const snapshotsService = { create: jest.fn() } as any;
    const indexService = new AcpIndexService(
      acpRepository,
      fileRepository,
      cacheRepository,
      snapshotsService,
    );
    const service = new IndexGenerationService(
      acpRepository,
      fileRepository,
      indexService,
      snapshotsService,
    );

    const preview = await service.preview("acp");
    const parts = (preview.candidateIndex as any).assessmentParts;
    expect(parts.map((part: any) => [part.id, part.units.length])).toEqual([
      ["ma1", 2],
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
    expect(parts[2]).toEqual(acp.acpIndex.assessmentParts[1]);
    expect(preview.validation.valid).toBe(true);
    expect(preview.validation.publishable).toBe(false);
    expect(preview.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNKNOWN_UNIT_REFERENCE" }),
      ]),
    );

    files[0].checksum = "changed-after-preview";
    await expect(
      service.apply("acp", {
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
