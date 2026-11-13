import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SnapshotsService } from "./snapshots.service";
import { ApSnapshot, ApSnapshotFile, Ap, ApFile } from "../database/entities";
import * as fs from "fs/promises";
import * as path from "path";
import { TEST_UUIDS, createApFixture } from "../testing/test-fixtures";

jest.mock("fs/promises", () => ({
  access: jest.fn(),
  mkdir: jest.fn(),
  copyFile: jest.fn(),
  stat: jest.fn(),
  rm: jest.fn(),
}));

describe("SnapshotsService", () => {
  const apId = TEST_UUIDS.ap;
  const unknownApId = TEST_UUIDS.unknownAp;
  let service: SnapshotsService;
  let snapshotRepo: any;
  let snapshotFileRepo: any;
  let apRepo: any;
  let fileRepo: any;
  let configService: any;

  const mockAp = createApFixture({
    apIndex: { packageId: "test", version: "1.0", units: [{ id: "u1" }] },
  });

  const mockSnapshot = {
    id: "snap-1",
    apId: apId,
    versionNumber: 1,
    apIndexSnapshot: {
      packageId: "test",
      version: "1.0",
      units: [{ id: "u1" }],
    },
    changelog: "Initial",
    createdAt: new Date(),
    snapshotFiles: [],
  };

  beforeEach(async () => {
    snapshotRepo = {
      find: jest.fn().mockResolvedValue([mockSnapshot]),
      findOne: jest.fn().mockResolvedValue(mockSnapshot),
      create: jest
        .fn()
        .mockImplementation((dto) => ({ ...dto, id: "new-snap" })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    snapshotFileRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest
        .fn()
        .mockImplementation((entities) => Promise.resolve(entities)),
    };
    apRepo = {
      findOne: jest.fn().mockResolvedValue(mockAp),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };
    fileRepo = {
      find: jest.fn().mockResolvedValue([
        {
          filePath: "/f1.json",
          originalName: "f1.json",
          checksum: "abc",
          fileSize: 100,
        },
      ]),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    configService = {
      get: jest.fn().mockImplementation((key: string, fallback: string) => {
        if (key === "FILE_STORAGE_PATH") return "/tmp/uploads-test";
        return fallback;
      }),
    };

    (fs.access as jest.Mock).mockResolvedValue(undefined);
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.copyFile as jest.Mock).mockResolvedValue(undefined);
    (fs.stat as jest.Mock).mockResolvedValue({ size: 456 });
    (fs.rm as jest.Mock).mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SnapshotsService,
        { provide: getRepositoryToken(ApSnapshot), useValue: snapshotRepo },
        {
          provide: getRepositoryToken(ApSnapshotFile),
          useValue: snapshotFileRepo,
        },
        { provide: getRepositoryToken(Ap), useValue: apRepo },
        { provide: getRepositoryToken(ApFile), useValue: fileRepo },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<SnapshotsService>(SnapshotsService);
  });

  describe("findByAp", () => {
    it("should return snapshots ordered by version descending", async () => {
      const result = await service.findByAp(apId);
      expect(result).toHaveLength(1);
      expect(snapshotRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { versionNumber: "DESC" },
        }),
      );
    });

    it("should reject an unknown AP before querying snapshots", async () => {
      apRepo.findOne.mockResolvedValue(null);

      await expect(service.findByAp(unknownApId)).rejects.toThrow(
        NotFoundException,
      );
      expect(snapshotRepo.find).not.toHaveBeenCalled();
    });

    it("should reject a malformed AP ID before querying repositories", async () => {
      await expect(
        service.findByAp("__coding-box-connection-test__"),
      ).rejects.toThrow(BadRequestException);
      expect(apRepo.findOne).not.toHaveBeenCalled();
      expect(snapshotRepo.find).not.toHaveBeenCalled();
    });
  });

  describe("create", () => {
    it("should create a new snapshot with incremented version", async () => {
      snapshotRepo.findOne
        .mockResolvedValueOnce({ versionNumber: 2 }) // latest snapshot
        .mockResolvedValueOnce({
          ...mockSnapshot,
          id: "new-snap",
          snapshotFiles: [],
        }); // findById after save

      await service.create(apId, "Test changelog");
      expect(snapshotRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          versionNumber: 3,
          changelog: "Test changelog",
        }),
      );
    });

    it("should start at version 1 if no snapshots exist", async () => {
      snapshotRepo.findOne
        .mockResolvedValueOnce(null) // no latest snapshot
        .mockResolvedValueOnce({ ...mockSnapshot, snapshotFiles: [] }); // findById after save

      await service.create(apId);
      expect(snapshotRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          versionNumber: 1,
        }),
      );
    });

    it("should copy file references to snapshot", async () => {
      snapshotRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...mockSnapshot, snapshotFiles: [] });

      await service.create(apId);
      expect(snapshotFileRepo.create).toHaveBeenCalled();
      expect(snapshotFileRepo.save).toHaveBeenCalled();
    });

    it("should persist snapshot file copies for reliable restore", async () => {
      snapshotRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
        ...mockSnapshot,
        id: "new-snap",
        snapshotFiles: [],
      });

      await service.create(apId);

      const snapshotDir = path.join(
        "/tmp/uploads-test",
        apId,
        "snapshots",
        "new-snap",
      );
      expect(fs.copyFile).toHaveBeenCalledWith(
        "/f1.json",
        expect.stringContaining(snapshotDir),
      );
      expect(snapshotFileRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: expect.stringContaining(snapshotDir),
        }),
      );
    });

    it("should throw NotFoundException for unknown AP", async () => {
      apRepo.findOne.mockResolvedValue(null);
      await expect(service.create(unknownApId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should reject malformed AP IDs before creating a snapshot", async () => {
      await expect(service.create("bad")).rejects.toThrow(BadRequestException);
      expect(apRepo.findOne).not.toHaveBeenCalled();
      expect(snapshotRepo.save).not.toHaveBeenCalled();
    });
  });

  describe("restore", () => {
    it("should restore AP-Index and file references from snapshot", async () => {
      const snapshotWithFiles = {
        ...mockSnapshot,
        snapshotFiles: [
          {
            id: "sf-1",
            snapshotId: "snap-1",
            filePath: "/tmp/source/f1.json",
            originalName: "f1.json",
            checksum: "abc",
            fileSize: 100,
          },
        ],
      };
      snapshotRepo.findOne.mockResolvedValue(snapshotWithFiles);
      apRepo.findOne.mockResolvedValue({ ...mockAp });

      await service.restore("snap-1");
      expect(apRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          apIndex: snapshotWithFiles.apIndexSnapshot,
        }),
      );
      expect(fileRepo.delete).toHaveBeenCalledWith({
        apId: apId,
      });
      expect(fileRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          apId: apId,
          originalName: "f1.json",
        }),
      );
      expect(fileRepo.save).toHaveBeenCalled();
    });

    it("should fail restore when a snapshot file is missing on disk", async () => {
      const snapshotWithMissingFile = {
        ...mockSnapshot,
        snapshotFiles: [
          {
            id: "sf-1",
            snapshotId: "snap-1",
            filePath: "/tmp/source/missing.json",
            originalName: "missing.json",
            checksum: "abc",
            fileSize: 100,
          },
        ],
      };
      snapshotRepo.findOne.mockResolvedValue(snapshotWithMissingFile);
      apRepo.findOne.mockResolvedValue({ ...mockAp });
      (fs.access as jest.Mock).mockRejectedValueOnce(new Error("ENOENT"));

      await expect(service.restore("snap-1")).rejects.toThrow(
        NotFoundException,
      );
      expect(fileRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe("diff", () => {
    it("should compare with the direct previous snapshot version", async () => {
      const currentSnapshot = {
        ...mockSnapshot,
        id: "snap-2",
        versionNumber: 2,
        snapshotFiles: [
          { originalName: "a.xml", checksum: "222" },
          { originalName: "b.xml", checksum: "bbb" },
        ],
      };
      const previousSnapshot = {
        ...mockSnapshot,
        id: "snap-1",
        versionNumber: 1,
        snapshotFiles: [
          { originalName: "a.xml", checksum: "111" },
          { originalName: "c.xml", checksum: "ccc" },
        ],
      };

      snapshotRepo.findOne.mockImplementation((query: any) => {
        if (query?.where?.id === "snap-2")
          return Promise.resolve(currentSnapshot);
        if (query?.where?.apId === apId && query?.where?.versionNumber) {
          return Promise.resolve(previousSnapshot);
        }
        return Promise.resolve(null);
      });

      const result = await service.diff("snap-2");

      expect(result).toEqual(
        expect.objectContaining({
          snapshotId: "snap-2",
          comparedWith: "snap-1",
          added: ["b.xml"],
          removed: ["c.xml"],
          modified: ["a.xml"],
          unchanged: 0,
        }),
      );
    });
  });

  describe("delete", () => {
    it("should remove snapshot and cleanup snapshot folders", async () => {
      snapshotRepo.findOne.mockResolvedValue({
        ...mockSnapshot,
        snapshotFiles: [],
      });

      await service.delete("snap-1");

      expect(snapshotRepo.remove).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "snap-1",
        }),
      );
      expect(fs.rm).toHaveBeenCalledWith(
        path.join("/tmp/uploads-test", apId, "snapshots", "snap-1"),
        { recursive: true, force: true },
      );
      expect(fs.rm).toHaveBeenCalledWith(
        path.join("/tmp/uploads-test", apId, "snapshot-restore", "snap-1"),
        { recursive: true, force: true },
      );
    });

    it("should keep path values stable even if repository remove mutates the entity", async () => {
      snapshotRepo.findOne.mockResolvedValue({
        ...mockSnapshot,
        snapshotFiles: [],
      });
      snapshotRepo.remove.mockImplementation(async (entity: any) => {
        entity.apId = undefined;
        entity.id = undefined;
        return entity;
      });

      await service.delete("snap-1");

      expect(fs.rm).toHaveBeenCalledWith(
        path.join("/tmp/uploads-test", apId, "snapshots", "snap-1"),
        { recursive: true, force: true },
      );
      expect(fs.rm).toHaveBeenCalledWith(
        path.join("/tmp/uploads-test", apId, "snapshot-restore", "snap-1"),
        { recursive: true, force: true },
      );
    });
  });

  describe("diffWithCurrent", () => {
    it("should compare snapshot against current AP state", async () => {
      const snapshot = {
        ...mockSnapshot,
        id: "snap-2",
        versionNumber: 2,
        apIndexSnapshot: { packageId: "test", version: "1.0" },
        snapshotFiles: [
          { originalName: "same.xml", checksum: "111" },
          { originalName: "changed.xml", checksum: "old" },
          { originalName: "removed.xml", checksum: "gone" },
        ],
      };
      snapshotRepo.findOne.mockImplementation((query: any) => {
        if (query?.where?.id === "snap-2") return Promise.resolve(snapshot);
        return Promise.resolve(mockSnapshot);
      });
      apRepo.findOne.mockResolvedValue({
        ...mockAp,
        apIndex: { packageId: "test", version: "2.0" },
      });
      fileRepo.find.mockResolvedValue([
        { originalName: "same.xml", checksum: "111" },
        { originalName: "changed.xml", checksum: "new" },
        { originalName: "added.xml", checksum: "add" },
      ]);

      const result = await service.diffWithCurrent("snap-2");

      expect(result).toEqual({
        snapshotId: "snap-2",
        comparedWith: "current",
        indexChanged: true,
        added: ["added.xml"],
        removed: ["removed.xml"],
        modified: ["changed.xml"],
        unchanged: 1,
      });
    });
  });
});
