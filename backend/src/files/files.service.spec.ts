import { ReviewManifestService } from "../review/review-manifest.service";
import { buildReviewManifest } from "../review/review-manifest";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import * as fs from "fs/promises";
import { FilesService } from "./files.service";
import { UnitParserService } from "./unit-parser.service";
import { ValidationService } from "../validation/validation.service";
import {
  AcpFile,
  Acp,
  AcpAccessConfig,
  ItemResponseState,
} from "../database/entities";
import { DataSource } from "typeorm";
import { ArchiveExpansionService } from "./archive-expansion.service";
import { FileMutationService } from "./file-mutation.service";
import { FileStorageService } from "./file-storage.service";
import { UploadPreflightService } from "./upload-preflight.service";
import { createAcpFileFixture, TEST_UUIDS } from "../testing/test-fixtures";

jest.mock("fs/promises", () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from("file content")),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

describe("FilesService", () => {
  const acpId = TEST_UUIDS.acp;
  const unknownAcpId = TEST_UUIDS.unknownAcp;
  let service: FilesService;
  let manifestService: { getManifest: jest.Mock };
  let repo: any;
  let acpRepo: any;
  let accessConfigRepo: any;
  let stateRepo: any;
  let unitParserService: any;
  let validationService: any;
  let dataSource: any;

  const mockFile = createAcpFileFixture({
    id: "file-1",
    filePath: "/uploads/acp-1/test.json",
    originalName: "test.json",
    fileSize: 1024,
    checksum: "abc123",
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    manifestService = {
      getManifest: jest
        .fn()
        .mockResolvedValue({ booklets: [], issues: [], units: [] }),
    };
    repo = {
      find: jest.fn().mockResolvedValue([mockFile]),
      findOne: jest.fn().mockResolvedValue(mockFile),
      create: jest
        .fn()
        .mockImplementation((dto) => ({ ...dto, id: "new-file" })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    acpRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: acpId,
        acpIndex: {
          units: [
            {
              id: "unit-1",
              dependencies: [{ id: "test.json", type: "UNIT_DEFINITION" }],
            },
            {
              id: "unit-2",
              dependencies: [{ id: "second.json", type: "UNIT_DEFINITION" }],
            },
          ],
          assessmentParts: [
            {
              bookletModules: [
                {
                  id: "seq-1",
                  units: [
                    { id: "unit-1", order: 1 },
                    { id: "unit-2", order: 2 },
                  ],
                },
              ],
            },
          ],
        },
      }),
    };
    accessConfigRepo = {
      findOne: jest.fn().mockResolvedValue({ featureConfig: {} }),
    };
    stateRepo = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    unitParserService = {
      invalidateFileCaches: jest.fn(),
      parseUnitXml: jest.fn().mockImplementation((content: string) => ({
        unitId: content.match(/<Id>([^<]+)<\/Id>/)?.[1] || "",
        unitLabel: content.match(/<Label>([^<]+)<\/Label>/)?.[1] || "",
        description: content.match(/<Description>([^<]+)<\/Description>/)?.[1],
        definitionRef:
          content.match(/<DefinitionRef[^>]*>([^<]+)<\/DefinitionRef>/)?.[1] ||
          "",
        playerRef:
          content.match(/<DefinitionRef[^>]*player="([^"]+)"/)?.[1] || "",
        codingSchemeRef: content.match(
          /<CodingSchemeRef>([^<]+)<\/CodingSchemeRef>/,
        )?.[1],
        metadataRef: content.match(/<Reference>([^<]+)<\/Reference>/)?.[1],
      })),
      parseVomd: jest.fn().mockImplementation((content: string) => {
        const data = JSON.parse(content);
        return {
          unitProfiles: data.profiles || [],
          items: data.items || [],
        };
      }),
      pruneMissingDependencies: jest.fn().mockResolvedValue({
        unitsUpdated: 0,
        dependenciesRemoved: 0,
        bookletsUpdated: 0,
        bookletDefinitionsRemoved: 0,
        indexUpdated: false,
      }),
      getItemListFromFiles: jest.fn().mockResolvedValue({
        columns: [],
        items: [],
        unitMetadata: {},
        codingSchemes: {},
      }),
    };
    validationService = {
      autoValidateUploadedFiles: jest.fn().mockResolvedValue({
        files: [mockFile],
        summary: {
          totalFiles: 1,
          validFiles: 1,
          invalidFiles: 0,
          semanticValid: true,
          semanticIssueCount: 0,
          timestamp: new Date().toISOString(),
        },
      }),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation(async (work) =>
        work({
          getRepository: (entity: unknown) => (entity === Acp ? acpRepo : repo),
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: ReviewManifestService, useValue: manifestService },
        ArchiveExpansionService,
        UploadPreflightService,
        FileMutationService,
        FileStorageService,
        { provide: getRepositoryToken(AcpFile), useValue: repo },
        { provide: getRepositoryToken(Acp), useValue: acpRepo },
        {
          provide: getRepositoryToken(AcpAccessConfig),
          useValue: accessConfigRepo,
        },
        { provide: getRepositoryToken(ItemResponseState), useValue: stateRepo },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue("./uploads") },
        },
        { provide: UnitParserService, useValue: unitParserService },
        { provide: ValidationService, useValue: validationService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
  });

  describe("findByAcp", () => {
    it("should return files for ACP", async () => {
      const result = await service.findByAcp(acpId);
      expect(result).toHaveLength(1);
      expect(result[0].originalName).toBe("test.json");
    });

    it("should reject an unknown ACP before querying files", async () => {
      acpRepo.findOne.mockResolvedValue(null);

      await expect(service.findByAcp(unknownAcpId)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.find).not.toHaveBeenCalled();
    });

    it("should reject a malformed ACP ID before querying repositories", async () => {
      await expect(
        service.findByAcp("__coding-box-connection-test__"),
      ).rejects.toThrow(BadRequestException);
      expect(acpRepo.findOne).not.toHaveBeenCalled();
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe("findById", () => {
    it("should return file by id", async () => {
      const result = await service.findById("file-1");
      expect(result.originalName).toBe("test.json");
    });

    it("should throw NotFoundException", async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findById("bad")).rejects.toThrow(NotFoundException);
    });

    it("should throw when ACP-scoped lookup does not match ACP", async () => {
      repo.findOne.mockResolvedValue({ ...mockFile, acpId: "other-acp" });
      await expect(service.findByIdForAcp(acpId, "file-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("upload", () => {
    it("should upload file and store metadata", async () => {
      const multerFile = {
        originalname: "data.json",
        mimetype: "application/json",
        size: 512,
        buffer: Buffer.from('{"test": true}'),
      } as Express.Multer.File;

      await service.upload(acpId, multerFile);
      expect(repo.create).toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalled();
      expect(unitParserService.invalidateFileCaches).toHaveBeenCalledWith(
        acpId,
      );
    });

    it("should reject an unknown ACP before writing to disk", async () => {
      acpRepo.findOne.mockResolvedValue(null);
      (fs.mkdir as jest.Mock).mockClear();
      (fs.writeFile as jest.Mock).mockClear();
      const incoming = {
        originalname: "test.json",
        mimetype: "application/json",
        size: 2,
        buffer: Buffer.from("{}"),
      } as Express.Multer.File;

      await expect(service.upload(unknownAcpId, incoming)).rejects.toThrow(
        NotFoundException,
      );
      expect(fs.mkdir).not.toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe("uploadMultiple", () => {
    const incoming = {
      originalname: "test.json",
      mimetype: "application/json",
      size: 128,
      buffer: Buffer.from('{"fresh": true}'),
    } as Express.Multer.File;

    it("should reject an unknown ACP before processing uploads", async () => {
      acpRepo.findOne.mockResolvedValue(null);
      (fs.mkdir as jest.Mock).mockClear();
      (fs.writeFile as jest.Mock).mockClear();

      await expect(
        service.uploadMultiple(unknownAcpId, [incoming]),
      ).rejects.toThrow(NotFoundException);
      expect(repo.find).not.toHaveBeenCalled();
      expect(fs.mkdir).not.toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it("should extract ZIP uploads before storing metadata", async () => {
      repo.find.mockResolvedValue([]);

      const JSZip = require("jszip");
      const zip = new JSZip();
      zip.file(
        "nested/unit-1.xml",
        "<Unit><Metadata><Id>unit-1</Id><Label>Unit 1</Label></Metadata></Unit>",
      );
      zip.file("unit-1.vomd", '{"items":[]}');
      zip.file("__MACOSX/ignored.txt", "ignore");
      zip.file(".DS_Store", "ignore");
      const buffer = await zip.generateAsync({ type: "nodebuffer" });

      const result = await service.uploadMultiple(acpId, [
        {
          originalname: "bundle.zip",
          mimetype: "application/zip",
          size: buffer.length,
          buffer,
        } as Express.Multer.File,
      ]);

      expect(repo.create).toHaveBeenCalledTimes(2);
      expect(repo.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          acpId: acpId,
          originalName: "unit-1.xml",
          fileType: "application/xml",
          fileSize: 70,
        }),
      );
      expect(repo.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          acpId: acpId,
          originalName: "unit-1.vomd",
          fileType: "application/json",
          fileSize: 12,
        }),
      );
      expect(acpRepo.findOne).toHaveBeenCalledTimes(2);
      expect(result.map((file) => file.originalName)).toEqual([
        "unit-1.xml",
        "unit-1.vomd",
      ]);
    });

    it("deduplicates identical same-name ZIP entries and reports their paths", async () => {
      repo.find.mockResolvedValue([]);
      const JSZip = require("jszip");
      const zip = new JSZip();
      zip.file("players/a/player.html", "same-player");
      zip.file("players/b/player.html", "same-player");
      const buffer = await zip.generateAsync({ type: "nodebuffer" });
      const upload = {
        originalname: "bundle.zip",
        mimetype: "application/zip",
        size: buffer.length,
        buffer,
      } as Express.Multer.File;

      const preflight = await service.preflightUpload(acpId, [upload]);
      const result = await service.uploadMultiple(acpId, [upload]);

      expect(preflight.canUpload).toBe(true);
      expect(preflight.acceptedFileCount).toBe(1);
      expect(preflight.identicalDuplicates).toEqual([
        {
          fileName: "player.html",
          keptSource: "bundle.zip/players/a/player.html",
          ignoredSources: ["bundle.zip/players/b/player.html"],
        },
      ]);
      expect(result.map((file) => file.originalName)).toEqual(["player.html"]);
      expect(repo.create).toHaveBeenCalledTimes(1);
    });

    it("blocks different same-name ZIP entries and reports both archive paths", async () => {
      repo.find.mockResolvedValue([]);
      const JSZip = require("jszip");
      const zip = new JSZip();
      zip.file(
        "old/MMV047.xml",
        "<Unit><Metadata><Id>MMV047</Id></Metadata></Unit>",
      );
      zip.file(
        "new/MMV047.xml",
        "<Unit><Metadata><Id>MMV047</Id></Metadata><BaseVariables/></Unit>",
      );
      const buffer = await zip.generateAsync({ type: "nodebuffer" });
      const upload = {
        originalname: "bundle.zip",
        mimetype: "application/zip",
        size: buffer.length,
        buffer,
      } as Express.Multer.File;

      const preflight = await service.preflightUpload(acpId, [upload]);

      expect(preflight.canUpload).toBe(false);
      expect(preflight.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "duplicate-content-conflict",
            sourcePaths: [
              "bundle.zip/old/MMV047.xml",
              "bundle.zip/new/MMV047.xml",
            ],
          }),
        ]),
      );
      await expect(service.uploadMultiple(acpId, [upload])).rejects.toThrow(
        ConflictException,
      );
      expect(repo.save).not.toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it("blocks invalid JSON-like unit files during preflight", async () => {
      repo.find.mockResolvedValue([]);
      const upload = {
        originalname: "UNIT-1.vocs",
        mimetype: "application/json",
        size: 7,
        buffer: Buffer.from("{broken"),
      } as Express.Multer.File;

      const preflight = await service.preflightUpload(acpId, [upload]);

      expect(preflight.canUpload).toBe(false);
      expect(preflight.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "invalid-json",
            fileName: "UNIT-1.vocs",
          }),
        ]),
      );
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it("blocks missing booklet unit references and only warns about extra units", async () => {
      repo.find.mockResolvedValue([]);
      const booklet = {
        originalname: "booklet.xml",
        mimetype: "application/xml",
        buffer: Buffer.from(
          '<Booklet><Metadata><Id>B1</Id><Label>Booklet</Label></Metadata><Units><Unit id="MISSING" /></Units></Booklet>',
        ),
      } as Express.Multer.File;
      booklet.size = booklet.buffer.length;
      const unit = {
        originalname: "EXTRA.xml",
        mimetype: "application/xml",
        buffer: Buffer.from(
          "<Unit><Metadata><Id>EXTRA</Id><Label>Extra</Label></Metadata></Unit>",
        ),
      } as Express.Multer.File;
      unit.size = unit.buffer.length;

      const preflight = await service.preflightUpload(acpId, [booklet, unit]);

      expect(preflight.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "missing-unit-reference",
            severity: "error",
          }),
          expect.objectContaining({
            code: "unreferenced-unit",
            severity: "warning",
          }),
        ]),
      );
      expect(preflight.canUpload).toBe(false);
    });

    it("should preserve archive-like uploads when expansion is disabled", async () => {
      const JSZip = require("jszip");
      const zip = new JSZip();
      zip.file("arbitrary.json", '{"unexpected":true}');
      const buffer = await zip.generateAsync({ type: "nodebuffer" });
      const existingVocs = {
        ...mockFile,
        id: "vocs-file",
        originalName: "UNIT-1.VOCS",
      };
      repo.find.mockResolvedValue([existingVocs]);
      (fs.writeFile as jest.Mock).mockClear();

      const result = await service.uploadMultiple(
        acpId,
        [
          {
            originalname: "UNIT-1.VOCS",
            mimetype: "application/zip",
            size: buffer.length,
            buffer,
          } as Express.Multer.File,
        ],
        {
          conflictStrategy: "overwrite",
          expandArchives: false,
        },
      );

      expect(repo.remove).toHaveBeenCalledWith([existingVocs]);
      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          acpId: acpId,
          originalName: "UNIT-1.VOCS",
          fileType: "application/zip",
          fileSize: buffer.length,
        }),
      );
      expect(fs.writeFile).toHaveBeenCalledWith(expect.any(String), buffer);
      expect(result.map((file) => file.originalName)).toEqual(["UNIT-1.VOCS"]);
    });

    it("should reject invalid ZIP uploads", async () => {
      repo.find.mockResolvedValue([]);

      await expect(
        service.uploadMultiple(acpId, [
          {
            originalname: "broken.zip",
            mimetype: "application/zip",
            size: 9,
            buffer: Buffer.from("not-a-zip"),
          } as Express.Multer.File,
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject conflicts by default", async () => {
      (fs.writeFile as jest.Mock).mockClear();
      (fs.unlink as jest.Mock).mockClear();

      await expect(service.uploadMultiple(acpId, [incoming])).rejects.toThrow(
        ConflictException,
      );

      expect(repo.save).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it("should recheck reject conflicts after acquiring the ACP lock", async () => {
      repo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([mockFile]);
      (fs.unlink as jest.Mock).mockClear();

      await expect(service.uploadMultiple(acpId, [incoming])).rejects.toThrow(
        ConflictException,
      );

      expect(repo.find).toHaveBeenCalledTimes(2);
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      expect(repo.save).not.toHaveBeenCalled();
      expect(fs.unlink).toHaveBeenCalledTimes(1);
      expect(fs.unlink).not.toHaveBeenCalledWith(mockFile.filePath);
    });

    it("should overwrite existing files when strategy is overwrite", async () => {
      const result = await service.uploadMultiple(acpId, [incoming], {
        conflictStrategy: "overwrite",
      });

      expect(repo.remove).toHaveBeenCalledWith([mockFile]);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          acpId: acpId,
          originalName: incoming.originalname,
        }),
      );
      expect(acpRepo.findOne).toHaveBeenCalledTimes(2);
      expect(acpRepo.findOne).toHaveBeenNthCalledWith(2, {
        where: { id: acpId },
        lock: { mode: "pessimistic_write" },
      });
      expect(result).toHaveLength(1);
      expect(
        (fs.writeFile as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(dataSource.transaction.mock.invocationCallOrder[0]);
      expect(dataSource.transaction.mock.invocationCallOrder[0]).toBeLessThan(
        acpRepo.findOne.mock.invocationCallOrder[1],
      );
      expect(acpRepo.findOne.mock.invocationCallOrder[1]).toBeLessThan(
        repo.find.mock.invocationCallOrder[1],
      );
      expect(repo.save.mock.invocationCallOrder[0]).toBeLessThan(
        repo.remove.mock.invocationCallOrder[0],
      );
      expect(repo.remove.mock.invocationCallOrder[0]).toBeLessThan(
        (fs.unlink as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it("should keep original files when the metadata transaction fails", async () => {
      dataSource.transaction.mockRejectedValueOnce(
        new Error("transaction failed"),
      );
      (fs.unlink as jest.Mock).mockClear();

      await expect(
        service.uploadMultiple(acpId, [incoming], {
          conflictStrategy: "overwrite",
        }),
      ).rejects.toThrow("transaction failed");

      expect(repo.remove).not.toHaveBeenCalled();
      expect(fs.unlink).toHaveBeenCalledTimes(1);
      expect(fs.unlink).not.toHaveBeenCalledWith(mockFile.filePath);
    });

    it("should keep original files when staging a batch fails", async () => {
      (fs.writeFile as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("disk full"));
      (fs.unlink as jest.Mock).mockClear();

      await expect(
        service.uploadMultiple(
          acpId,
          [
            incoming,
            {
              ...incoming,
              originalname: "second.json",
            } as Express.Multer.File,
          ],
          { conflictStrategy: "overwrite" },
        ),
      ).rejects.toThrow("disk full");

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(repo.remove).not.toHaveBeenCalled();
      expect(fs.unlink).not.toHaveBeenCalledWith(mockFile.filePath);
    });

    it("should keep both files when strategy is keep-both", async () => {
      const result = await service.uploadMultiple(acpId, [incoming], {
        conflictStrategy: "keep-both",
      });

      expect(repo.remove).not.toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          acpId: acpId,
          originalName: incoming.originalname,
        }),
      );
      expect(acpRepo.findOne).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(1);
    });

    it("should reject invalid conflict strategy", async () => {
      await expect(
        service.uploadMultiple(acpId, [incoming], {
          conflictStrategy: "invalid-strategy",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should require at least one file", async () => {
      await expect(service.uploadMultiple(acpId, [])).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should reject files without filename", async () => {
      const invalidFile = {
        ...incoming,
        originalname: "   ",
      } as Express.Multer.File;

      await expect(
        service.uploadMultiple(acpId, [invalidFile]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("download", () => {
    it("should return file buffer", async () => {
      const result = await service.download("file-1");
      expect(result.buffer).toBeDefined();
      expect(result.file.originalName).toBe("test.json");
    });

    it("should fail when file is missing on disk", async () => {
      (fs.readFile as jest.Mock).mockRejectedValueOnce(new Error("missing"));
      await expect(service.download("file-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should download ACP-scoped file and fail on missing disk file", async () => {
      await expect(service.downloadForAcp(acpId, "file-1")).resolves.toEqual(
        expect.objectContaining({
          file: expect.objectContaining({ id: "file-1" }),
        }),
      );

      (fs.readFile as jest.Mock).mockRejectedValueOnce(new Error("missing"));
      await expect(service.downloadForAcp(acpId, "file-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should create ZIP archives for all or selected ACP files", async () => {
      repo.find.mockResolvedValue([
        { ...mockFile, id: "file-1", originalName: "test.json" },
        { ...mockFile, id: "file-2", originalName: "second.json" },
      ]);

      await expect(service.createFilesZip(acpId)).resolves.toEqual(
        expect.objectContaining({
          fileName: "acp-11111111-1111-4111-8111-111111111111-all-files.zip",
        }),
      );

      await expect(
        service.createFilesZip(acpId, ["file-2", "file-1", "file-2"]),
      ).resolves.toEqual(
        expect.objectContaining({
          fileName:
            "acp-11111111-1111-4111-8111-111111111111-selected-files.zip",
        }),
      );
    });

    it("should reject ZIP archives for unknown ACP file IDs", async () => {
      repo.find.mockResolvedValue([{ ...mockFile, id: "file-1" }]);

      await expect(
        service.createFilesZip(acpId, ["missing-file"]),
      ).rejects.toThrow(NotFoundException);
    });

    it("should report ZIP archive progress in processed bytes", async () => {
      repo.find.mockResolvedValue([
        {
          ...mockFile,
          id: "file-1",
          originalName: "test.json",
          fileSize: 1200,
          filePath: "/uploads/acp-1/test.json",
        },
        {
          ...mockFile,
          id: "file-2",
          originalName: "second.json",
          fileSize: 800,
          filePath: "/uploads/acp-1/second.json",
        },
      ]);

      const progress = {
        startPhase: jest.fn().mockResolvedValue(undefined),
        advance: jest.fn().mockResolvedValue(undefined),
        setMessage: jest.fn().mockResolvedValue(undefined),
        completePhase: jest.fn().mockResolvedValue(undefined),
      };

      await expect(
        service.createFilesZipArchive(acpId, ["file-1", "file-2"], progress),
      ).resolves.toEqual(
        expect.objectContaining({
          fileName:
            "acp-11111111-1111-4111-8111-111111111111-selected-files.zip",
        }),
      );

      expect(progress.startPhase).toHaveBeenCalledWith("zip-files", 2000, {
        phaseLabel: "ZIP wird erstellt",
        message: "0 von 2 Datei(en), 0 B von 2.0 KB verarbeitet",
      });
      expect(progress.advance).toHaveBeenNthCalledWith(1, {
        delta: 1200,
        message: "1 von 2 Datei(en), 1.2 KB von 2.0 KB verarbeitet",
      });
      expect(progress.advance).toHaveBeenNthCalledWith(2, {
        delta: 800,
        message: "2 von 2 Datei(en), 2.0 KB von 2.0 KB verarbeitet",
      });
      expect(progress.completePhase).toHaveBeenCalledWith(
        "ZIP-Datei ist erstellt.",
      );
    });
  });

  describe("delete", () => {
    it("should delete file from disk and DB", async () => {
      repo.findOne.mockResolvedValue(mockFile);
      await service.delete("file-1");
      expect(repo.remove).toHaveBeenCalledWith(mockFile);
      expect(unitParserService.invalidateFileCaches).toHaveBeenCalledWith(
        acpId,
      );
    });

    it("should ignore unlink errors during delete operations", async () => {
      (fs.unlink as jest.Mock).mockRejectedValueOnce(new Error("gone"));
      await expect(service.delete("file-1")).resolves.toBeUndefined();
      expect(repo.remove).toHaveBeenCalledWith(mockFile);
    });

    it("should delete by ACP and remove all files", async () => {
      await expect(
        service.deleteForAcp(acpId, "file-1"),
      ).resolves.toBeUndefined();
      expect(repo.remove).toHaveBeenCalledWith(mockFile);

      repo.find.mockResolvedValue([
        { ...mockFile, id: "file-1", filePath: "/x/1" },
        { ...mockFile, id: "file-2", filePath: "/x/2" },
      ]);
      (fs.unlink as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("missing"));

      await expect(service.deleteAll(acpId)).resolves.toBeUndefined();
      expect(repo.remove).toHaveBeenCalledWith([
        expect.objectContaining({ id: "file-1" }),
        expect.objectContaining({ id: "file-2" }),
      ]);
    });

    it("should remove physical files sequentially", async () => {
      repo.find.mockResolvedValue([
        { ...mockFile, id: "file-1", filePath: "/x/1" },
        { ...mockFile, id: "file-2", filePath: "/x/2" },
      ]);
      let signalFirstUnlink!: () => void;
      let releaseFirstUnlink!: () => void;
      const firstUnlinkStarted = new Promise<void>((resolve) => {
        signalFirstUnlink = resolve;
      });
      (fs.unlink as jest.Mock)
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              releaseFirstUnlink = resolve;
              signalFirstUnlink();
            }),
        )
        .mockResolvedValueOnce(undefined);

      const deletion = service.deleteAll(acpId);
      await firstUnlinkStarted;

      expect(fs.unlink).toHaveBeenCalledTimes(1);
      releaseFirstUnlink();
      await deletion;
      expect(fs.unlink).toHaveBeenCalledTimes(2);
    });

    it("should bulk delete ACP files for the provided IDs", async () => {
      repo.find.mockResolvedValue([
        { ...mockFile, id: "file-1", filePath: "/x/1" },
        { ...mockFile, id: "file-2", filePath: "/x/2" },
      ]);

      const result = await service.deleteManyForAcp(acpId, [
        "file-1",
        "file-2",
        "file-1",
      ]);

      expect(result).toEqual(["file-1", "file-2"]);
      expect(repo.remove).toHaveBeenCalledWith([
        expect.objectContaining({ id: "file-1" }),
        expect.objectContaining({ id: "file-2" }),
      ]);
    });

    it("should reject empty and unknown IDs during bulk delete", async () => {
      await expect(service.deleteManyForAcp(acpId, [])).rejects.toThrow(
        BadRequestException,
      );

      repo.find.mockResolvedValue([{ ...mockFile, id: "file-1" }]);

      await expect(
        service.deleteManyForAcp(acpId, ["missing-file"]),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("cleanupOrphanedResponseStates", () => {
    it("deletes response states that no longer match any file-backed item", async () => {
      stateRepo.find.mockResolvedValueOnce([
        {
          id: "state-1",
          unitId: "unit-1",
          itemId: "item-a",
          rowKey: "unit-1::item-a",
        },
        {
          id: "state-2",
          unitId: "unit-1",
          itemId: "item-b",
          rowKey: "unit-1::item-b",
        },
      ]);
      unitParserService.getItemListFromFiles.mockResolvedValueOnce({
        columns: [],
        items: [
          {
            itemId: "item-a",
            unitId: "unit-1",
            rowKey: "uuid-a",
          },
        ],
        unitMetadata: {},
        codingSchemes: {},
      });

      const result = await service.cleanupOrphanedResponseStates(acpId);

      expect(stateRepo.delete).toHaveBeenCalledWith(["state-2"]);
      expect(result).toEqual({
        totalStates: 2,
        deletedStates: 1,
        keptStates: 1,
      });
    });

    it("returns zero cleanup when no response states exist", async () => {
      stateRepo.find.mockResolvedValueOnce([]);

      const result = await service.cleanupOrphanedResponseStates(acpId);

      expect(unitParserService.getItemListFromFiles).not.toHaveBeenCalled();
      expect(stateRepo.delete).not.toHaveBeenCalled();
      expect(result).toEqual({
        totalStates: 0,
        deletedStates: 0,
        keptStates: 0,
      });
    });

    it("keeps draft partial-credit states while their underlying item still exists", async () => {
      stateRepo.find.mockResolvedValueOnce([
        {
          id: "state-valid-partial",
          unitId: "unit-1",
          itemId: "item-a",
          rowKey: "uuid-a::1",
        },
        {
          id: "state-orphaned-partial",
          unitId: "unit-1",
          itemId: "item-missing",
          rowKey: "uuid-missing::1",
        },
      ]);
      unitParserService.getItemListFromFiles.mockResolvedValueOnce({
        columns: [],
        items: [
          {
            itemId: "item-a",
            unitId: "unit-1",
            uuid: "uuid-a",
            rowKey: "uuid-a",
          },
        ],
        unitMetadata: {},
        codingSchemes: {},
      });

      const result = await service.cleanupOrphanedResponseStates(acpId);

      expect(stateRepo.delete).toHaveBeenCalledWith(["state-orphaned-partial"]);
      expect(result).toEqual({
        totalStates: 2,
        deletedStates: 1,
        keptStates: 1,
      });
    });
  });

  describe("cleanupReferencesAfterFileMutation", () => {
    it("runs dependency, response state, and validation cleanup", async () => {
      const result = await service.cleanupReferencesAfterFileMutation(acpId);

      expect(unitParserService.pruneMissingDependencies).toHaveBeenCalledWith(
        acpId,
      );
      expect(validationService.autoValidateUploadedFiles).toHaveBeenCalledWith(
        acpId,
        expect.any(Array),
      );
      expect(result).toEqual(
        expect.objectContaining({
          cleanupReport: expect.objectContaining({
            unitsUpdated: 0,
            dependenciesRemoved: 0,
            bookletsUpdated: 0,
            bookletDefinitionsRemoved: 0,
            indexUpdated: false,
          }),
          responseStateCleanup: expect.objectContaining({
            totalStates: 0,
            deletedStates: 0,
            keptStates: 0,
          }),
          validationSummary: expect.objectContaining({
            totalFiles: 1,
          }),
        }),
      );
    });

    it("can skip validation step for bulk mutation flows", async () => {
      const result = await service.cleanupReferencesAfterFileMutation(acpId, {
        skipValidation: true,
      });

      expect(unitParserService.pruneMissingDependencies).toHaveBeenCalledWith(
        acpId,
      );
      expect(
        validationService.autoValidateUploadedFiles,
      ).not.toHaveBeenCalled();
      expect(result.validationSummary).toBeUndefined();
    });
  });

  describe("updateValidationResult", () => {
    it("should update validation result", async () => {
      const result = {
        valid: true,
        issues: [],
        timestamp: new Date().toISOString(),
      };
      repo.findOne.mockResolvedValue({ ...mockFile });
      await service.updateValidationResult("file-1", result);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ validationResult: result }),
      );
    });

    it("returns validation results via generic and ACP-scoped APIs", async () => {
      repo.findOne.mockResolvedValue({
        ...mockFile,
        validationResult: { valid: true },
      });

      await expect(service.getValidationResult("file-1")).resolves.toEqual({
        valid: true,
      });
      await expect(
        service.getValidationResultForAcp(acpId, "file-1"),
      ).resolves.toEqual({ valid: true });
    });
  });

  describe("getPreviewForAcp", () => {
    it("builds a structured preview for unit XML files", async () => {
      repo.findOne.mockResolvedValueOnce({
        ...mockFile,
        originalName: "unit-1.xml",
        filePath: "/uploads/acp-1/unit-1.xml",
        fileType: "application/xml",
      });
      (fs.readFile as jest.Mock).mockResolvedValueOnce(`<?xml version="1.0"?>
<Unit>
  <Id>unit-1</Id>
  <Label>Unit 1</Label>
  <DefinitionRef player="iqb-player-aspect@2.11">unit-1.voud</DefinitionRef>
  <CodingSchemeRef>unit-1.vocs</CodingSchemeRef>
  <Reference>unit-1.vomd</Reference>
</Unit>`);

      const preview = await service.getPreviewForAcp(acpId, "file-1");

      expect(preview).toEqual(
        expect.objectContaining({
          mode: "structured",
          textFormat: "xml",
          structuredData: expect.objectContaining({
            type: "unit-xml",
            unitId: "unit-1",
          }),
        }),
      );
      expect(preview.textContent).toContain("<Unit>");
    });

    it("builds a structured preview for VOMD files", async () => {
      repo.findOne.mockResolvedValueOnce({
        ...mockFile,
        originalName: "unit-1.vomd",
        filePath: "/uploads/acp-1/unit-1.vomd",
        fileType: "application/json",
      });
      (fs.readFile as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({
          profiles: [
            {
              entries: [
                {
                  id: "difficulty",
                  label: [{ lang: "de", value: "Schwierigkeit" }],
                  valueAsText: [{ lang: "de", value: "mittel" }],
                },
              ],
            },
          ],
          items: [
            {
              id: "item-1",
              description: "Aufgabe 1",
              variableId: "VAR_1",
              sourceVariable: "PLAYER_VAR_1",
              variableReadOnlyId: "internal-var-1",
              profiles: [
                {
                  entries: [
                    {
                      id: "format",
                      label: [{ lang: "de", value: "Format" }],
                      valueAsText: [{ lang: "de", value: "MC" }],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );

      const preview = await service.getPreviewForAcp(acpId, "file-1");

      expect(preview).toEqual(
        expect.objectContaining({
          mode: "structured",
          textFormat: "json",
          structuredData: expect.objectContaining({
            type: "vomd",
            itemCount: 1,
            items: [
              expect.objectContaining({
                id: "item-1",
                variableId: "VAR_1",
                sourceVariable: "PLAYER_VAR_1",
                variableReadOnlyId: "internal-var-1",
              }),
            ],
            unitProfiles: [
              expect.objectContaining({
                id: "difficulty",
                value: "mittel",
              }),
            ],
          }),
        }),
      );
    });

    it("returns all VOCS variables and codes without preview truncation", async () => {
      const variables = Array.from({ length: 25 }, (_, variableIndex) => ({
        id: `VAR_${variableIndex + 1}`,
        label: [{ lang: "de", value: `Variable ${variableIndex + 1}` }],
        codes: Array.from({ length: 15 }, (_, codeIndex) => ({
          id: codeIndex,
          score: codeIndex,
          label: [{ lang: "de", value: `Code ${codeIndex}` }],
        })),
      }));

      repo.findOne.mockResolvedValueOnce({
        ...mockFile,
        originalName: "unit-1.vocs",
        filePath: "/uploads/acp-1/unit-1.vocs",
        fileType: "application/json",
      });
      (fs.readFile as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({ variableCodings: variables }),
      );

      const preview = await service.getPreviewForAcp(acpId, "file-1");

      expect(preview).toEqual(
        expect.objectContaining({
          mode: "structured",
          structuredData: expect.objectContaining({
            type: "vocs",
            variableCount: 25,
            codeCount: 375,
          }),
        }),
      );

      const structured = preview.structuredData as any;
      expect(structured.variables).toHaveLength(25);
      expect(structured.variables[0].codes).toHaveLength(15);
      expect(structured.variables[24].id).toBe("VAR_25");
    });

    it("returns image previews without loading file contents", async () => {
      repo.findOne.mockResolvedValueOnce({
        ...mockFile,
        originalName: "diagram.png",
        filePath: "/uploads/acp-1/diagram.png",
        fileType: "image/png",
      });
      (fs.readFile as jest.Mock).mockClear();

      const preview = await service.getPreviewForAcp(acpId, "file-1");

      expect(preview).toEqual(
        expect.objectContaining({
          mode: "image",
          truncated: false,
        }),
      );
      expect(fs.readFile).not.toHaveBeenCalled();
    });
  });

  describe("createUnitZip", () => {
    it("should create a ZIP for a single unit", async () => {
      repo.find.mockResolvedValue([
        { ...mockFile, id: "f1", originalName: "test.json" },
        { ...mockFile, id: "f2", originalName: "unit-1.xml" },
      ]);
      const result = await service.createUnitZip(acpId, "unit-1");
      expect(result.fileName).toBe(
        "acp-11111111-1111-4111-8111-111111111111-unit-unit-1.zip",
      );
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it("should throw when unit has no files", async () => {
      repo.find.mockResolvedValue([]);
      await expect(service.createUnitZip(acpId, "unit-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("createSequenceZip", () => {
    it("exports the XML booklet rather than a same-ID legacy module, deduplicating units", async () => {
      const index = (await acpRepo.findOne()).acpIndex;
      index.assessmentParts[0].instruments = [
        { testcenterBooklet: [{ id: "seq-1", definitionId: "b.xml" }] },
      ];
      const xml =
        '<Booklet><Metadata><Id>seq-1</Id></Metadata><Units><Unit id="unit-2"/><Unit id="unit-2" alias="again"/></Units></Booklet>';
      manifestService.getManifest.mockResolvedValue(
        buildReviewManifest(index, new Map([["b.xml", xml]])),
      );
      repo.find.mockResolvedValue([
        { ...mockFile, id: "f1", originalName: "test.json" },
        { ...mockFile, id: "f2", originalName: "second.json" },
      ]);
      const archive = jest
        .spyOn(service as any, "createZipBuffer")
        .mockResolvedValue(Buffer.from("zip"));
      await service.createSequenceZip(acpId, "seq-1", "booklet");
      expect(archive.mock.calls[0][0]).toEqual([
        expect.objectContaining({ originalName: "second.json" }),
      ]);
      archive.mockClear();
      await service.createSequenceZip(acpId, "seq-1");
      expect(
        (archive.mock.calls[0][0] as any[]).map((file) => file.originalName),
      ).toEqual(["test.json", "second.json"]);
      archive.mockRestore();
    });

    it("does not fall back to a module for an unknown explicit booklet", async () => {
      await expect(
        service.createSequenceZip(acpId, "seq-1", "booklet"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should create a ZIP for all units in a sequence", async () => {
      repo.find.mockResolvedValue([
        { ...mockFile, id: "f1", originalName: "test.json" },
        { ...mockFile, id: "f2", originalName: "unit-1.xml" },
        { ...mockFile, id: "f3", originalName: "second.json" },
        { ...mockFile, id: "f4", originalName: "unit-2.xml" },
      ]);
      const result = await service.createSequenceZip(acpId, "seq-1");
      expect(result.fileName).toBe(
        "acp-11111111-1111-4111-8111-111111111111-sequence-seq-1.zip",
      );
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it("should throw when sequence does not exist", async () => {
      await expect(
        service.createSequenceZip(acpId, "unknown-seq"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw when sequence exists but no files are available", async () => {
      repo.find.mockResolvedValue([]);
      await expect(service.createSequenceZip(acpId, "seq-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("feature config and dependency checks", () => {
    it("returns normalized feature config", async () => {
      accessConfigRepo.findOne.mockResolvedValue({
        featureConfig: {
          itemListMetadataColumns: ["metaA"],
        },
      });

      await expect(service.getFeatureConfig(acpId)).resolves.toEqual(
        expect.objectContaining({
          metadataColumns: {
            visible: ["metaA"],
            order: ["metaA"],
          },
        }),
      );
    });

    it("detects dependency files from ACP index", async () => {
      await expect(
        service.isUnitDependencyFile(acpId, "unit-1.xml"),
      ).resolves.toBe(true);
      await expect(
        service.isUnitDependencyFile(acpId, "test.json"),
      ).resolves.toBe(true);
      await expect(
        service.isUnitDependencyFile(acpId, "missing.json"),
      ).resolves.toBe(false);
    });
  });
});
