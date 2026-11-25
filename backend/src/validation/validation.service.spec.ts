import { ReviewManifestService } from "../review/review-manifest.service";
import { buildReviewManifest } from "../review/review-manifest";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ValidationService } from "./validation.service";
import { ApFile, Ap } from "../database/entities";
import * as fs from "fs/promises";

jest.mock("fs/promises", () => ({
  readFile: jest.fn(),
}));

describe("ValidationService", () => {
  let service: ValidationService;
  let manifestService: ReviewManifestService;
  let fileRepo: any;
  let apRepo: any;

  beforeEach(async () => {
    fileRepo = {
      find: jest.fn(),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };
    apRepo = {
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
        { provide: getRepositoryToken(ApFile), useValue: fileRepo },
        { provide: getRepositoryToken(Ap), useValue: apRepo },
      ],
    }).compile();

    service = module.get<ValidationService>(ValidationService);
    manifestService = module.get(ReviewManifestService);
  });

  it("includes Booklet reference errors in upload consistency validation", async () => {
    apRepo.findOne.mockResolvedValue({ apIndex: {} });
    fileRepo.find.mockResolvedValue([]);
    const issue = {
      severity: "error" as const,
      path: "review.xml/Booklet/Units/Unit[0]",
      message: "Unbekannte Unit: missing",
    };
    jest
      .mocked(manifestService.getManifest)
      .mockResolvedValue({ booklets: [], units: [], issues: [issue] });
    const result = await service.validateApConsistency("ap-1");
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(issue);
  });

  it("validates malformed Booklet navigation on upload", async () => {
    const result = await service.validateFile(
      { originalName: "b.xml" } as ApFile,
      Buffer.from(
        "<Booklet><Metadata><Id>b</Id></Metadata><Units><ProgressEnd/></Units></Booklet>",
      ),
      false,
    );
    expect(result.valid).toBe(false);
    expect(result.issues[0].path).toContain("ProgressEnd");
  });

  describe("validateFile", () => {
    it.each([
      ["ap-index.json", "[]"],
      ["acp-index.json", "[]"],
      ["uploaded-acp-index.json", "{}"],
      ["ACP-INDEX.JSON", "{}"],
    ])(
      "keeps schema checks for current and legacy index filename %s",
      async (originalName, payload) => {
        const result = await service.validateFile(
          { originalName } as ApFile,
          Buffer.from(payload),
        );
        expect(result.valid).toBe(false);
        expect(result.issues.some((issue) => issue.scope === "schema")).toBe(
          true,
        );
      },
    );
    it("should validate valid JSON file", async () => {
      const file = { originalName: "data.json" } as ApFile;
      const buffer = Buffer.from('{"key": "value"}');
      const result = await service.validateFile(file, buffer);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("should report error for invalid JSON", async () => {
      const file = { originalName: "bad.json" } as ApFile;
      const buffer = Buffer.from("not json{");
      const result = await service.validateFile(file, buffer);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.severity === "error")).toBe(true);
    });

    it("should warn on empty file", async () => {
      const file = { originalName: "empty.txt" } as ApFile;
      const buffer = Buffer.alloc(0);
      const result = await service.validateFile(file, buffer);
      expect(
        result.issues.some(
          (i) => i.severity === "warning" && i.message.includes("empty"),
        ),
      ).toBe(true);
    });

    it("should report schema errors for AP index JSON with invalid required fields", async () => {
      const file = { originalName: "ap-index.json" } as ApFile;
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
      const file = { originalName: "unit.xml" } as ApFile;
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
      } as unknown as ApFile;
      const result = await service.validateFile(
        file,
        Buffer.from("<root/>"),
        false,
      );

      expect(result.valid).toBe(true);
      expect(fileRepo.save).not.toHaveBeenCalled();
    });

    it("validates nested AP index schema structure errors", async () => {
      const file = { originalName: "ap-index.json" } as ApFile;
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
      const file = { originalName: "any.json" } as ApFile;
      const buffer = Buffer.from(JSON.stringify({ foo: "bar" }));
      const result = await service.validateFile(file, buffer);

      expect(result).toEqual(
        expect.objectContaining({ valid: true, issues: [] }),
      );
    });
  });

  describe("validateApConsistency", () => {
    it("should detect missing file references", async () => {
      apRepo.findOne.mockResolvedValue({
        id: "ap-1",
        apIndex: {
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

      const result = await service.validateApConsistency("ap-1");
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.message.includes("missing-file.xml")),
      ).toBe(true);
    });

    it("should pass when all references exist", async () => {
      apRepo.findOne.mockResolvedValue({
        id: "ap-1",
        apIndex: {
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

      const result = await service.validateApConsistency("ap-1");
      expect(result.valid).toBe(true);
    });

    it("should report missing module references with precise AP path", async () => {
      apRepo.findOne.mockResolvedValue({
        id: "ap-1",
        apIndex: {
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

      const result = await service.validateApConsistency("ap-1");
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "assessmentParts[0].instruments[0].testcenterBooklet[0].modules[0].moduleId",
          }),
        ]),
      );
    });

    it("should validate assessmentParts scales and report precise item paths", async () => {
      apRepo.findOne.mockResolvedValue({
        id: "ap-1",
        apIndex: {
          assessmentParts: [
            {
              units: [
                {
                  id: "u1",
                  dependencies: [],
                  items: [{ id: "i1", useUnitAliasAsPrefix: true }],
                },
              ],
              scales: [
                {
                  id: "scale-1",
                  typeParameters: {
                    items: [{ id: "u1_missing-item" }],
                  },
                },
              ],
            },
          ],
        },
      });
      fileRepo.find.mockResolvedValue([]);

      const result = await service.validateApConsistency("ap-1");
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining("scale-1"),
            path: "assessmentParts[0].scales[0].typeParameters.items[0].id",
          }),
        ]),
      );
    });

    it("should return error for unknown AP", async () => {
      apRepo.findOne.mockResolvedValue(null);
      const result = await service.validateApConsistency("bad");
      expect(result.valid).toBe(false);
    });
  });

  describe("autoValidateUploadedFiles", () => {
    it("keeps missing AP references separate from persisted file results", async () => {
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

      apRepo.findOne.mockResolvedValue({
        id: "ap-1",
        apIndex: {
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
        { originalName: "uploaded-ap-index.json" },
      ]);

      const uploadedFile = {
        id: "file-1",
        apId: "ap-1",
        filePath: "/tmp/uploaded-ap-index.json",
        originalName: "uploaded-ap-index.json",
      } as ApFile;

      const result = await service.autoValidateUploadedFiles("ap-1", [
        uploadedFile,
      ]);

      expect(result.summary.totalFiles).toBe(1);
      expect(result.summary.semanticValid).toBe(false);
      expect(result.summary.validFiles).toBe(1);
      expect(result.summary.invalidFiles).toBe(0);
      expect(result.files[0].validationResult).toEqual(
        expect.objectContaining({ valid: true, issues: [] }),
      );
      expect(fileRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: "file-1" })]),
      );
    });

    it.each([true, false])(
      "does not attribute unrelated Booklet errors to uploaded files (persist: %s)",
      async (persistResults) => {
        const apIndex = {
          assessmentParts: [
            {
              instruments: [
                {
                  testcenterBooklet: [{ id: "booklet-1" }, { id: "booklet-2" }],
                },
              ],
            },
          ],
        };
        apRepo.findOne.mockResolvedValue({ id: "ap-1", apIndex });
        const manifest = buildReviewManifest(apIndex, new Map());
        expect(manifest.issues).toHaveLength(2);
        jest.mocked(manifestService.getManifest).mockResolvedValue(manifest);

        const contents = new Map([
          ["task.voud", Buffer.from('{"pages":[]}')],
          ["image.png", Buffer.from([137, 80, 78, 71])],
          ["bad.json", Buffer.from("not json{")],
          ["empty.txt", Buffer.alloc(0)],
          [
            "booklet.xml",
            Buffer.from(
              "<Booklet><Metadata><Id>b</Id></Metadata><Units><ProgressEnd/></Units></Booklet>",
            ),
          ],
        ]);
        const files = [...contents.keys()].map(
          (originalName) =>
            ({
              id: originalName,
              originalName,
              filePath: originalName,
              validationResult: {
                valid: false,
                issues: manifest.issues,
              },
            }) as unknown as ApFile,
        );
        fileRepo.find.mockResolvedValue(files);
        jest
          .mocked(fs.readFile)
          .mockImplementation(async (path) => contents.get(String(path))!);

        const result = await service.autoValidateUploadedFiles(
          "ap-1",
          files,
          undefined,
          persistResults,
        );

        expect(result.summary).toEqual(
          expect.objectContaining({
            totalFiles: 5,
            validFiles: 3,
            invalidFiles: 2,
            semanticValid: false,
            semanticIssueCount: 2,
            semanticIssues: manifest.issues.map((issue) => ({
              ...issue,
              scope: "semantic",
            })),
          }),
        );
        expect(files[0].validationResult).toEqual(
          expect.objectContaining({ valid: true, issues: [] }),
        );
        expect(files[1].validationResult).toEqual(
          expect.objectContaining({ valid: true, issues: [] }),
        );
        expect(files[2].validationResult).toEqual(
          expect.objectContaining({
            valid: false,
            issues: [expect.objectContaining({ scope: "syntactic" })],
          }),
        );
        expect(files[3].validationResult).toEqual(
          expect.objectContaining({
            valid: true,
            issues: [expect.objectContaining({ severity: "warning" })],
          }),
        );
        expect(files[4].validationResult).toEqual(
          expect.objectContaining({
            valid: false,
            issues: [expect.objectContaining({ scope: "schema" })],
          }),
        );
        if (persistResults) {
          expect(fileRepo.save).toHaveBeenCalledWith(files);
        } else {
          expect(fileRepo.save).not.toHaveBeenCalled();
        }
      },
    );

    it("returns an empty summary when no files are provided", async () => {
      apRepo.findOne.mockResolvedValue({
        id: "ap-1",
        apIndex: { assessmentParts: [] },
      });
      fileRepo.find.mockResolvedValue([]);
      const result = await service.autoValidateUploadedFiles("ap-1", []);

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
      expect(fileRepo.save).not.toHaveBeenCalled();
    });

    it("preserves AP errors after deleting the last file", async () => {
      const apIndex = {
        assessmentParts: [
          { instruments: [{ testcenterBooklet: [{ id: "booklet-1" }] }] },
        ],
      };
      apRepo.findOne.mockResolvedValue({ id: "ap-1", apIndex });
      fileRepo.find.mockResolvedValue([]);
      jest
        .mocked(manifestService.getManifest)
        .mockResolvedValue(buildReviewManifest(apIndex, new Map()));

      const result = await service.autoValidateUploadedFiles("ap-1", []);

      expect(result.summary).toMatchObject({
        totalFiles: 0,
        validFiles: 0,
        invalidFiles: 0,
        semanticValid: false,
        semanticIssueCount: 1,
        semanticIssues: [
          expect.objectContaining({
            severity: "error",
            message: "Booklet besitzt weder XML-Definition noch Module.",
          }),
        ],
      });
      expect(fileRepo.save).not.toHaveBeenCalled();
    });

    it("creates file-level errors when uploaded files are missing on disk", async () => {
      const readFileMock = fs.readFile as jest.Mock;
      readFileMock.mockRejectedValue(new Error("missing"));

      apRepo.findOne.mockResolvedValue({
        id: "ap-1",
        apIndex: { assessmentParts: [] },
      });
      fileRepo.find.mockResolvedValue([]);

      const uploadedFile = {
        id: "file-2",
        apId: "ap-1",
        filePath: "/tmp/missing.json",
        originalName: "missing.json",
      } as ApFile;

      const result = await service.autoValidateUploadedFiles("ap-1", [
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
