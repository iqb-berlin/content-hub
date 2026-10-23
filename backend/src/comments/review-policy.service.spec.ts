import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { CommentTargetType } from "../database/entities";
import { ReviewPolicyService } from "./review-policy.service";

describe("ReviewPolicyService", () => {
  let accessConfigRepository: { findOne: jest.Mock };
  let policy: ReviewPolicyService;

  beforeEach(() => {
    accessConfigRepository = { findOne: jest.fn() };
    policy = new ReviewPolicyService(accessConfigRepository as any);
  });

  it("resolves stable identities and current manager rights", () => {
    expect(
      policy.resolveActor({
        user: { type: "oidc", sub: "user-1", username: "AB" },
        acpAccessLevel: "READ_ONLY",
        acpCapabilities: ["review:participate"],
      }),
    ).toEqual({
      userId: "user-1",
      credentialId: undefined,
      credentialUsername: undefined,
      authorLabel: "AB",
      isManager: false,
      canParticipate: true,
    });
    expect(
      policy.resolveActor({
        user: {
          type: "credential",
          sub: "credential-1",
          username: "reader",
        },
        acpAccessLevel: "CREDENTIAL",
      }),
    ).toEqual(
      expect.objectContaining({
        credentialId: "credential-1",
        credentialUsername: "reader",
        userId: undefined,
      }),
    );
    expect(
      policy.isManagerRequest({
        user: { isAppAdmin: false },
        acpAccessLevel: "ADMIN",
        acpCapabilities: ["review:manage"],
      }),
    ).toBe(true);
  });

  it.each([
    [
      { displayName: "Person Name", username: "person@example.org" },
      "Person Name",
    ],
    [{ displayName: "person@example.org", username: "person" }, "person"],
    [{ displayName: "  ", username: "person" }, "person"],
    [{ username: "person@example.org" }, "Unbekannt"],
    [
      {
        type: "credential",
        displayName: "Not the credential",
        username: "Kuerzel",
      },
      "Kuerzel",
    ],
  ])("uses a name instead of email for actor %j", (user, expected) => {
    expect(policy.resolveActor({ user }).authorLabel).toBe(expected);
  });

  it("keeps review participation behind its own request policy", () => {
    expect(() =>
      policy.assertCanParticipateRequest({
        user: { sub: "user-1" },
        acpAccessLevel: "READ_ONLY",
        acpCapabilities: ["review:participate"],
      }),
    ).not.toThrow();
    expect(() =>
      policy.assertCanParticipateRequest({
        user: { sub: "user-1" },
        acpAccessLevel: "PUBLIC",
        acpCapabilities: ["review:participate"],
      }),
    ).not.toThrow();
    expect(() =>
      policy.assertCanParticipateRequest({
        user: { sub: "user-1" },
        acpAccessLevel: "UNRELATED",
      }),
    ).toThrow(ForbiddenException);
    expect(() =>
      policy.assertCanParticipateRequest({ acpAccessLevel: "PUBLIC" }),
    ).toThrow(ForbiddenException);
  });

  it("rejects anonymous and disabled item review access", async () => {
    await expect(
      policy.assertItemCommentAccess("acp-1", {
        authorLabel: "?",
        isManager: false,
      }),
    ).rejects.toThrow(ForbiddenException);

    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: { enableReview: true, enableCommenting: false },
    });
    await expect(
      policy.assertItemCommentAccess("acp-1", {
        userId: "user-1",
        authorLabel: "AB",
        isManager: false,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each([false, undefined])(
    "retains legacy comments with enableReview=%s",
    async (enableReview) => {
      accessConfigRepository.findOne.mockResolvedValue({
        featureConfig: {
          enableReview,
          enableCommenting: true,
          commentTargets: ["ITEM", "UNIT"],
          commentVisibilityMode: "PRIVATE",
        },
      });
      for (const identity of [
        { userId: "user-1" },
        { credentialId: "credential-1" },
      ]) {
        const actor = {
          ...identity,
          authorLabel: "Existing participant",
          isManager: false,
        };
        for (const target of [CommentTargetType.ITEM, CommentTargetType.UNIT]) {
          await expect(
            policy.assertCommentAccess("acp-1", actor, target),
          ).resolves.toBe("PRIVATE");
        }
        await expect(policy.prepareVisibility("acp-1", actor)).resolves.toBe(
          "PRIVATE",
        );
        await expect(
          policy.assertItemAndCodingCountAccess("acp-1", actor),
        ).resolves.toMatchObject({ targetTypes: [CommentTargetType.ITEM] });
        expect(
          policy.canViewComment("PRIVATE", actor, { userId: "other" } as any),
        ).toBe(false);
      }
    },
  );

  it("uses stable IDs exclusively for ownership", () => {
    const comment = {
      userId: null,
      credentialId: "credential-old",
      credentialUsername: "same-name",
    } as any;
    expect(
      policy.isOwnedBy(comment, {
        credentialId: "credential-new",
        credentialUsername: "same-name",
        authorLabel: "SN",
        isManager: false,
      }),
    ).toBe(false);
    expect(
      policy.isOwnedBy(
        { credentialId: null, credentialUsername: "same-name" } as any,
        {
          credentialId: "credential-new",
          credentialUsername: "same-name",
          authorLabel: "SN",
          isManager: false,
        },
      ),
    ).toBe(false);
  });

  it("encapsulates visibility, reply and mutation decisions", () => {
    const foreignComment = { userId: "other" } as any;
    const actor = {
      userId: "me",
      authorLabel: "ME",
      isManager: false,
    };
    expect(policy.canViewComment("PRIVATE", actor, foreignComment)).toBe(false);
    expect(policy.canViewComment("SHARED", actor, foreignComment)).toBe(true);
    expect(() =>
      policy.assertCanReply("PRIVATE", actor, foreignComment),
    ).toThrow(NotFoundException);
    expect(() => policy.assertCanMutate(actor, foreignComment)).toThrow(
      ForbiddenException,
    );
    expect(() =>
      policy.assertCanMutate(actor, { userId: "me" } as any),
    ).not.toThrow();
  });

  it("keeps target feature checks behind the policy boundary", async () => {
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.ITEM],
        commentVisibilityMode: "SHARED",
      },
    });
    await expect(
      policy.assertItemCommentAccess("acp-1", {
        userId: "user-1",
        authorLabel: "AB",
        isManager: false,
      }),
    ).resolves.toBe("SHARED");
    await expect(
      policy.isCommentingEnabled("acp-1", CommentTargetType.UNIT),
    ).resolves.toBe(false);
  });

  it("requires explicit opt-in for new booklet and coding targets", async () => {
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [],
      },
    });
    await expect(
      policy.isCommentingEnabled("acp-1", CommentTargetType.ITEM),
    ).resolves.toBe(true);
    await expect(
      policy.isCommentingEnabled("acp-1", CommentTargetType.CODING),
    ).resolves.toBe(false);
    await expect(
      policy.isCommentingEnabled("acp-1", CommentTargetType.BOOKLET),
    ).resolves.toBe(false);

    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        enableReview: true,
        enableCommenting: true,
        commentTargets: [CommentTargetType.BOOKLET, CommentTargetType.CODING],
      },
    });
    await expect(
      policy.assertCommentAccess(
        "acp-1",
        { credentialId: "credential-1", authorLabel: "CR", isManager: false },
        CommentTargetType.CODING,
      ),
    ).resolves.toBe("PRIVATE");
  });
});
