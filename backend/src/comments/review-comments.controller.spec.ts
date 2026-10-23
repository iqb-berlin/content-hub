import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ReviewCommentsController } from "./review-comments.controller";

describe("ReviewCommentsController", () => {
  let controller: ReviewCommentsController;
  let commentsService: any;
  let reviewPolicy: any;

  beforeEach(() => {
    commentsService = {
      getItemThread: jest.fn().mockResolvedValue({ comments: [] }),
      getReviewThread: jest.fn().mockResolvedValue({ comments: [] }),
      createItemComment: jest.fn().mockResolvedValue({ id: "c-1" }),
      createReviewComment: jest.fn().mockResolvedValue({ id: "c-2" }),
      updateOwnComment: jest.fn().mockResolvedValue({ id: "c-1", version: 2 }),
      deleteOwnComment: jest.fn().mockResolvedValue(undefined),
      getItemCommentCounts: jest.fn().mockResolvedValue({ counts: [] }),
      exportReviewCommentsCsv: jest.fn().mockResolvedValue(Buffer.from("csv")),
      exportReviewCommentsXlsx: jest
        .fn()
        .mockResolvedValue(Buffer.from("xlsx")),
    };
    reviewPolicy = {
      assertCanParticipateRequest: jest.fn(),
      resolveActor: jest.fn((req) => {
        const credential = req.user?.type === "credential";
        return {
          userId: credential ? undefined : req.user?.sub,
          credentialId: credential ? req.user?.sub : undefined,
          credentialUsername: credential ? req.user?.username : undefined,
          authorLabel: req.user?.username || "Unbekannt",
          isManager: Boolean(
            req.user?.isAppAdmin ||
            req.acpAccessLevel === "MANAGER" ||
            req.acpAccessLevel === "ADMIN",
          ),
        };
      }),
      isManagerRequest: jest.fn(
        (req) => req.acpAccessLevel === "MANAGER" || req.user?.isAppAdmin,
      ),
    };
    controller = new ReviewCommentsController(commentsService, reviewPolicy);
  });

  it("resolves stable OIDC and credential actors for item thread operations", async () => {
    await controller.getItemThread("acp-1", " unit-1 ", " item-1 ", {
      user: { type: "oidc", sub: "user-1", username: "kuerzel" },
      acpAccessLevel: "READ_ONLY",
    });
    expect(commentsService.getItemThread).toHaveBeenCalledWith(
      "acp-1",
      "unit-1",
      "item-1",
      {
        userId: "user-1",
        credentialId: undefined,
        credentialUsername: undefined,
        authorLabel: "kuerzel",
        isManager: false,
      },
    );

    await controller.createItemComment(
      "acp-1",
      {
        unitId: "unit-1",
        itemId: "item-1",
        commentText: "Antwort",
        parentCommentId: "00000000-0000-4000-8000-000000000001",
      },
      {
        user: {
          type: "credential",
          sub: "credential-1",
          username: "reader",
        },
        acpAccessLevel: "CREDENTIAL",
      },
    );
    expect(commentsService.createItemComment).toHaveBeenCalledWith(
      "acp-1",
      expect.objectContaining({
        unitId: "unit-1",
        itemId: "item-1",
        commentText: "Antwort",
      }),
      expect.objectContaining({
        credentialId: "credential-1",
        credentialUsername: "reader",
        authorLabel: "reader",
      }),
    );
  });

  it("delegates versioned update and delete operations", async () => {
    const req = {
      user: { type: "oidc", sub: "user-1", username: "u1" },
      acpAccessLevel: "MANAGER",
    };
    await controller.updateComment(
      "acp-1",
      "00000000-0000-4000-8000-000000000001",
      { commentText: "Neu", version: 2 },
      req,
    );
    expect(commentsService.updateOwnComment).toHaveBeenCalledWith(
      "acp-1",
      "00000000-0000-4000-8000-000000000001",
      "Neu",
      2,
      expect.objectContaining({ userId: "user-1", isManager: true }),
      undefined,
    );

    await expect(
      controller.deleteComment(
        "acp-1",
        "00000000-0000-4000-8000-000000000001",
        "invalid",
        req,
      ),
    ).rejects.toThrow(BadRequestException);
    await controller.deleteComment(
      "acp-1",
      "00000000-0000-4000-8000-000000000001",
      "2",
      req,
    );
    expect(commentsService.deleteOwnComment).toHaveBeenCalledWith(
      "acp-1",
      "00000000-0000-4000-8000-000000000001",
      2,
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("normalizes booklet and coding targets for the shared lifecycle", async () => {
    const req = {
      user: { type: "oidc", sub: "user-1", username: "u1" },
      acpAccessLevel: "READ_ONLY",
    };
    await controller.getItemThread(
      "acp-1",
      " unit-1 ",
      " item-1 ",
      req,
      "CODING",
    );
    expect(commentsService.getReviewThread).toHaveBeenCalledWith(
      "acp-1",
      {
        targetType: "CODING",
        unitId: "unit-1",
        itemId: "item-1",
      },
      expect.objectContaining({ userId: "user-1" }),
    );

    await controller.createItemComment(
      "acp-1",
      {
        targetType: "BOOKLET" as any,
        bookletId: " booklet-1 ",
        commentText: "Booklet prüfen",
      },
      req,
    );
    expect(commentsService.createReviewComment).toHaveBeenCalledWith(
      "acp-1",
      expect.objectContaining({
        targetType: "BOOKLET",
        bookletId: "booklet-1",
        commentText: "Booklet prüfen",
      }),
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("rejects missing item targets before service access", async () => {
    await expect(
      controller.getItemThread("acp-1", "", "item-1", {
        user: { type: "oidc", sub: "user-1", username: "u1" },
      }),
    ).rejects.toThrow(BadRequestException);
    expect(commentsService.getItemThread).not.toHaveBeenCalled();
  });

  it("keeps manager personal exports separate from the protected all export", async () => {
    const managerRequest = {
      user: { type: "oidc", sub: "manager-1", username: "manager" },
      acpAccessLevel: "MANAGER",
    };
    const response = () => ({
      setHeader: jest.fn(),
      send: jest.fn(),
    });

    await controller.exportMineXlsx("acp-1", managerRequest, response() as any);
    expect(commentsService.exportReviewCommentsXlsx).toHaveBeenCalledWith(
      "acp-1",
      expect.objectContaining({
        userId: "manager-1",
        credentialId: undefined,
        isManager: true,
      }),
    );

    await controller.exportAllXlsx("acp-1", managerRequest, response() as any);
    expect(commentsService.exportReviewCommentsXlsx).toHaveBeenLastCalledWith(
      "acp-1",
      undefined,
    );

    await expect(
      controller.exportAllXlsx(
        "acp-1",
        { ...managerRequest, acpAccessLevel: "READ_ONLY" },
        response() as any,
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
