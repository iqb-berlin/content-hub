import { ReviewerColumnPolicy } from "../item-explorer/reviewer-column-policy";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { CommentsService } from "./comments.service";
import { Acp, Comment, CommentTargetType } from "../database/entities";
import { ReviewPolicyService } from "./review-policy.service";

describe("CommentsService", () => {
  let service: CommentsService;
  let commentRepository: {
    manager?: any;
    query: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let deleteQueryBuilder: any;
  let accessConfigRepository: { findOne: jest.Mock };
  let unitParserService: { getItemListFromFiles: jest.Mock };
  let fileCatalogCache: { get: jest.Mock };
  let acpRepository: { findOne: jest.Mock };
  let reviewManifestService: { getManifest: jest.Mock };

  beforeEach(() => {
    deleteQueryBuilder = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };
    commentRepository = {
      query: jest.fn().mockResolvedValue([]),
      find: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((value) => ({ id: "c-1", ...value })),
      save: jest.fn().mockImplementation(async (value) => value),
      findOne: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(deleteQueryBuilder),
    };

    accessConfigRepository = {
      findOne: jest.fn().mockResolvedValue({
        featureConfig: {
          enableReview: true,
          commentVisibilityMode: "PRIVATE",
        },
      }),
    };
    unitParserService = {
      getItemListFromFiles: jest.fn().mockResolvedValue({
        items: [{ unitId: "unit-1", itemId: "item-1" }],
      }),
    };
    fileCatalogCache = {
      get: jest.fn().mockResolvedValue({ signature: "files-v1" }),
    };
    acpRepository = {
      findOne: jest.fn().mockResolvedValue({
        acpIndex: null,
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    };
    reviewManifestService = {
      getManifest: jest.fn().mockResolvedValue({
        booklets: [],
        units: [{ id: "unit-1", name: "Unit 1", items: [{ id: "item-1" }] }],
        issues: [],
      }),
    };

    const manager = {
      findOne: jest.fn(),
      getRepository: (entity: any) =>
        entity === Comment
          ? commentRepository
          : entity === Acp
            ? acpRepository
            : accessConfigRepository,
      transaction: async (fn: any): Promise<any> => fn(manager),
    };
    commentRepository.manager = manager;
    service = new CommentsService(
      commentRepository as any,
      new ReviewPolicyService(accessConfigRepository as any),
      unitParserService as any,
      fileCatalogCache as any,
      acpRepository as any,
      reviewManifestService as any,
    );
  });

  it("queries comments by ACP, user and credential", async () => {
    commentRepository.find.mockResolvedValue([{ id: "c-1" }]);

    await expect(service.findByAcp("acp-1")).resolves.toEqual([{ id: "c-1" }]);
    await expect(service.findByUser("acp-1", "u-1")).resolves.toEqual([
      { id: "c-1" },
    ]);
    await expect(
      service.findByCredential("acp-1", "credential-1"),
    ).resolves.toEqual([{ id: "c-1" }]);

    expect(commentRepository.find).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({ acpId: "acp-1" }),
      relations: ["user"],
      order: { createdAt: "DESC" },
    });
    expect(commentRepository.find).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({ acpId: "acp-1", userId: "u-1" }),
      relations: ["user"],
      order: { createdAt: "DESC" },
    });
    expect(commentRepository.find).toHaveBeenNthCalledWith(3, {
      where: expect.objectContaining({
        acpId: "acp-1",
        credentialId: "credential-1",
      }),
      relations: ["user"],
      order: { createdAt: "DESC" },
    });
  });

  it("creates comments", async () => {
    const created = await service.create({
      acpId: "acp-1",
      userId: "u-1",
      targetType: CommentTargetType.ITEM,
      targetId: "item-1",
      commentText: "hello",
    });

    expect(commentRepository.create).toHaveBeenCalled();
    expect(created).toEqual(
      expect.objectContaining({
        acpId: "acp-1",
        commentText: "hello",
      }),
    );
  });

  it("rejects blank comment text without relying on controller validation", async () => {
    await expect(
      service.create({
        acpId: "acp-1",
        targetType: CommentTargetType.ITEM,
        targetId: "unit-1_item-1",
        commentText: "   ",
      }),
    ).rejects.toThrow(BadRequestException);
    expect(commentRepository.save).not.toHaveBeenCalled();
  });

  it("deletes only unresolved legacy task-sequence comments by ACP", async () => {
    deleteQueryBuilder.execute.mockResolvedValueOnce({ affected: 4 });
    commentRepository.count.mockResolvedValueOnce(7);
    await expect(
      service.deleteUnreferencedLegacyByAcp("acp-1"),
    ).resolves.toEqual({ deletedCount: 4, retainedCount: 7 });

    expect(deleteQueryBuilder.where).toHaveBeenCalledWith('"acp_id" = :acpId', {
      acpId: "acp-1",
    });
    expect(deleteQueryBuilder.andWhere).toHaveBeenCalledWith(
      '"target_type" = :legacyTargetType',
      { legacyTargetType: CommentTargetType.TASK_SEQUENCE },
    );
    expect(deleteQueryBuilder.andWhere).toHaveBeenCalledWith(
      '"legacy_read_only" = true',
    );
    expect(deleteQueryBuilder.andWhere).toHaveBeenCalledWith(
      '"parent_comment_id" IS NULL',
    );
    expect(deleteQueryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("NOT EXISTS"),
    );

    deleteQueryBuilder.execute.mockResolvedValueOnce({ affected: undefined });
    commentRepository.count.mockResolvedValueOnce(2);
    await expect(
      service.deleteUnreferencedLegacyByAcp("acp-2"),
    ).resolves.toEqual({ deletedCount: 0, retainedCount: 2 });
    expect(commentRepository.count).toHaveBeenNthCalledWith(1, {
      where: { acpId: "acp-1" },
    });
    expect(commentRepository.count).toHaveBeenNthCalledWith(2, {
      where: { acpId: "acp-2" },
    });
  });

  it("exports comments with proper author fallback chains", async () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    commentRepository.find
      .mockResolvedValueOnce([
        {
          targetType: CommentTargetType.ITEM,
          targetId: "item-1",
          commentText: "text",
          createdAt: date,
          user: { displayName: "Display Name", username: "user-a" },
          credentialUsername: "credential-a",
        },
      ])
      .mockResolvedValueOnce([
        {
          targetType: CommentTargetType.UNIT,
          targetId: "unit-1",
          commentText: "user text",
          createdAt: date,
          user: { username: "user-b" },
        },
      ])
      .mockResolvedValueOnce([
        {
          targetType: CommentTargetType.ITEM,
          targetId: "item-2",
          commentText: "text-2",
          createdAt: date,
          user: null,
          credentialUsername: null,
        },
      ]);

    const all = await service.exportComments("acp-1");
    const user = await service.exportComments("acp-1", "u-1");
    const unknownAuthor = await service.exportComments("acp-1");

    expect(all[0].author).toBe("Display Name");
    expect(user[0].author).toBe("user-b");
    expect(unknownAuthor[0].author).toBe("Unknown");

    expect(commentRepository.find).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ acpId: "acp-1", userId: "u-1" }),
      }),
    );
  });

  it.each([
    [
      { displayName: "Person Name", username: "person@example.org" },
      "Person Name",
    ],
    [{ displayName: "person@example.org", username: "person" }, "person"],
    [null, "Unknown"],
  ])(
    "replaces legacy email labels with a current name in threads and exports",
    async (user, expected) => {
      accessConfigRepository.findOne.mockResolvedValue({
        featureConfig: {
          enableReview: true,
          enableCommenting: true,
          commentTargets: ["ITEM"],
          commentVisibilityMode: "PRIVATE",
        },
      });
      const comment = {
        id: "legacy-email",
        userId: "user-1",
        targetType: CommentTargetType.ITEM,
        targetId: "unit-1_item-1",
        unitId: "unit-1",
        itemId: "item-1",
        authorLabel: "person@example.org",
        commentText: "Existing comment",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        user,
      } as any;
      commentRepository.find.mockResolvedValue([comment]);
      const actor = { userId: "user-1", authorLabel: "ME", isManager: false };
      expect(
        (await service.getItemThread("acp-1", "unit-1", "item-1", actor))
          .comments[0].authorLabel,
      ).toBe(expected);
      expect((await service.exportComments("acp-1"))[0].author).toBe(expected);
    },
  );

  it("exports comments by credential and prefers credential author", async () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    commentRepository.find.mockResolvedValue([
      {
        targetType: CommentTargetType.ITEM,
        targetId: "item-1",
        commentText: "credential text",
        createdAt: date,
        credentialUsername: "reader-1",
        user: { displayName: "Should not win" },
      } as any,
    ]);

    const result = await service.exportCommentsByCredential(
      "acp-1",
      "credential-1",
    );

    expect(result[0].author).toBe("reader-1");
  });

  it("builds XLSX buffers for user and credential exports", async () => {
    jest.spyOn(service, "exportComments").mockResolvedValue([
      {
        targetType: CommentTargetType.ITEM,
        targetId: "item-1",
        comment: "row",
        author: "author",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ] as any);

    jest.spyOn(service, "exportCommentsByCredential").mockResolvedValue([
      {
        targetType: CommentTargetType.UNIT,
        targetId: "unit-1",
        comment: "row",
        author: "reader",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ] as any);

    const byUser = await service.exportCommentsXlsx("acp-1", "u-1");
    const byCredential = await service.exportCommentsXlsxByCredential(
      "acp-1",
      "credential-1",
    );

    expect(Buffer.isBuffer(byUser)).toBe(true);
    expect(Buffer.isBuffer(byCredential)).toBe(true);
    expect(byUser.length).toBeGreaterThan(0);
    expect(byCredential.length).toBeGreaterThan(0);
  });

  it("checks comment feature flags per target type", async () => {
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: { enableReview: true, enableCommenting: false },
    });
    await expect(
      service.isCommentingEnabled("acp-1", CommentTargetType.ITEM),
    ).resolves.toBe(false);

    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: { enableReview: true, enableCommenting: true },
    });
    await expect(
      service.isCommentingEnabled("acp-1", CommentTargetType.ITEM),
    ).resolves.toBe(true);

    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.UNIT],
      },
    });
    await expect(
      service.isCommentingEnabled("acp-1", CommentTargetType.UNIT),
    ).resolves.toBe(true);
    await expect(
      service.isCommentingEnabled("acp-1", CommentTargetType.ITEM),
    ).resolves.toBe(false);
  });

  it("returns shared item threads and keeps private replies without leaking parents", async () => {
    const createdAt = new Date("2026-01-01T10:00:00.000Z");
    const root = {
      id: "root",
      acpId: "acp-1",
      userId: "other",
      targetType: CommentTargetType.ITEM,
      targetId: "unit-1_item-1",
      unitId: "unit-1",
      itemId: "item-1",
      parentCommentId: null,
      commentText: "Root",
      authorLabel: "AB",
      createdAt,
      updatedAt: createdAt,
      version: 1,
    } as any;
    const reply = {
      ...root,
      id: "reply",
      userId: "me",
      parentCommentId: "root",
      commentText: "Reply",
      authorLabel: "ME",
      createdAt: new Date("2026-01-01T11:00:00.000Z"),
      updatedAt: new Date("2026-01-01T11:00:00.000Z"),
    };
    commentRepository.find.mockResolvedValue([root, reply]);
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "SHARED",
      },
    });
    const actor = { userId: "me", authorLabel: "ME", isManager: false };

    const shared = await service.getItemThread(
      "acp-1",
      "unit-1",
      "item-1",
      actor,
    );
    expect(shared.comments).toHaveLength(2);
    expect(shared.comments[1]).toMatchObject({
      id: "reply",
      isOwn: true,
      parentVisible: true,
    });

    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "PRIVATE",
      },
    });
    const privateSnapshot = await service.getItemThread(
      "acp-1",
      "unit-1",
      "item-1",
      actor,
    );
    expect(privateSnapshot.comments).toEqual([
      expect.objectContaining({ id: "reply", parentVisible: false }),
    ]);
  });

  it.each([
    { targetId: "item-1", collidingItem: false, expectedCount: 0 },
    { targetId: "unit-1_item-1", collidingItem: false, expectedCount: 1 },
    { targetId: "unit-1_item-1", collidingItem: true, expectedCount: 0 },
  ])(
    "matches thread and batch counts for legacy target $targetId (collision: $collidingItem)",
    async ({ targetId, collidingItem, expectedCount }) => {
      unitParserService.getItemListFromFiles.mockResolvedValue({
        items: [
          { unitId: "unit-1", itemId: "item-1" },
          ...(collidingItem
            ? [{ unitId: "unit-1", itemId: "unit-1_item-1" }]
            : []),
        ],
      });
      accessConfigRepository.findOne.mockResolvedValue({
        featureConfig: {
          enableReview: true,
          enableCommenting: true,
          commentVisibilityMode: "SHARED",
        },
      });
      const comment = {
        id: "legacy",
        acpId: "acp-1",
        userId: "me",
        targetType: CommentTargetType.ITEM,
        targetId,
        unitId: null,
        itemId: null,
        deletedAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        version: 1,
      };
      commentRepository.find.mockImplementation(async ({ where }) => {
        const alternatives = Array.isArray(where) ? where : [where];
        return alternatives.some((clause: any) =>
          Object.entries(clause).every(([key, value]: any) =>
            value && typeof value === "object" && value._type === "isNull"
              ? (comment as any)[key] == null
              : (comment as any)[key] === value,
          ),
        )
          ? [comment]
          : [];
      });
      const actor = { userId: "me", authorLabel: "ME", isManager: false };
      const counts = await service.getItemCommentCounts("acp-1", actor);
      const thread = await service.getItemThread(
        "acp-1",
        "unit-1",
        "item-1",
        actor,
      );
      expect(thread.comments).toHaveLength(expectedCount);
      expect(counts.counts[0]?.count || 0).toBe(thread.comments.length);
    },
  );

  it("loads visible item comment counts in one repository query and shares them across rows", async () => {
    const createdAt = new Date("2026-01-01T10:00:00.000Z");
    unitParserService.getItemListFromFiles.mockResolvedValue({
      items: [
        { unitId: "unit-1", itemId: "item-1" },
        { unitId: "unit-1", itemId: "item-2" },
      ],
    });
    commentRepository.find.mockResolvedValue([
      {
        id: "own",
        acpId: "acp-1",
        userId: "me",
        targetType: CommentTargetType.ITEM,
        targetId: "unit-1_item-1",
        unitId: "unit-1",
        itemId: "item-1",
        createdAt,
      },
      {
        id: "hidden",
        acpId: "acp-1",
        userId: "other",
        targetType: CommentTargetType.ITEM,
        targetId: "unit-1_item-1",
        unitId: "unit-1",
        itemId: "item-1",
        createdAt,
      },
      {
        id: "legacy",
        acpId: "acp-1",
        userId: "me",
        targetType: CommentTargetType.ITEM,
        targetId: "unit-1_item-2",
        unitId: null,
        itemId: null,
        createdAt,
      },
    ]);
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "PRIVATE",
      },
    });

    const snapshot = await service.getItemCommentCounts("acp-1", {
      userId: "me",
      authorLabel: "ME",
      isManager: false,
    });

    expect(snapshot.counts).toEqual([
      { unitId: "unit-1", itemId: "item-1", count: 1, codingCount: 0 },
      { unitId: "unit-1", itemId: "item-2", count: 1, codingCount: 0 },
    ]);
    expect(commentRepository.find).toHaveBeenCalledTimes(1);
    expect(commentRepository.find).toHaveBeenCalledWith({
      where: expect.arrayContaining([
        expect.objectContaining({
          acpId: "acp-1",
          targetType: CommentTargetType.ITEM,
        }),
      ]),
    });
  });

  it("applies combined filters to both CSV and XLSX without exporting other comments", async () => {
    const base = {
      acpId: "acp-1",
      userId: "manager",
      targetType: CommentTargetType.UNIT,
      targetId: "unit-1",
      groupId: "g",
      authorLabel: "Alex",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    };
    commentRepository.find.mockResolvedValue([
      { ...base, id: "yes", commentText: "Bitte PRÜFEN" },
      {
        ...base,
        id: "no-group",
        groupId: "other",
        commentText: "Andere Gruppe prüfen",
      },
      {
        ...base,
        id: "no-author",
        authorLabel: "Sam",
        commentText: "Anderer Autor prüfen",
      },
      {
        ...base,
        id: "no-type",
        targetType: CommentTargetType.ITEM,
        commentText: "Anderer Bezug prüfen",
      },
    ]);
    const actor = {
      userId: "manager",
      filters: {
        q: " prüfen ",
        author: "Alex",
        groupId: "g",
        targetType: CommentTargetType.UNIT,
      },
    };
    const csv = (
      await service.exportReviewCommentsCsv("acp-1", actor)
    ).toString("utf8");
    expect(csv).toContain("Bitte PRÜFEN");
    expect(csv).not.toContain("Andere");
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await service.exportReviewCommentsXlsx("acp-1", actor)) as any,
    );
    const sheet = workbook.getWorksheet("Kommentare")!;
    expect(sheet.rowCount).toBe(2);
    expect(JSON.stringify(sheet.getRow(2).values)).toContain("Bitte PRÜFEN");
  });

  it("keeps personal review exports personal for manager identities", async () => {
    const date = new Date("2026-01-01T10:00:00.000Z");
    commentRepository.find.mockResolvedValue([
      {
        id: "mine",
        acpId: "acp-1",
        userId: "manager",
        targetType: CommentTargetType.ITEM,
        targetId: "unit-1_item-1",
        unitId: "unit-1",
        itemId: "item-1",
        parentCommentId: null,
        commentText: "=2+2",
        authorLabel: "MA",
        createdAt: date,
        updatedAt: date,
      },
    ]);

    const csv = await service.exportReviewCommentsCsv("acp-1", {
      userId: "manager",
    });

    expect(commentRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "manager" }),
      }),
    );
    expect(csv.toString("utf8")).toContain('"\'=2+2"');
    expect(csv.toString("utf8").startsWith("\uFEFF")).toBe(true);
    await expect(service.exportReviewCommentsXlsx("acp-1", {})).rejects.toThrow(
      ForbiddenException,
    );
  });

  it.each([
    {
      mode: "SHARED",
      deleted: false,
      expected: true,
      visible: false,
      manager: false,
    },
    {
      mode: "GROUP",
      deleted: false,
      expected: true,
      visible: false,
      manager: false,
    },
    {
      mode: "GROUP",
      deleted: true,
      expected: true,
      visible: true,
      manager: false,
    },
    {
      mode: "PRIVATE",
      deleted: true,
      expected: true,
      visible: true,
      manager: false,
    },
    {
      mode: "PRIVATE",
      deleted: false,
      expected: false,
      visible: false,
      manager: false,
    },
    {
      mode: "GROUP",
      deleted: true,
      expected: false,
      visible: true,
      manager: false,
      foreignGroup: true,
    },
    {
      mode: "GROUP",
      deleted: true,
      expected: true,
      visible: false,
      manager: true,
    },
  ])(
    "preserves only permitted export thread references: %j",
    async (scenario) => {
      const date = new Date("2026-01-01T10:00:00.000Z");
      const root = {
        id: "root",
        acpId: "acp-1",
        userId: "other",
        groupId: scenario.foreignGroup ? "foreign" : "group",
        deletedAt: scenario.deleted ? date : null,
        commentText: "Root text must not be exported",
        authorLabel: "Other author",
      };
      const replies = ["reply-1", "reply-2"].map((id) => ({
        id,
        acpId: "acp-1",
        userId: "me",
        groupId: "group",
        parentCommentId: "root",
        targetType: CommentTargetType.ITEM,
        targetId: "unit-1_item-1",
        unitId: "unit-1",
        itemId: "item-1",
        commentText: id,
        authorLabel: "ME",
        createdAt: date,
        updatedAt: date,
      }));
      accessConfigRepository.findOne.mockResolvedValue({
        featureConfig: {
          enableReview: true,
          commentVisibilityMode: scenario.mode,
        },
        reviewGroups: [
          {
            id: "group",
            name: "Group",
            archived: false,
            members: [{ kind: "user", id: "me" }],
          },
        ],
      });
      commentRepository.find.mockImplementation(async ({ where }) =>
        where.id ? [root] : replies,
      );
      const actor = scenario.manager
        ? undefined
        : { userId: "me", visible: scenario.visible };
      const csv = (
        await service.exportReviewCommentsCsv(
          "acp-1",
          actor || { userId: "me", isManager: true },
        )
      ).toString("utf8");
      expect(csv).not.toContain(root.commentText);
      expect(csv).not.toContain(root.authorLabel);
      if (scenario.expected) expect(csv.match(/"root"/g)).toHaveLength(4);
      else expect(csv).not.toContain('"root"');

      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        (await service.exportReviewCommentsXlsx("acp-1", actor)) as any,
      );
      const sheet = workbook.getWorksheet("Kommentare")!;
      const headers = sheet.getRow(1).values as unknown[];
      const threadColumn = headers.indexOf("Thread-ID");
      const parentColumn = headers.indexOf("Antwort auf");
      expect(threadColumn).toBeGreaterThan(0);
      expect(parentColumn).toBeGreaterThan(0);
      expect(sheet.rowCount).toBe(3);
      for (let row = 2; row <= 3; row++) {
        expect(sheet.getRow(row).getCell(threadColumn).value).toBe(
          scenario.expected ? "root" : replies[row - 2].id,
        );
        expect(sheet.getRow(row).getCell(parentColumn).value || "").toBe(
          scenario.expected ? "root" : "",
        );
      }
    },
  );

  it.each([
    { userId: "manager", isManager: true },
    { credentialId: "credential-1", isManager: true },
  ])(
    "exports identical personal data in manifest order for %j",
    async (actor) => {
      const units = ["unused", "second", "first"].map((id) => ({
        id,
        name: `Unit ${id}`,
        items: [
          { id: "z", name: "Zuerst" },
          { id: "a", name: "Danach" },
        ],
      }));
      acpRepository.findOne.mockResolvedValue({
        acpIndex: { assessmentParts: [{ units }] },
      });
      unitParserService.getItemListFromFiles.mockResolvedValue({ items: [] });
      reviewManifestService.getManifest.mockResolvedValue({
        units,
        booklets: [
          {
            id: "b2",
            name: "Zweites",
            units: [{ id: "first" }, { id: "second" }],
          },
          { id: "b1", name: "Erstes", units: [{ id: "first" }] },
        ],
      });
      const comment = (
        id: string,
        unitId: string,
        itemId = "",
        extra = {},
      ) => ({
        id,
        acpId: "acp-1",
        userId: actor.userId,
        credentialId: actor.credentialId,
        targetType: itemId ? CommentTargetType.ITEM : CommentTargetType.UNIT,
        targetId: itemId || unitId,
        unitId,
        itemId,
        commentText: id,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-02"),
        ...extra,
      });
      commentRepository.find.mockResolvedValue([
        comment("unused", "unused"),
        comment("second", "second"),
        comment("a", "first", "a"),
        comment("z-later", "first", "z", { createdAt: new Date("2026-01-02") }),
        comment("z-2", "first", "z"),
        comment("z-1", "first", "z", {
          commentText: 'Ä; "Zitat"\r\nNeue Zeile 📝',
        }),
        comment("first", "first"),
        comment("legacy", "first", "", { legacyReadOnly: true }),
        comment("b1", "", "", {
          targetType: CommentTargetType.BOOKLET,
          bookletId: "b1",
        }),
        comment("b2", "", "", {
          targetType: CommentTargetType.BOOKLET,
          bookletId: "b2",
        }),
      ]);
      const csv = (
        await service.exportReviewCommentsCsv("acp-1", actor)
      ).toString("utf8");
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        (await service.exportReviewCommentsXlsx("acp-1", actor)) as any,
      );
      const sheet = workbook.getWorksheet("Kommentare")!;
      const rows: string[][] = [];
      sheet.eachRow((row) =>
        rows.push(
          Array.from({ length: sheet.columnCount }, (_, i) =>
            String(row.getCell(i + 1).value ?? ""),
          ),
        ),
      );
      // Parse quoted CSV fields including embedded separators, quotes and newlines.
      const fields = [...csv.matchAll(/"((?:[^"]|"")*)"/g)].map((match) =>
        match[1].replace(/""/g, '"'),
      );
      expect(fields.map((field) => field.replace(/\r\n/g, "\n"))).toEqual(
        rows.flat(),
      );
      const column = rows[0].indexOf("Kommentar");
      expect(rows.slice(1).map((row) => row[column])).toEqual([
        "b2",
        "b1",
        "first",
        'Ä; "Zitat"\nNeue Zeile 📝',
        "z-2",
        "z-later",
        "a",
        "second",
        "unused",
        "legacy",
      ]);
      expect(rows[0]).not.toContain("Autor");
      expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
      expect(sheet.autoFilter).toBeTruthy();
      expect(sheet.getRow(2).getCell(column + 1).alignment.wrapText).toBe(true);
      expect(commentRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining(
            actor.userId
              ? { userId: actor.userId }
              : { credentialId: actor.credentialId },
          ),
        }),
      );
      commentRepository.find.mockResolvedValue([]);
      const emptyCsv = (
        await service.exportReviewCommentsCsv("acp-1", actor)
      ).toString("utf8");
      expect(emptyCsv.split("\r\n")).toHaveLength(2);
      await workbook.xlsx.load(
        (await service.exportReviewCommentsXlsx("acp-1", actor)) as any,
      );
      expect(workbook.getWorksheet("Kommentare")!.rowCount).toBe(1);
    },
  );

  it("uses ACP labels and content order for the shared CSV and XLSX projection", async () => {
    const date = new Date("2026-01-01T10:00:00.000Z");
    acpRepository.findOne.mockResolvedValue({
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      acpIndex: {
        assessmentParts: [
          {
            bookletModules: [
              {
                id: "booklet-2",
                name: [{ lang: "de", value: "Booklet Zwei" }],
              },
            ],
            units: [
              {
                id: "unit-2",
                name: "Unit Zwei",
                items: [
                  { id: "item-2", name: "Item Zwei" },
                  { id: "item-1", name: "Item Eins" },
                ],
              },
              {
                id: "unit-1",
                name: "Unit Eins",
                items: [{ id: "item-9", name: "Item Neun" }],
              },
            ],
          },
        ],
      },
    });
    unitParserService.getItemListFromFiles.mockResolvedValue({ items: [] });
    const comment = (
      id: string,
      targetType: CommentTargetType,
      targetId: string,
      commentText: string,
      unitId?: string,
      itemId?: string,
    ) => ({
      id,
      acpId: "acp-1",
      userId: "manager",
      targetType,
      targetId,
      unitId: unitId || null,
      itemId: itemId || null,
      parentCommentId: null,
      commentText,
      createdAt: date,
      updatedAt: date,
    });
    commentRepository.find.mockResolvedValue([
      comment(
        "unit-1-item",
        CommentTargetType.ITEM,
        "unit-1_item-9",
        "Kommentar Unit 1",
        "unit-1",
        "item-9",
      ),
      comment(
        "unit-2-item-1",
        CommentTargetType.ITEM,
        "unit-2_item-1",
        "Kommentar Item 1",
        "unit-2",
        "item-1",
      ),
      comment(
        "booklet",
        CommentTargetType.TASK_SEQUENCE,
        "booklet-2",
        "Kommentar Booklet",
      ),
      comment(
        "unit-2-item-2",
        CommentTargetType.ITEM,
        "unit-2_item-2",
        "Kommentar Item 2",
        "unit-2",
        "item-2",
      ),
      comment("unit-2", CommentTargetType.UNIT, "unit-2", "Kommentar Unit 2"),
    ]);

    const csv = await service.exportReviewCommentsCsv("acp-1", {
      userId: "manager",
    });
    const csvText = csv.toString("utf8");
    expect(csvText).toContain('"Booklet-Bezeichnung"');
    expect(csvText).toContain('"Unit-Bezeichnung"');
    expect(csvText).toContain('"Item-Bezeichnung"');
    expect(csvText).toContain('"Booklet Zwei"');
    expect(csvText).toContain('"Unit Zwei"');
    expect(csvText).toContain('"Item Zwei"');
    expect(csvText.indexOf("Kommentar Booklet")).toBeLessThan(
      csvText.indexOf("Kommentar Unit 2"),
    );
    expect(csvText.indexOf("Kommentar Unit 2")).toBeLessThan(
      csvText.indexOf("Kommentar Item 2"),
    );
    expect(csvText.indexOf("Kommentar Item 2")).toBeLessThan(
      csvText.indexOf("Kommentar Item 1"),
    );
    expect(csvText.indexOf("Kommentar Item 1")).toBeLessThan(
      csvText.indexOf("Kommentar Unit 1"),
    );

    const xlsx = await service.exportReviewCommentsXlsx("acp-1", {
      userId: "manager",
    });
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx as any);
    const sheet = workbook.getWorksheet("Kommentare")!;
    expect(sheet.getRow(1).values).toEqual(
      expect.arrayContaining([
        "Booklet-Bezeichnung",
        "Unit-Bezeichnung",
        "Item-Bezeichnung",
      ]),
    );
    const commentColumnIndex = (sheet.getRow(1).values as unknown[]).indexOf(
      "Kommentar",
    );
    const xlsxComments = sheet
      .getColumn(commentColumnIndex)
      .values.slice(2)
      .map(String);
    expect(xlsxComments).toEqual([
      "Kommentar Booklet",
      "Kommentar Unit 2",
      "Kommentar Item 2",
      "Kommentar Item 1",
      "Kommentar Unit 1",
    ]);
    for (const released of [false, true]) {
      const visible = released ? ["metadata:booklet"] : [];
      const actor = {
        userId: "manager",
        columnPolicy: new ReviewerColumnPolicy({
          restrictReviewerColumnsToManagerSelection: true,
          layout: { configured: true, visible, order: visible, widths: {} },
        }),
      };
      const restrictedCsv = (
        await service.exportReviewCommentsCsv("acp-1", actor)
      ).toString("utf8");
      const restrictedWorkbook = new ExcelJS.Workbook();
      await restrictedWorkbook.xlsx.load(
        (await service.exportReviewCommentsXlsx("acp-1", actor)) as any,
      );
      const sheetData = JSON.stringify(
        restrictedWorkbook.getWorksheet("Kommentare")!.getSheetValues(),
      );
      for (const serialized of [restrictedCsv, sheetData]) {
        expect(serialized.includes("Booklet-Bezeichnung")).toBe(released);
        expect(serialized.includes("Booklet-ID")).toBe(released);
        expect(serialized.includes("Booklet Zwei")).toBe(released);
        expect(serialized.includes("booklet-2")).toBe(released);
        expect(serialized).not.toContain("Unit Zwei");
        expect(serialized).not.toContain("Item Zwei");
        expect(serialized).toContain("Kommentar Booklet");
      }
    }
  });

  it("does not transfer comment ownership to a recreated credential with the same username", async () => {
    const date = new Date("2026-01-01T10:00:00.000Z");
    commentRepository.find.mockResolvedValue([
      {
        id: "old-comment",
        acpId: "acp-1",
        credentialId: "old-credential-id",
        credentialUsername: "reviewer",
        targetType: CommentTargetType.ITEM,
        targetId: "unit-1_item-1",
        unitId: "unit-1",
        itemId: "item-1",
        commentText: "Old owner",
        createdAt: date,
        updatedAt: date,
        version: 1,
      },
    ]);
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "PRIVATE",
      },
    });

    const snapshot = await service.getItemThread("acp-1", "unit-1", "item-1", {
      credentialId: "new-credential-id",
      credentialUsername: "reviewer",
      authorLabel: "RE",
      isManager: false,
    });

    expect(snapshot.comments).toEqual([]);
  });

  it("creates one-level replies for existing items with stable credential ownership", async () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "SHARED",
      },
    });
    commentRepository.findOne.mockResolvedValue({
      id: "reply-1",
      acpId: "acp-1",
      targetType: CommentTargetType.ITEM,
      targetId: "unit-1_item-1",
      unitId: "unit-1",
      itemId: "item-1",
      parentCommentId: "root-1",
    });
    commentRepository.save.mockImplementation(async (value) => ({
      ...value,
      createdAt: date,
      updatedAt: date,
    }));

    const result = await service.createItemComment(
      "acp-1",
      {
        unitId: "unit-1",
        itemId: "item-1",
        parentCommentId: "reply-1",
        commentText: " Antwort ",
      },
      {
        credentialId: "cred-1",
        credentialUsername: "reader",
        authorLabel: "RE",
        isManager: false,
      },
    );

    expect(unitParserService.getItemListFromFiles).toHaveBeenCalledWith(
      "acp-1",
      {},
      commentRepository.manager,
    );
    expect(commentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: "cred-1",
        unitId: "unit-1",
        itemId: "item-1",
        parentCommentId: "root-1",
        commentText: "Antwort",
      }),
    );
    expect(result).toMatchObject({ isOwn: true, parentCommentId: "root-1" });
  });

  it("allows replies to a uniquely resolved legacy item comment", async () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "SHARED",
      },
    });
    commentRepository.findOne.mockResolvedValue({
      id: "legacy-root",
      acpId: "acp-1",
      targetType: CommentTargetType.ITEM,
      targetId: "unit-1_item-1",
      unitId: null,
      itemId: null,
      legacyReadOnly: true,
      parentCommentId: null,
    });
    commentRepository.save.mockImplementation(async (value) => ({
      ...value,
      createdAt: date,
      updatedAt: date,
    }));

    await expect(
      service.createItemComment(
        "acp-1",
        {
          unitId: "unit-1",
          itemId: "item-1",
          parentCommentId: "legacy-root",
          commentText: "Antwort auf Altkommentar",
        },
        { userId: "me", authorLabel: "ME", isManager: false },
      ),
    ).resolves.toMatchObject({ parentCommentId: "legacy-root" });
    expect(commentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: CommentTargetType.ITEM,
        unitId: "unit-1",
        itemId: "item-1",
        parentCommentId: "legacy-root",
      }),
    );
  });

  it("rejects replies to a foreign comment after switching to private visibility", async () => {
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "PRIVATE",
      },
    });
    commentRepository.findOne.mockResolvedValue({
      id: "foreign-root",
      acpId: "acp-1",
      userId: "other",
      targetType: CommentTargetType.ITEM,
      targetId: "unit-1_item-1",
      unitId: "unit-1",
      itemId: "item-1",
      parentCommentId: null,
    });

    await expect(
      service.createItemComment(
        "acp-1",
        {
          unitId: "unit-1",
          itemId: "item-1",
          parentCommentId: "foreign-root",
          commentText: "Hidden reply",
        },
        { userId: "me", authorLabel: "ME", isManager: false },
      ),
    ).rejects.toThrow(NotFoundException);
    expect(commentRepository.save).not.toHaveBeenCalled();
  });

  it("builds private revisions only from the comments visible to the actor", async () => {
    const date = new Date("2026-01-01T10:00:00.000Z");
    const own = {
      id: "own",
      acpId: "acp-1",
      userId: "me",
      targetType: CommentTargetType.ITEM,
      targetId: "unit-1_item-1",
      unitId: "unit-1",
      itemId: "item-1",
      parentCommentId: null,
      commentText: "Own",
      createdAt: date,
      updatedAt: date,
      version: 1,
    } as any;
    const hidden = {
      ...own,
      id: "hidden",
      userId: "other",
      commentText: "Hidden",
    };
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "PRIVATE",
      },
    });
    commentRepository.find
      .mockResolvedValueOnce([own, hidden])
      .mockResolvedValueOnce([
        own,
        {
          ...hidden,
          version: 2,
          updatedAt: new Date("2026-01-01T10:00:00.001Z"),
        },
      ]);
    const actor = { userId: "me", authorLabel: "ME", isManager: false };

    const before = await service.getItemThread(
      "acp-1",
      "unit-1",
      "item-1",
      actor,
    );
    const after = await service.getItemThread(
      "acp-1",
      "unit-1",
      "item-1",
      actor,
    );

    expect(before.comments.map((comment) => comment.id)).toEqual(["own"]);
    expect(after.revision).toBe(before.revision);
  });

  it("does not assign ambiguous raw legacy target IDs to an item thread", async () => {
    unitParserService.getItemListFromFiles.mockResolvedValue({
      items: [{ unitId: "unit-1", itemId: "01" }],
    });
    commentRepository.find.mockResolvedValue([]);
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "SHARED",
      },
    });

    await service.getItemThread("acp-1", "unit-1", "01", {
      userId: "me",
      authorLabel: "ME",
      isManager: false,
    });

    const where = commentRepository.find.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ unitId: "unit-1", itemId: "01" }),
        expect.objectContaining({ targetId: "unit-1_01" }),
      ]),
    );
    expect(where).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ targetId: "01" })]),
    );
    expect(where).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: "unit-101" }),
      ]),
    );
  });

  it("normalizes raw and prefixed IDs to the same typed item target", async () => {
    commentRepository.find.mockResolvedValue([]);
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "SHARED",
      },
    });

    await service.getItemThread("acp-1", "unit-1", "item-1", {
      userId: "me",
      authorLabel: "ME",
      isManager: false,
    });
    const aliasedThread = await service.getItemThread(
      "acp-1",
      "unit-1",
      "unit-1_item-1",
      {
        userId: "me",
        authorLabel: "ME",
        isManager: false,
      },
    );
    expect(aliasedThread.target).toEqual({
      targetType: CommentTargetType.ITEM,
      unitId: "unit-1",
      itemId: "item-1",
    });

    for (const call of commentRepository.find.mock.calls) {
      expect(call[0].where[0]).toEqual(
        expect.objectContaining({ unitId: "unit-1", itemId: "item-1" }),
      );
    }
    // Each transaction keeps its own catalog promises; the pure file parser remains cached.
    expect(unitParserService.getItemListFromFiles).toHaveBeenCalledTimes(2);
  });

  it("prefers an exact item ID over another item's colliding legacy alias", async () => {
    unitParserService.getItemListFromFiles.mockResolvedValue({
      items: [
        { unitId: "U", itemId: "I" },
        { unitId: "U", itemId: "U_I" },
      ],
    });
    commentRepository.find.mockResolvedValue([]);
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "SHARED",
      },
    });
    const actor = { userId: "me", authorLabel: "ME", isManager: false };

    await service.getItemThread("acp-1", "U", "U_I", actor);
    await service.getItemThread("acp-1", "U", "I", actor);

    expect(commentRepository.find.mock.calls[0][0].where).toEqual([
      expect.objectContaining({ unitId: "U", itemId: "U_I" }),
      expect.objectContaining({ targetId: "U_U_I" }),
    ]);
    expect(commentRepository.find.mock.calls[1][0].where).toEqual([
      expect.objectContaining({ unitId: "U", itemId: "I" }),
    ]);
  });

  it("rebuilds the item catalog when the file signature changes", async () => {
    commentRepository.find.mockResolvedValue([]);
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "SHARED",
      },
    });
    fileCatalogCache.get
      .mockResolvedValueOnce({ signature: "files-v1" })
      .mockResolvedValueOnce({ signature: "files-v2" });
    const actor = { userId: "me", authorLabel: "ME", isManager: false };

    await service.getItemThread("acp-1", "unit-1", "item-1", actor);
    await service.getItemThread("acp-1", "unit-1", "item-1", actor);

    expect(unitParserService.getItemListFromFiles).toHaveBeenCalledTimes(2);
  });

  it("does not attach a colliding legacy target ID to either typed item", async () => {
    unitParserService.getItemListFromFiles.mockResolvedValue({
      items: [
        { unitId: "a_b", itemId: "c" },
        { unitId: "a", itemId: "b_c" },
      ],
    });
    commentRepository.find.mockResolvedValue([]);
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "SHARED",
      },
    });
    const actor = { userId: "me", authorLabel: "ME", isManager: false };

    await service.getItemThread("acp-1", "a_b", "c", actor);
    await service.getItemThread("acp-1", "a", "b_c", actor);

    expect(commentRepository.find.mock.calls[0][0].where).toEqual([
      expect.objectContaining({ unitId: "a_b", itemId: "c" }),
    ]);
    expect(commentRepository.find.mock.calls[1][0].where).toEqual([
      expect.objectContaining({ unitId: "a", itemId: "b_c" }),
    ]);
  });

  it("keeps canonical targets distinct even when only one has a parsed row", async () => {
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentVisibilityMode: "SHARED",
      },
    });
    unitParserService.getItemListFromFiles.mockResolvedValue({
      items: [{ unitId: "unit-1", itemId: "unit-1_item-1" }],
    });
    acpRepository.findOne.mockResolvedValue({
      acpIndex: {
        assessmentParts: [
          {
            units: [
              {
                id: "unit-1",
                items: [{ id: "item-1" }, { id: "unit-1_item-1" }],
              },
            ],
          },
        ],
      },
    });
    commentRepository.find.mockResolvedValue([
      {
        id: "c",
        targetType: CommentTargetType.ITEM,
        unitId: "unit-1",
        itemId: "item-1",
      },
    ]);
    const actor = { userId: "me", authorLabel: "ME", isManager: false };
    expect((await service.getItemCommentCounts("acp-1", actor)).counts).toEqual(
      [
        { unitId: "unit-1", itemId: "item-1", count: 1, codingCount: 0 },
        { unitId: "unit-1", itemId: "unit-1_item-1", count: 0, codingCount: 0 },
      ],
    );
    commentRepository.find.mockResolvedValue([]);
    const thread = await service.getItemThread(
      "acp-1",
      "unit-1",
      "unit-1_item-1",
      actor,
    );
    expect(thread.comments).toEqual([]);
    expect(thread.target).toEqual({
      targetType: CommentTargetType.ITEM,
      unitId: "unit-1",
      itemId: "unit-1_item-1",
    });
    expect(commentRepository.find.mock.calls[1][0].where[0]).toMatchObject({
      unitId: "unit-1",
      itemId: "unit-1_item-1",
    });
  });

  it("accepts an item from the canonical ACP index when no parsed file row exists", async () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "SHARED",
      },
    });
    unitParserService.getItemListFromFiles.mockResolvedValue({ items: [] });
    acpRepository.findOne.mockResolvedValue({
      acpIndex: {
        assessmentParts: [
          { units: [{ id: "unit-1", items: [{ id: "item-1" }] }] },
        ],
      },
    });
    commentRepository.save.mockImplementation(async (value) => ({
      ...value,
      createdAt: date,
      updatedAt: date,
    }));

    await expect(
      service.createItemComment(
        "acp-1",
        {
          unitId: "unit-1",
          itemId: "unit-1_item-1",
          commentText: "Index item",
        },
        { userId: "me", authorLabel: "ME", isManager: false },
      ),
    ).resolves.toMatchObject({
      commentText: "Index item",
      unitId: "unit-1",
      itemId: "item-1",
    });
  });

  it("keeps a deleted root as a neutral tombstone when its reply is visible", async () => {
    const createdAt = new Date("2026-01-01T10:00:00.000Z");
    const root = {
      id: "root",
      acpId: "acp-1",
      userId: "other",
      targetType: CommentTargetType.ITEM,
      targetId: "unit-1_item-1",
      unitId: "unit-1",
      itemId: "item-1",
      parentCommentId: null,
      commentText: "",
      authorLabel: "Other",
      createdAt,
      updatedAt: createdAt,
      deletedAt: new Date("2026-01-01T11:00:00.000Z"),
      version: 2,
    } as any;
    const reply = {
      ...root,
      id: "reply",
      userId: "me",
      parentCommentId: "root",
      commentText: "Still visible",
      authorLabel: "ME",
      deletedAt: null,
      createdAt: new Date("2026-01-01T10:30:00.000Z"),
      updatedAt: new Date("2026-01-01T10:30:00.000Z"),
      version: 1,
    };
    commentRepository.find.mockResolvedValue([root, reply]);
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "PRIVATE",
      },
    });

    const snapshot = await service.getItemThread("acp-1", "unit-1", "item-1", {
      userId: "me",
      authorLabel: "ME",
      isManager: false,
    });

    expect(snapshot.comments).toEqual([
      expect.objectContaining({
        id: "root",
        commentText: "",
        authorLabel: "Gelöscht",
        isDeleted: true,
        isOwn: false,
      }),
      expect.objectContaining({
        id: "reply",
        parentCommentId: "root",
        parentVisible: true,
        isDeleted: false,
      }),
    ]);
  });

  it("prevents foreign edits and reports stale own edits as conflicts", async () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: ["ITEM"],
      },
    });
    commentRepository.findOne.mockResolvedValue({
      id: "c-1",
      acpId: "acp-1",
      userId: "other",
      targetType: CommentTargetType.ITEM,
      targetId: "unit-1_item-1",
      unitId: "unit-1",
      itemId: "item-1",
      commentText: "Text",
      authorLabel: "OT",
      createdAt: date,
      updatedAt: date,
      version: 2,
    });

    await expect(
      service.updateOwnComment("acp-1", "c-1", "Neu", 2, {
        userId: "me",
        authorLabel: "ME",
        isManager: true,
      }),
    ).rejects.toThrow(ForbiddenException);

    commentRepository.findOne.mockResolvedValue({
      id: "c-1",
      acpId: "acp-1",
      userId: "me",
      targetType: CommentTargetType.ITEM,
      targetId: "unit-1_item-1",
      commentText: "Text",
      authorLabel: "ME",
      createdAt: date,
      updatedAt: date,
      version: 2,
    });
    await expect(
      service.updateOwnComment("acp-1", "c-1", "Neu", 1, {
        userId: "me",
        authorLabel: "ME",
        isManager: false,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("checks target configuration before mutating another comment target", async () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: ["ITEM"],
      },
    });
    commentRepository.findOne.mockResolvedValue({
      id: "unit-comment",
      acpId: "acp-1",
      userId: "me",
      targetType: CommentTargetType.UNIT,
      targetId: "unit-1",
      commentText: "Text",
      createdAt: date,
      updatedAt: date,
      version: 1,
    });

    await expect(
      service.updateOwnComment("acp-1", "unit-comment", "Neu", 1, {
        userId: "me",
        authorLabel: "ME",
        isManager: false,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(commentRepository.update).not.toHaveBeenCalled();
  });

  it("updates and soft-deletes own comments with the expected version", async () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    const ownComment = {
      id: "c-1",
      acpId: "acp-1",
      userId: "me",
      targetType: CommentTargetType.ITEM,
      targetId: "unit-1_item-1",
      unitId: "unit-1",
      itemId: "item-1",
      commentText: "Text",
      authorLabel: "ME",
      createdAt: date,
      updatedAt: date,
      version: 1,
    } as any;
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: ["ITEM"],
      },
    });
    commentRepository.findOne.mockResolvedValue(ownComment);
    commentRepository.update.mockResolvedValue({ affected: 1 });
    const actor = { userId: "me", authorLabel: "ME", isManager: false };

    await expect(
      service.updateOwnComment("acp-1", "c-1", " Neu ", 1, actor),
    ).resolves.toMatchObject({ commentText: "Neu", version: 2 });
    await expect(
      service.deleteOwnComment("acp-1", "c-1", 1, actor),
    ).resolves.toBeUndefined();
    expect(commentRepository.update).toHaveBeenCalledTimes(2);
    expect(commentRepository.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "c-1", acpId: "acp-1", version: 1 }),
      expect.objectContaining({ commentText: "", version: 2 }),
    );
  });

  it("updates and deletes by stable credential ownership", async () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    const ownComment = {
      id: "credential-comment",
      acpId: "acp-1",
      credentialId: "credential-1",
      credentialUsername: "reviewer",
      targetType: CommentTargetType.ITEM,
      targetId: "unit-1_item-1",
      unitId: "unit-1",
      itemId: "item-1",
      commentText: "Text",
      authorLabel: "RE",
      createdAt: date,
      updatedAt: date,
      version: 1,
    } as any;
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: ["ITEM"],
      },
    });
    commentRepository.findOne.mockResolvedValue(ownComment);
    commentRepository.update.mockResolvedValue({ affected: 1 });
    const actor = {
      credentialId: "credential-1",
      credentialUsername: "reviewer",
      authorLabel: "RE",
      isManager: false,
    };

    await expect(
      service.updateOwnComment("acp-1", "credential-comment", "Neu", 1, actor),
    ).resolves.toMatchObject({ commentText: "Neu", version: 2, isOwn: true });
    await expect(
      service.deleteOwnComment("acp-1", "credential-comment", 1, actor),
    ).resolves.toBeUndefined();
    expect(commentRepository.update).toHaveBeenCalledTimes(2);
  });

  it("revalidates a stored target before updating it", async () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: ["UNIT"],
      },
    });
    reviewManifestService.getManifest.mockResolvedValue({
      booklets: [],
      units: [],
      issues: [],
    });
    commentRepository.findOne.mockResolvedValue({
      id: "removed-unit-comment",
      acpId: "acp-1",
      userId: "me",
      targetType: CommentTargetType.UNIT,
      targetId: "removed-unit",
      unitId: "removed-unit",
      commentText: "Text",
      createdAt: date,
      updatedAt: date,
      version: 1,
    });

    await expect(
      service.updateOwnComment("acp-1", "removed-unit-comment", "Neu", 1, {
        userId: "me",
        authorLabel: "ME",
        isManager: false,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(commentRepository.update).not.toHaveBeenCalled();
  });

  it("creates coding comments on the whole item coding context", async () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: ["CODING"],
      },
    });
    unitParserService.getItemListFromFiles.mockResolvedValue({
      items: [{ unitId: "unit-1", itemId: "item-1" }],
      codingSchemes: { "unit-1": { variableCodings: [] } },
    });
    commentRepository.create.mockImplementationOnce((value) => ({
      id: "coding-1",
      createdAt: date,
      updatedAt: date,
      legacyReadOnly: false,
      ...value,
    }));

    await expect(
      service.createReviewComment(
        "acp-1",
        {
          targetType: CommentTargetType.CODING,
          unitId: "unit-1",
          itemId: "item-1",
          commentText: "Kodierschema prüfen",
        },
        { userId: "me", authorLabel: "ME", isManager: false },
      ),
    ).resolves.toMatchObject({
      targetType: CommentTargetType.CODING,
      unitId: "unit-1",
      itemId: "item-1",
      commentText: "Kodierschema prüfen",
    });
    expect(commentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: CommentTargetType.CODING,
        targetId: "unit-1_item-1",
        unitId: "unit-1",
        itemId: "item-1",
      }),
    );
  });

  it("keeps item and coding counts separate", async () => {
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: ["ITEM", "CODING"],
      },
    });
    commentRepository.find.mockResolvedValue([
      {
        targetType: CommentTargetType.ITEM,
        unitId: "unit-1",
        itemId: "item-1",
        userId: "me",
      },
      {
        targetType: CommentTargetType.CODING,
        unitId: "unit-1",
        itemId: "item-1",
        userId: "me",
      },
    ]);

    const snapshot = await service.getItemCommentCounts("acp-1", {
      userId: "me",
      authorLabel: "ME",
      isManager: false,
    });
    expect(snapshot.counts).toContainEqual({
      unitId: "unit-1",
      itemId: "item-1",
      count: 1,
      codingCount: 1,
    });
  });

  it("accepts canonical booklets and rejects legacy-only booklet identities", async () => {
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: ["BOOKLET"],
      },
    });
    reviewManifestService.getManifest.mockResolvedValue({
      booklets: [
        { id: "booklet-1", name: "Booklet 1", legacy: false },
        { id: "module-1", name: "Legacy", legacy: true },
      ],
      units: [],
      issues: [],
    });
    commentRepository.find.mockResolvedValue([]);
    const actor = { userId: "me", authorLabel: "ME", isManager: false };

    await expect(
      service.getReviewThread(
        "acp-1",
        { targetType: CommentTargetType.BOOKLET, bookletId: "booklet-1" },
        actor,
      ),
    ).resolves.toMatchObject({
      target: {
        targetType: CommentTargetType.BOOKLET,
        bookletId: "booklet-1",
      },
    });
    await expect(
      service.getReviewThread(
        "acp-1",
        { targetType: CommentTargetType.BOOKLET, bookletId: "module-1" },
        actor,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it("keeps unresolved legacy comments read-only", async () => {
    commentRepository.findOne.mockResolvedValue({
      id: "legacy-1",
      acpId: "acp-1",
      userId: "me",
      targetType: CommentTargetType.TASK_SEQUENCE,
      targetId: "ambiguous-module",
      legacyReadOnly: true,
      version: 1,
    });
    await expect(
      service.updateOwnComment("acp-1", "legacy-1", "Neu", 1, {
        userId: "me",
        authorLabel: "ME",
        isManager: false,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(commentRepository.update).not.toHaveBeenCalled();
  });
});
