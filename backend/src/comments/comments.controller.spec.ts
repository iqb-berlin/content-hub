import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { CommentsController } from "./comments.controller";
import { CommentTargetType } from "../database/entities";

describe("CommentsController", () => {
  let controller: CommentsController;
  let commentsService: any;
  let reviewPolicy: any;

  beforeEach(() => {
    commentsService = {
      findByAp: jest.fn().mockResolvedValue([{ id: "c-1" }]),
      findByCredential: jest.fn().mockResolvedValue([{ id: "c-cred" }]),
      findByUser: jest.fn().mockResolvedValue([{ id: "c-user" }]),
      createLegacyCompatibleComment: jest
        .fn()
        .mockResolvedValue({ id: "c-new" }),
      deleteUnreferencedLegacyByAp: jest
        .fn()
        .mockResolvedValue({ deletedCount: 3, retainedCount: 5 }),
      exportComments: jest.fn().mockResolvedValue([{ id: "c-export" }]),
      exportCommentsByCredential: jest
        .fn()
        .mockResolvedValue([{ id: "c-export-cred" }]),
      exportCommentsXlsx: jest.fn().mockResolvedValue(Buffer.from("xlsx-all")),
      exportCommentsXlsxByCredential: jest
        .fn()
        .mockResolvedValue(Buffer.from("xlsx-cred")),
    };

    reviewPolicy = {
      assertCanParticipateRequest: jest.fn(),
      resolveActor: jest.fn((req) => ({
        userId: req.user?.type === "oidc" ? req.user.sub : undefined,
        credentialId:
          req.user?.type === "credential" ? req.user.sub : undefined,
        credentialUsername:
          req.user?.type === "credential" ? req.user.username : undefined,
        authorLabel: req.user?.username || "Unbekannt",
        isManager: Boolean(req.user?.isAppAdmin),
      })),
      isManagerRequest: jest.fn(
        (req) =>
          Boolean(req.user?.isAppAdmin) ||
          req.apAccessLevel === "MANAGER" ||
          req.apAccessLevel === "ADMIN",
      ),
    };
    controller = new CommentsController(commentsService, reviewPolicy);
  });

  it("returns all comments for managers", async () => {
    const req = { user: { isAppAdmin: false }, apAccessLevel: "MANAGER" };
    const result = await controller.findAll("ap-1", req);

    expect(result).toEqual([{ id: "c-1" }]);
    expect(commentsService.findByAp).toHaveBeenCalledWith("ap-1");
  });

  it("rejects all-comments access for non-managers", async () => {
    const req = { user: { isAppAdmin: false }, apAccessLevel: "PUBLIC" };

    await expect(controller.findAll("ap-1", req)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("returns mine for credential users", async () => {
    const req = {
      user: {
        type: "credential",
        sub: "credential-1",
        username: "cred-user",
      },
    };
    const result = await controller.findMine("ap-1", req);

    expect(result).toEqual([{ id: "c-cred" }]);
    expect(commentsService.findByCredential).toHaveBeenCalledWith(
      "ap-1",
      "credential-1",
      expect.objectContaining({ credentialId: "credential-1" }),
    );
    expect(commentsService.findByUser).not.toHaveBeenCalled();
  });

  it("returns mine for OIDC users", async () => {
    const req = { user: { type: "oidc", sub: "u-1" } };
    const result = await controller.findMine("ap-1", req);

    expect(result).toEqual([{ id: "c-user" }]);
    expect(commentsService.findByUser).toHaveBeenCalledWith(
      "ap-1",
      "u-1",
      expect.objectContaining({ userId: "u-1" }),
    );
  });

  it("creates comment directly for managers", async () => {
    const req = {
      user: { type: "oidc", sub: "u-1", isAppAdmin: true },
      apAccessLevel: "PUBLIC",
    };
    const dto = {
      targetType: CommentTargetType.ITEM,
      targetId: "item-1",
      commentText: "Hallo",
    };

    const result = await controller.create("ap-1", dto as any, req);

    expect(result).toEqual({ id: "c-new" });
    expect(commentsService.createLegacyCompatibleComment).toHaveBeenCalledWith(
      "ap-1",
      {
        targetType: CommentTargetType.ITEM,
        targetId: "item-1",
        commentText: "Hallo",
      },
      expect.objectContaining({ userId: "u-1" }),
    );
  });

  it.each([
    [
      "AP manager",
      {
        user: { type: "oidc", sub: "manager-1", isAppAdmin: false },
        apAccessLevel: "MANAGER",
      },
    ],
    [
      "app admin",
      {
        user: { type: "oidc", sub: "admin-1", isAppAdmin: true },
        apAccessLevel: "PUBLIC",
      },
    ],
  ])(
    "rejects the AP ID as a legacy comment target for %s",
    async (_label, req) => {
      const dto = {
        targetType: CommentTargetType.UNIT,
        targetId: "ap-1",
        commentText: "Invalid AP-level comment",
      };

      await expect(controller.create("ap-1", dto, req)).rejects.toThrow(
        BadRequestException,
      );
      expect(reviewPolicy.isManagerRequest).not.toHaveBeenCalled();
      expect(
        commentsService.createLegacyCompatibleComment,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    [CommentTargetType.UNIT, "unit-1"],
    [CommentTargetType.ITEM, "item-1"],
    [CommentTargetType.BOOKLET, "booklet-1"],
  ])("keeps valid %s targets available", async (targetType, targetId) => {
    const req = {
      user: { type: "oidc", sub: "manager-1", isAppAdmin: false },
      apAccessLevel: "MANAGER",
    };

    await expect(
      controller.create(
        "ap-1",
        { targetType, targetId, commentText: "Valid content comment" },
        req,
      ),
    ).resolves.toEqual({ id: "c-new" });
    expect(commentsService.createLegacyCompatibleComment).toHaveBeenCalledWith(
      "ap-1",
      expect.objectContaining({
        targetType,
        targetId,
      }),
      expect.any(Object),
    );
  });

  it("requires review participation for legacy-compatible create", async () => {
    reviewPolicy.assertCanParticipateRequest.mockImplementationOnce(() => {
      throw new ForbiddenException("Review-Teilnahme ist nicht erlaubt");
    });
    const req = {
      user: { type: "credential", sub: "cred-id", username: "cred" },
      apAccessLevel: "PUBLIC",
    };
    const dto = {
      targetType: CommentTargetType.UNIT,
      targetId: "unit-1",
      commentText: "x",
    };

    await expect(controller.create("ap-1", dto as any, req)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("creates comment for credential users when commenting is enabled", async () => {
    const req = {
      user: { type: "credential", sub: "cred-id", username: "cred" },
      apAccessLevel: "PUBLIC",
    };
    const dto = {
      targetType: CommentTargetType.ITEM,
      targetId: "item-1",
      commentText: "ok",
    };

    await controller.create("ap-1", dto as any, req);

    expect(commentsService.createLegacyCompatibleComment).toHaveBeenCalledWith(
      "ap-1",
      {
        targetType: CommentTargetType.ITEM,
        targetId: "item-1",
        commentText: "ok",
      },
      expect.objectContaining({ credentialId: "cred-id" }),
    );
  });

  it("deletes only safe legacy comments for managers", async () => {
    const req = { user: { isAppAdmin: true }, apAccessLevel: "PUBLIC" };
    const result = await controller.deleteLegacyComments("ap-1", req);

    expect(result).toEqual({
      message: "3 legacy comments deleted; 5 comments retained",
      deletedCount: 3,
      retainedCount: 5,
      scope: "UNRESOLVED_LEGACY_TASK_SEQUENCE",
    });
    expect(commentsService.deleteUnreferencedLegacyByAp).toHaveBeenCalledWith(
      "ap-1",
    );
  });

  it("rejects legacy bulk deletion for non-managers", async () => {
    const req = { user: { isAppAdmin: false }, apAccessLevel: "PUBLIC" };

    await expect(controller.deleteLegacyComments("ap-1", req)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("exports comments for manager users", async () => {
    const req = {
      user: { isAppAdmin: false, type: "oidc", sub: "u-1" },
      apAccessLevel: "MANAGER",
    };
    const result = await controller.exportComments("ap-1", req);

    expect(result).toEqual([{ id: "c-export" }]);
    expect(commentsService.exportComments).toHaveBeenCalledWith("ap-1");
  });

  it("exports comments for credential users with credential filter", async () => {
    const req = {
      user: {
        isAppAdmin: false,
        type: "credential",
        sub: "credential-1",
        username: "cred-user",
      },
      apAccessLevel: "PUBLIC",
    };

    const result = await controller.exportComments("ap-1", req);

    expect(result).toEqual([{ id: "c-export-cred" }]);
    expect(commentsService.exportCommentsByCredential).toHaveBeenCalledWith(
      "ap-1",
      "credential-1",
    );
  });

  it("exports comments for OIDC users with user filter", async () => {
    const req = {
      user: { isAppAdmin: false, type: "oidc", sub: "u-42" },
      apAccessLevel: "PUBLIC",
    };

    await controller.exportComments("ap-1", req);

    expect(commentsService.exportComments).toHaveBeenCalledWith("ap-1", "u-42");
  });

  it("exports XLSX for manager users", async () => {
    const req = { user: { isAppAdmin: true }, apAccessLevel: "PUBLIC" };
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.exportCommentsXlsx("ap-1", req, res);

    expect(commentsService.exportCommentsXlsx).toHaveBeenCalledWith("ap-1");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="comments-ap-1-all.xlsx"',
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from("xlsx-all"));
  });

  it("exports XLSX for credential users with username fallback", async () => {
    const req = {
      user: {
        isAppAdmin: false,
        type: "credential",
        sub: "credential-1",
        username: "",
      },
      apAccessLevel: "PUBLIC",
    };
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.exportCommentsXlsx("ap-1", req, res);

    expect(commentsService.exportCommentsXlsxByCredential).toHaveBeenCalledWith(
      "ap-1",
      "credential-1",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="comments-ap-1-mine.xlsx"',
    );
  });

  it("exports XLSX for OIDC users with username fallback", async () => {
    const req = {
      user: { isAppAdmin: false, type: "oidc", sub: "u-2", username: "" },
      apAccessLevel: "PUBLIC",
    };
    const res = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.exportCommentsXlsx("ap-1", req, res);

    expect(commentsService.exportCommentsXlsx).toHaveBeenCalledWith(
      "ap-1",
      "u-2",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="comments-ap-1-mine.xlsx"',
    );
  });
});
