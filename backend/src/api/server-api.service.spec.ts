import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ServerApiService } from "./server-api.service";
import { Acp, AcpFile } from "../database/entities";
import { FilesService } from "../files/files.service";
import { SnapshotsService } from "../snapshots/snapshots.service";
import { TEST_UUIDS } from "../testing/test-fixtures";

describe("ServerApiService", () => {
  let service: ServerApiService;
  let acpRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let fileRepository: { find: jest.Mock; findOne: jest.Mock };
  let filesService: {
    deleteForAcp: jest.Mock;
    upload: jest.Mock;
    uploadMultiple: jest.Mock;
    downloadForAcp: jest.Mock;
    cleanupReferencesAfterFileMutation: jest.Mock;
  };
  let snapshotsService: { create: jest.Mock };

  beforeEach(async () => {
    acpRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation(async (value) => ({ ...value })),
    };

    fileRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
    };

    filesService = {
      deleteForAcp: jest.fn(),
      upload: jest.fn(),
      uploadMultiple: jest.fn(),
      downloadForAcp: jest.fn(),
      cleanupReferencesAfterFileMutation: jest.fn().mockResolvedValue({
        cleanupReport: {
          unitsUpdated: 0,
          dependenciesRemoved: 0,
          bookletsUpdated: 0,
          bookletDefinitionsRemoved: 0,
          indexUpdated: false,
        },
        responseStateCleanup: {
          totalStates: 0,
          deletedStates: 0,
          keptStates: 0,
        },
      }),
    };

    snapshotsService = {
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServerApiService,
        { provide: getRepositoryToken(Acp), useValue: acpRepository },
        { provide: getRepositoryToken(AcpFile), useValue: fileRepository },
        { provide: FilesService, useValue: filesService },
        { provide: SnapshotsService, useValue: snapshotsService },
      ],
    }).compile();

    service = module.get<ServerApiService>(ServerApiService);
  });

  it("rejects import when package exists and conflictStrategy=reject", async () => {
    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {},
    });

    await expect(
      service.receiveAcp(
        {
          packageId: "pkg-1",
          name: "Demo",
          acpIndex: { packageId: "pkg-1", version: "0.5.0" },
        },
        "reject",
      ),
    ).rejects.toThrow(ConflictException);
  });

  it("merges existing ACP index when conflictStrategy=merge", async () => {
    const existing = {
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      name: "Old",
      description: "Old Desc",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {
        header: { a: 1 },
        nested: { x: 1 },
      },
    } as any;

    acpRepository.findOne.mockResolvedValue(existing);
    acpRepository.save.mockImplementation(async (value) => ({
      ...value,
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }));

    const result = await service.receiveAcp(
      {
        packageId: "pkg-1",
        name: "New Name",
        description: "New Desc",
        acpIndex: {
          packageId: "pkg-1",
          nested: { y: 2 },
          extra: true,
        },
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      },
      "merge",
    );

    expect(result.operation).toBe("updated");
    expect(result.conflictStrategy).toBe("merge");
    expect(acpRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "New Name",
        description: "New Desc",
        acpIndex: {
          packageId: "pkg-1",
          name: [{ lang: "de", value: "New Name" }],
          header: { a: 1 },
          nested: { x: 1, y: 2 },
          extra: true,
        },
      }),
    );
  });

  it("throws conflict on index update when expectedUpdatedAt mismatches", async () => {
    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {},
    });

    await expect(
      service.updateAcpIndex(
        TEST_UUIDS.acp,
        { version: "0.5.0" },
        "overwrite",
        "2026-01-02T00:00:00.000Z",
      ),
    ).rejects.toThrow(ConflictException);
  });

  it("rejects file upload when duplicate filename exists and conflictStrategy=reject", async () => {
    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {},
    });

    fileRepository.find.mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        acpId: TEST_UUIDS.acp,
        originalName: "unit.xml",
      },
    ]);
    filesService.uploadMultiple.mockRejectedValueOnce(
      new ConflictException("conflict"),
    );

    await expect(
      service.uploadFiles(
        TEST_UUIDS.acp,
        [
          {
            originalname: "unit.xml",
            buffer: Buffer.from("x"),
            size: 1,
            mimetype: "text/xml",
          } as Express.Multer.File,
        ],
        "reject",
      ),
    ).rejects.toThrow(ConflictException);
  });

  it("replaces multiple coding schemes in one batch and creates a snapshot with changelog", async () => {
    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {},
    });

    fileRepository.find.mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        acpId: TEST_UUIDS.acp,
        originalName: "UNIT-1.VOCS",
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        acpId: TEST_UUIDS.acp,
        originalName: "UNIT-2.VOCS",
      },
    ]);

    filesService.uploadMultiple.mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        acpId: TEST_UUIDS.acp,
        originalName: "UNIT-1.VOCS",
        fileType: "application/json",
        fileSize: 10,
        checksum: "abc",
        uploadedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        acpId: TEST_UUIDS.acp,
        originalName: "UNIT-2.VOCS",
        fileType: "application/json",
        fileSize: 12,
        checksum: "def",
        uploadedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);

    snapshotsService.create.mockResolvedValue({
      id: "88888888-8888-4888-8888-888888888888",
      versionNumber: 7,
      changelog: "Kodierschema aktualisiert",
      createdAt: new Date("2026-01-02T01:00:00.000Z"),
    });

    const result = await service.replaceCodingSchemeFiles(
      TEST_UUIDS.acp,
      [
        {
          originalname: "unit-1.vocs",
          buffer: Buffer.from("{}"),
          size: 2,
          mimetype: "application/json",
        } as Express.Multer.File,
        {
          originalname: "unit-2.vocs",
          buffer: Buffer.from('{"two":true}'),
          size: 12,
          mimetype: "application/json",
        } as Express.Multer.File,
      ],
      {
        changelog: "Kodierschema aktualisiert",
        sourceClientId: "coding-box",
      },
    );

    expect(filesService.deleteForAcp).not.toHaveBeenCalled();
    expect(filesService.uploadMultiple).toHaveBeenCalledTimes(1);
    expect(filesService.uploadMultiple).toHaveBeenCalledWith(
      TEST_UUIDS.acp,
      [
        expect.objectContaining({ originalname: "UNIT-1.VOCS" }),
        expect.objectContaining({ originalname: "UNIT-2.VOCS" }),
      ],
      {
        conflictStrategy: "overwrite",
        expandArchives: false,
      },
    );
    expect(filesService.upload).not.toHaveBeenCalled();
    expect(
      filesService.cleanupReferencesAfterFileMutation,
    ).toHaveBeenCalledWith(TEST_UUIDS.acp, {
      skipValidation: true,
    });
    expect(snapshotsService.create).toHaveBeenCalledWith(
      TEST_UUIDS.acp,
      "Kodierschema aktualisiert",
    );
    expect(result.snapshot.versionNumber).toBe(7);
    expect(result.replacedFiles).toHaveLength(2);
  });

  it("does not delete coding schemes before a failed replacement batch", async () => {
    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {},
    });
    fileRepository.find.mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        acpId: TEST_UUIDS.acp,
        originalName: "UNIT-1.VOCS",
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        acpId: TEST_UUIDS.acp,
        originalName: "UNIT-2.VOCS",
      },
    ]);
    filesService.uploadMultiple.mockRejectedValue(new Error("upload failed"));

    await expect(
      service.replaceCodingSchemeFiles(TEST_UUIDS.acp, [
        { originalname: "unit-1.vocs" } as Express.Multer.File,
        { originalname: "unit-2.vocs" } as Express.Multer.File,
      ]),
    ).rejects.toThrow("upload failed");

    expect(filesService.deleteForAcp).not.toHaveBeenCalled();
    expect(
      filesService.cleanupReferencesAfterFileMutation,
    ).not.toHaveBeenCalled();
    expect(snapshotsService.create).not.toHaveBeenCalled();
  });

  it("fails replacement if coding scheme does not exist in ACP", async () => {
    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {},
    });
    fileRepository.find.mockResolvedValue([]);

    await expect(
      service.replaceCodingSchemeFiles(TEST_UUIDS.acp, [
        {
          originalname: "unit-1.vocs",
          buffer: Buffer.from("{}"),
          size: 2,
          mimetype: "application/json",
        } as Express.Multer.File,
      ]),
    ).rejects.toThrow(NotFoundException);
  });

  it("fails replacement when a non-vocs file is provided", async () => {
    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {},
    });
    fileRepository.find.mockResolvedValue([]);

    await expect(
      service.replaceCodingSchemeFiles(TEST_UUIDS.acp, [
        {
          originalname: "unit-1.xml",
          buffer: Buffer.from("<xml/>"),
          size: 6,
          mimetype: "text/xml",
        } as Express.Multer.File,
      ]),
    ).rejects.toThrow(BadRequestException);
  });

  it("lists ACPs with version fallback and ISO timestamps", async () => {
    acpRepository.find.mockResolvedValue([
      {
        id: "22222222-2222-4222-8222-222222222222",
        packageId: "pkg-2",
        name: "Second",
        acpIndex: {},
        updatedAt: new Date("2026-01-03T00:00:00.000Z"),
      },
      {
        id: TEST_UUIDS.acp,
        packageId: "pkg-1",
        name: "First",
        acpIndex: { version: "1.2.3" },
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);

    await expect(service.listAcps()).resolves.toEqual([
      {
        id: "22222222-2222-4222-8222-222222222222",
        packageId: "pkg-2",
        name: "Second",
        version: "0.0.0",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
      {
        id: TEST_UUIDS.acp,
        packageId: "pkg-1",
        name: "First",
        version: "1.2.3",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
  });

  it("filters and enforces ACP restrictions for limited application tokens", async () => {
    acpRepository.find.mockResolvedValue([
      {
        id: TEST_UUIDS.acp,
        packageId: "pkg-1",
        name: "First",
        acpIndex: {},
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);

    await expect(service.listAcps([TEST_UUIDS.acp])).resolves.toEqual([
      {
        id: TEST_UUIDS.acp,
        packageId: "pkg-1",
        name: "First",
        version: "0.0.0",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    expect(acpRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: expect.any(Object) }),
      }),
    );

    await expect(
      service.getAcpIndex("22222222-2222-4222-8222-222222222222", [
        TEST_UUIDS.acp,
      ]),
    ).rejects.toThrow(ForbiddenException);
  });

  it("returns transfer payload and index payload for existing ACPs", async () => {
    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      name: "Demo",
      description: "desc",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: { version: "0.5.0" },
    });
    fileRepository.find.mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        acpId: TEST_UUIDS.acp,
        originalName: "unit.xml",
        fileType: "text/xml",
        fileSize: 21,
        checksum: "abc",
        uploadedAt: new Date("2026-01-01T01:00:00.000Z"),
      },
    ]);

    const transfer = await service.getAcpTransferData(TEST_UUIDS.acp);
    expect(transfer).toEqual({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      name: "Demo",
      description: "desc",
      updatedAt: "2026-01-01T00:00:00.000Z",
      acpIndex: { version: "0.5.0" },
      files: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          originalName: "unit.xml",
          relativePath: "unit.xml",
          fileType: "text/xml",
          fileSize: 21,
          checksum: "abc",
          uploadedAt: "2026-01-01T01:00:00.000Z",
          downloadUrl:
            "/api/server/acp/11111111-1111-4111-8111-111111111111/files/33333333-3333-4333-8333-333333333333/download",
        },
      ],
    });

    const index = await service.getAcpIndex(TEST_UUIDS.acp);
    expect(index).toEqual({
      acpId: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      acpIndex: { version: "0.5.0" },
    });
  });

  it("returns empty index object if ACP index is missing", async () => {
    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: undefined,
    });

    await expect(service.getAcpIndex(TEST_UUIDS.acp)).resolves.toEqual({
      acpId: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      acpIndex: {},
    });
  });

  it("rejects invalid index update payload and invalid strategy values", async () => {
    await expect(
      service.updateAcpIndex(TEST_UUIDS.acp, [] as any, "overwrite"),
    ).rejects.toThrow(BadRequestException);

    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {},
    });

    await expect(
      service.updateAcpIndex(
        TEST_UUIDS.acp,
        { version: "0.5.0" },
        "invalid-strategy",
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.updateAcpIndex(
        TEST_UUIDS.acp,
        { version: "0.5.0" },
        "overwrite",
        "not-a-date",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("lists and reads transfer files and throws when file is missing", async () => {
    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {},
    });
    fileRepository.find.mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        acpId: TEST_UUIDS.acp,
        originalName: "unit.xml",
        fileType: "text/xml",
        fileSize: 12,
        checksum: "x",
        uploadedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    fileRepository.findOne
      .mockResolvedValueOnce({
        id: "33333333-3333-4333-8333-333333333333",
        acpId: TEST_UUIDS.acp,
        originalName: "unit.xml",
        fileType: "text/xml",
        fileSize: 12,
        checksum: "x",
        uploadedAt: new Date("2026-01-01T00:00:00.000Z"),
      })
      .mockResolvedValueOnce(null);

    await expect(service.listFiles(TEST_UUIDS.acp)).resolves.toHaveLength(1);
    await expect(
      service.getFile(TEST_UUIDS.acp, "33333333-3333-4333-8333-333333333333"),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "33333333-3333-4333-8333-333333333333",
        downloadUrl:
          "/api/server/acp/11111111-1111-4111-8111-111111111111/files/33333333-3333-4333-8333-333333333333/download",
      }),
    );
    await expect(
      service.getFile(TEST_UUIDS.acp, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws when file operations are requested for a missing ACP", async () => {
    acpRepository.findOne.mockResolvedValue(null);

    await expect(service.listFiles(TEST_UUIDS.unknownAcp)).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.downloadFile(
        TEST_UUIDS.unknownAcp,
        "33333333-3333-4333-8333-333333333333",
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it("returns bad request for invalid ACP ids before querying Postgres", async () => {
    await expect(
      service.listFiles("__coding-box-connection-test__"),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.listFiles("__coding-box-connection-test__", [TEST_UUIDS.acp]),
    ).rejects.toThrow(BadRequestException);

    expect(acpRepository.findOne).not.toHaveBeenCalled();
    expect(fileRepository.find).not.toHaveBeenCalled();
  });

  it("returns bad request for invalid file ids before querying Postgres", async () => {
    await expect(
      service.getFile(TEST_UUIDS.acp, "not-a-file-uuid"),
    ).rejects.toThrow(BadRequestException);

    expect(fileRepository.findOne).not.toHaveBeenCalled();
  });

  it("downloads files through FilesService when ACP exists", async () => {
    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {},
    });
    filesService.downloadForAcp.mockResolvedValue({
      buffer: Buffer.from("x"),
      file: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });

    await expect(
      service.downloadFile(
        TEST_UUIDS.acp,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ),
    ).resolves.toEqual({
      buffer: Buffer.from("x"),
      file: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });
    expect(filesService.downloadForAcp).toHaveBeenCalledWith(
      TEST_UUIDS.acp,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });

  it("rejects upload requests without files or with invalid conflictStrategy", async () => {
    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {},
    });

    await expect(service.uploadFiles(TEST_UUIDS.acp, [])).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.uploadFiles(
        TEST_UUIDS.acp,
        [{ originalname: "f.xml" } as any],
        "invalid",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("supports keep-both and overwrite upload conflict strategies", async () => {
    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {},
    });
    fileRepository.find.mockResolvedValue([
      {
        id: "55555555-5555-4555-8555-555555555555",
        acpId: TEST_UUIDS.acp,
        originalName: "unit.xml",
      },
    ]);
    filesService.uploadMultiple
      .mockResolvedValueOnce([
        {
          id: "66666666-6666-4666-8666-666666666666",
          acpId: TEST_UUIDS.acp,
          originalName: "unit.xml",
          fileType: "text/xml",
          fileSize: 10,
          checksum: "a",
          uploadedAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      ] as AcpFile[])
      .mockResolvedValueOnce([
        {
          id: "77777777-7777-4777-8777-777777777777",
          acpId: TEST_UUIDS.acp,
          originalName: "unit.xml",
          fileType: "text/xml",
          fileSize: 11,
          checksum: "b",
          uploadedAt: new Date("2026-01-03T00:00:00.000Z"),
        },
      ] as AcpFile[]);

    const keepBoth = await service.uploadFiles(
      TEST_UUIDS.acp,
      [{ originalname: "bundle.zip" } as any],
      "keep-both",
    );
    expect(keepBoth[0]).toEqual(
      expect.objectContaining({
        id: "66666666-6666-4666-8666-666666666666",
        fileSize: 10,
      }),
    );
    expect(filesService.uploadMultiple).toHaveBeenNthCalledWith(
      1,
      TEST_UUIDS.acp,
      [{ originalname: "bundle.zip" }],
      { conflictStrategy: "keep-both" },
    );
    expect(
      filesService.cleanupReferencesAfterFileMutation,
    ).not.toHaveBeenCalled();

    const overwrite = await service.uploadFiles(
      TEST_UUIDS.acp,
      [{ originalname: "bundle.zip" } as any],
      "overwrite",
    );
    expect(overwrite[0]).toEqual(
      expect.objectContaining({ id: "77777777-7777-4777-8777-777777777777" }),
    );
    expect(filesService.uploadMultiple).toHaveBeenNthCalledWith(
      2,
      TEST_UUIDS.acp,
      [{ originalname: "bundle.zip" }],
      { conflictStrategy: "overwrite" },
    );
    expect(
      filesService.cleanupReferencesAfterFileMutation,
    ).toHaveBeenCalledWith(TEST_UUIDS.acp, {
      skipValidation: true,
    });
  });

  it("validates replacement file list details before processing", async () => {
    await expect(
      service.replaceCodingSchemeFiles(TEST_UUIDS.acp, []),
    ).rejects.toThrow(BadRequestException);

    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {},
    });
    fileRepository.find.mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        acpId: TEST_UUIDS.acp,
        originalName: "UNIT-1.VOCS",
      },
    ]);

    await expect(
      service.replaceCodingSchemeFiles(TEST_UUIDS.acp, [
        { originalname: "   " } as any,
      ]),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.replaceCodingSchemeFiles(TEST_UUIDS.acp, [
        { originalname: "unit-1.vocs" } as any,
        { originalname: "UNIT-1.VOCS" } as any,
      ]),
    ).rejects.toThrow(BadRequestException);
  });

  it("generates default coding scheme changelog with source client suffix", async () => {
    acpRepository.findOne.mockResolvedValue({
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {},
    });
    fileRepository.find.mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        acpId: TEST_UUIDS.acp,
        originalName: "UNIT-1.VOCS",
      },
    ]);
    filesService.uploadMultiple.mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        acpId: TEST_UUIDS.acp,
        originalName: "UNIT-1.VOCS",
        fileType: "application/json",
        fileSize: 10,
        checksum: "abc",
        uploadedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);
    snapshotsService.create.mockResolvedValue({
      id: "88888888-8888-4888-8888-888888888888",
      versionNumber: 7,
      changelog: "generated",
      createdAt: new Date("2026-01-02T01:00:00.000Z"),
    });

    await service.replaceCodingSchemeFiles(
      TEST_UUIDS.acp,
      [{ originalname: "unit-1.vocs" } as any],
      { sourceClientId: "sync-agent" },
    );

    expect(snapshotsService.create).toHaveBeenCalledWith(
      TEST_UUIDS.acp,
      "Kodierschema ersetzt via sync-agent: UNIT-1.VOCS",
    );
    expect(
      filesService.cleanupReferencesAfterFileMutation,
    ).toHaveBeenCalledWith(TEST_UUIDS.acp, {
      skipValidation: true,
    });
  });

  it("validates receiveAcp payload shape and conflictStrategy", async () => {
    await expect(
      service.receiveAcp({ packageId: "", name: "x", acpIndex: {} } as any),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.receiveAcp({
        packageId: "pkg-1",
        name: " ",
        acpIndex: {},
      } as any),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.receiveAcp({
        packageId: "pkg-1",
        name: "x",
        acpIndex: [] as any,
      } as any),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.receiveAcp(
        { packageId: "pkg-1", name: "x", acpIndex: {} },
        "invalid",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("stores the schema ID returned by 0.6 validation on server imports", async () => {
    acpRepository.findOne.mockResolvedValue(null);
    const report = {
      schemaId: "acp-index@0.6",
      valid: true,
      publishable: true,
      issues: [],
    };
    const validator = {
      validateCandidate: jest.fn().mockResolvedValue(report),
    };
    const validated = new ServerApiService(
      acpRepository as any,
      fileRepository as any,
      filesService as any,
      snapshotsService as any,
      validator as any,
    );
    const result = await validated.receiveAcp(
      {
        packageId: "pkg-1",
        name: "New ACP",
        acpIndex: { packageId: "pkg-1", version: "2.3.4" },
      },
      "overwrite",
    );
    expect(result.operation).toBe("created");
    expect(acpRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        acpIndexSchemaId: "acp-index@0.6",
        acpIndexValidationReport: report,
      }),
    );
    validator.validateCandidate.mockResolvedValue({ ...report, valid: false });
    await expect(
      validated.receiveAcp(
        {
          packageId: "pkg-1",
          name: "New ACP",
          acpIndex: { packageId: "pkg-1", version: "2.3.4" },
        },
        "overwrite",
      ),
    ).rejects.toThrow("ACP index violates acp-index@0.6");
  });

  it("creates a new ACP when package id is not known", async () => {
    acpRepository.findOne.mockResolvedValue(null);
    acpRepository.save.mockResolvedValue({
      id: "acp-created",
      packageId: "pkg-1",
      name: "New ACP",
      description: "",
      acpIndex: { version: "0.5.0" },
      settings: {},
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const result = await service.receiveAcp(
      {
        packageId: "pkg-1",
        name: "New ACP",
        acpIndex: { packageId: "pkg-1", version: "0.5.0" },
      },
      "overwrite",
    );

    expect(acpRepository.create).toHaveBeenCalledWith({
      packageId: "pkg-1",
      name: "New ACP",
      description: "",
      acpIndex: {
        packageId: "pkg-1",
        version: "0.5.0",
        name: [{ lang: "de", value: "New ACP" }],
      },
      settings: {},
    });
    expect(result.operation).toBe("created");
    expect(result.conflictStrategy).toBe("overwrite");
  });

  it("overwrites existing ACP index when conflictStrategy=overwrite", async () => {
    const existing = {
      id: TEST_UUIDS.acp,
      packageId: "pkg-1",
      name: "Old",
      description: "Old",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: { previous: true },
    } as any;
    acpRepository.findOne.mockResolvedValue(existing);
    acpRepository.save.mockImplementation(async (value) => ({
      ...value,
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }));

    const result = await service.receiveAcp(
      {
        packageId: "pkg-1",
        name: "Updated",
        description: "Updated Desc",
        acpIndex: { packageId: "pkg-1", replaced: true },
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      },
      "overwrite",
    );

    expect(result.operation).toBe("updated");
    expect(result.conflictStrategy).toBe("overwrite");
    expect(acpRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Updated",
        description: "Updated Desc",
        acpIndex: {
          packageId: "pkg-1",
          name: [{ lang: "de", value: "Updated" }],
          replaced: true,
        },
      }),
    );
  });
});
