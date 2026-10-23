import { ReviewManifestService } from "../review/review-manifest.service";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ValidationService } from "./validation.service";
import { AcpFile, Acp } from "../database/entities";
import * as fs from "fs/promises";

jest.mock("fs/promises", () => ({
  readFile: jest.fn(),
}));

describe("ValidationService", () => {
  let service: ValidationService;
  let manifestService: ReviewManifestService;
  let fileRepo: any;
  let acpRepo: any;

  beforeEach(async () => {
    fileRepo = {
      find: jest.fn(),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };
    acpRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidationService,
        {
          provide: ReviewManifestService,
          useValue: {
            getManifest: jest
              .fn()
              .mockResolvedValue({ booklets: [], units: [], issues: [] }),
          },
        },
        { provide: getRepositoryToken(AcpFile), useValue: fileRepo },
        { provide: getRepositoryToken(Acp), useValue: acpRepo },
      ],
    }).compile();

    service = module.get<ValidationService>(ValidationService);
    manifestService = module.get(ReviewManifestService);
  });

  it("includes Booklet reference errors in upload consistency validation", async () => {
    acpRepo.findOne.mockResolvedValue({ acpIndex: {} });
    fileRepo.find.mockResolvedValue([]);
    const issue = {
      severity: "error" as const,
      path: "review.xml/Booklet/Units/Unit[0]",
      message: "Unbekannte Unit: missing",
    };
    jest
      .mocked(manifestService.getManifest)
      .mockResolvedValue({ booklets: [], units: [], issues: [issue] });
    const result = await service.validateAcpConsistency("acp-1");
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(issue);
  });

  it("validates malformed Booklet navigation on upload", async () => {
    const result = await service.validateFile(
      { originalName: "b.xml" } as AcpFile,
      Buffer.from(
        "<Booklet><Metadata><Id>b</Id></Metadata><Units><ProgressEnd/></Units></Booklet>",
      ),
      false,
    );
    expect(result.valid).toBe(false);
    expect(result.issues[0].path).toContain("ProgressEnd");
  });

  describe("validateFile", () => {
    it("should validate valid JSON file", async () => {
      const file = { originalName: "data.json" } as AcpFile;
      const buffer = Buffer.from('{"key": "value"}');
      const result = await service.validateFile(file, buffer);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("should report error for invalid JSON", async () => {
      const file = { originalName: "bad.json" } as AcpFile;
      const buffer = Buffer.from("not json{");
      const result = await service.validateFile(file, buffer);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.severity === "error")).toBe(true);
    });

    it("should warn on empty file", async () => {
      const file = { originalName: "empty.txt" } as AcpFile;
      const buffer = Buffer.alloc(0);
      const result = await service.validateFile(file, buffer);
      expect(
        result.issues.some(
          (i) => i.severity === "warning" && i.message.includes("empty"),
        ),
      ).toBe(true);
    });

    it("should report schema errors for ACP index JSON with invalid required fields", async () => {
      const file = { originalName: "acp-index.json" } as AcpFile;
      const buffer = Buffer.from(
        JSON.stringify({
          version: "",
          status: "INVALID_STATUS",
          assessmentParts: [],
        }),
      );

      const result = await service.validateFile(file, buffer);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.path === "packageId")).toBe(true);
      expect(result.issues.some((i) => i.path === "status")).toBe(true);
    });

    it("should reject XML files that do not start with markup", async () => {
      const file = { originalName: "unit.xml" } as AcpFile;
      const result = await service.validateFile(file, Buffer.from("not-xml"));

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: "File does not appear to be valid XML",
          }),
        ]),
      );
    });

    it("can skip persistence when requested", async () => {
      const file = {
        originalName: "unit.xml",
        validationResult: null,
      } as unknown as AcpFile;
      const result = await service.validateFile(
        file,
        Buffer.from("<root/>"),
        false,
      );

      expect(result.valid).toBe(true);
      expect(fileRepo.save).not.toHaveBeenCalled();
    });

    it("validates nested ACP index schema structure errors", async () => {
      const file = { originalName: "acp-index.json" } as AcpFile;
      const buffer = Buffer.from(
        JSON.stringify({
          packageId: "pkg-1",
          version: "0.5.0",
          status: "IN_DEVELOPMENT",
          assessmentParts: [
            null,
            {
              bookletModules: {},
              instruments: {},
            },
            {
              bookletModules: [{ id: "", units: {} }],
              instruments: [
                {
                  testcenterBooklet: [{ modules: {} }, { modules: [{}] }],
                },
              ],
            },
          ],
        }),
      );

      const result = await service.validateFile(file, buffer);
      const issuePaths = result.issues.map((i) => i.path);

      expect(result.valid).toBe(false);
      expect(issuePaths).toEqual(
        expect.arrayContaining([
          "assessmentParts[0]",
          "assessmentParts[1].bookletModules",
          "assessmentParts[1].instruments",
          "assessmentParts[2].bookletModules[0].id",
          "assessmentParts[2].bookletModules[0].units",
          "assessmentParts[2].instruments[0].testcenterBooklet[0].modules",
          "assessmentParts[2].instruments[0].testcenterBooklet[1].modules[0]",
        ]),
      );
    });

    it("skips schema validation for unrelated JSON files", async () => {
      const file = { originalName: "any.json" } as AcpFile;
      const buffer = Buffer.from(JSON.stringify({ foo: "bar" }));
      const result = await service.validateFile(file, buffer);

      expect(result).toEqual(
        expect.objectContaining({ valid: true, issues: [] }),
      );
    });
  });

  describe("validateAcpConsistency", () => {
    it("should detect missing file references", async () => {
      acpRepo.findOne.mockResolvedValue({
        id: "acp-1",
        acpIndex: {
          units: [
            {
              id: "u1",
              dependencies: [{ id: "missing-file.xml", type: "PLAYER" }],
            },
          ],
          assessmentParts: [],
        },
      });
      fileRepo.find.mockResolvedValue([]); // no files

      const result = await service.validateAcpConsistency("acp-1");
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.message.includes("missing-file.xml")),
      ).toBe(true);
    });

    it("should pass when all references exist", async () => {
      acpRepo.findOne.mockResolvedValue({
        id: "acp-1",
        acpIndex: {
          units: [
            { id: "u1", dependencies: [{ id: "player.html", type: "PLAYER" }] },
          ],
          assessmentParts: [
            {
              bookletModules: [{ id: "mod-1", units: [{ id: "u1" }] }],
              instruments: [
                {
                  id: "inst-1",
                  testcenterBooklet: [
                    { definitionId: "booklet.xml", modules: ["mod-1"] },
                  ],
                },
              ],
            },
          ],
        },
      });
      fileRepo.find.mockResolvedValue([
        { originalName: "player.html" },
        { originalName: "booklet.xml" },
      ]);

      const result = await service.validateAcpConsistency("acp-1");
      expect(result.valid).toBe(true);
    });

    it("should report missing module references with precise ACP path", async () => {
      acpRepo.findOne.mockResolvedValue({
        id: "acp-1",
        acpIndex: {
          assessmentParts: [
            {
              units: [{ id: "u1", dependencies: [] }],
              bookletModules: [{ id: "mod-1", units: [{ id: "u1" }] }],
              instruments: [
                {
                  id: "inst-1",
                  testcenterBooklet: [
                    {
                      definitionId: "booklet.xml",
                      modules: [{ moduleId: "mod-missing" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
      fileRepo.find.mockResolvedValue([{ originalName: "booklet.xml" }]);

      const result = await service.validateAcpConsistency("acp-1");
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "assessmentParts[0].instruments[0].testcenterBooklet[0].modules[0].moduleId",
          }),
        ]),
      );
    });

    it.each(["scales", "baseScales"])(
      "should validate assessmentParts %s and report precise item paths",
      async (kind) => {
        acpRepo.findOne.mockResolvedValue({
          id: "acp-1",
          acpIndex: {
            assessmentParts: [
              {
                units: [
                  {
                    id: "u1",
                    dependencies: [],
                    items: [{ id: "i1", useUnitAliasAsPrefix: true }],
                  },
                ],
                [kind]: [
                  {
                    id: "scale-1",
                    ...(kind === "baseScales"
                      ? { items: [{ id: "u1_missing-item" }] }
                      : {
                          typeParameters: {
                            items: [{ id: "u1_missing-item" }],
                          },
                        }),
                  },
                ],
              },
            ],
          },
        });
        fileRepo.find.mockResolvedValue([]);

        const result = await service.validateAcpConsistency("acp-1");
        expect(result.valid).toBe(true);
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: expect.stringContaining("scale-1"),
              path: `assessmentParts[0].${kind}[0].${kind === "baseScales" ? "items" : "typeParameters.items"}[0].id`,
            }),
          ]),
        );
      },
    );

    it("should return error for unknown ACP", async () => {
      acpRepo.findOne.mockResolvedValue(null);
      const result = await service.validateAcpConsistency("bad");
      expect(result.valid).toBe(false);
    });
  });

  describe("autoValidateUploadedFiles", () => {
    it("should run file and semantic validation and persist merged per-file results", async () => {
      const readFileMock = fs.readFile as jest.Mock;
      readFileMock.mockResolvedValue(
        Buffer.from(
          JSON.stringify({
            packageId: "pkg-1",
            version: "0.5.0",
            status: "RELEASED_PUBLIC",
            assessmentParts: [],
          }),
        ),
      );

      acpRepo.findOne.mockResolvedValue({
        id: "acp-1",
        acpIndex: {
          assessmentParts: [
            {
              units: [
                {
                  id: "u1",
                  dependencies: [{ id: "missing-player.html", type: "PLAYER" }],
                },
              ],
            },
          ],
        },
      });
      fileRepo.find.mockResolvedValue([
        { originalName: "uploaded-acp-index.json" },
      ]);

      const uploadedFile = {
        id: "file-1",
        acpId: "acp-1",
        filePath: "/tmp/uploaded-acp-index.json",
        originalName: "uploaded-acp-index.json",
      } as AcpFile;

      const result = await service.autoValidateUploadedFiles("acp-1", [
        uploadedFile,
      ]);

      expect(result.summary.totalFiles).toBe(1);
      expect(result.summary.semanticValid).toBe(false);
      expect(result.files[0].validationResult).toBeDefined();
      expect(
        (result.files[0].validationResult as any).issues.some(
          (i: any) => i.scope === "semantic",
        ),
      ).toBe(true);
      expect(fileRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: "file-1" })]),
      );
    });

    it("returns an empty summary when no files are provided", async () => {
      const result = await service.autoValidateUploadedFiles("acp-1", []);

      expect(result.files).toEqual([]);
      expect(result.summary).toEqual(
        expect.objectContaining({
          totalFiles: 0,
          validFiles: 0,
          invalidFiles: 0,
          semanticValid: true,
          semanticIssueCount: 0,
        }),
      );
    });

    it("creates file-level errors when uploaded files are missing on disk", async () => {
      const readFileMock = fs.readFile as jest.Mock;
      readFileMock.mockRejectedValue(new Error("missing"));

      acpRepo.findOne.mockResolvedValue({
        id: "acp-1",
        acpIndex: { assessmentParts: [] },
      });
      fileRepo.find.mockResolvedValue([]);

      const uploadedFile = {
        id: "file-2",
        acpId: "acp-1",
        filePath: "/tmp/missing.json",
        originalName: "missing.json",
      } as AcpFile;

      const result = await service.autoValidateUploadedFiles("acp-1", [
        uploadedFile,
      ]);

      expect(result.files[0].validationResult).toEqual(
        expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({
              message: "File is missing on disk and could not be validated",
            }),
          ]),
        }),
      );
      expect(result.summary.invalidFiles).toBe(1);
    });
  });
});
