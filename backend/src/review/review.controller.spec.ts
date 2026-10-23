import { BadRequestException } from "@nestjs/common";
import {
  AcpAccessConfig,
  AcpCredential,
  AcpUserRole,
} from "../database/entities";
import { ReviewController } from "./review.controller";

describe("ReviewController stale memberships", () => {
  it.each(["user", "credential"] as const)(
    "removes a deleted %s while saving config and preserves live members and groups",
    async (kind) => {
      const config = {
        id: "config",
        acpId: "acp",
        reviewConfigVersion: 1,
        reviewRevision: "0",
        featureConfig: { enableReview: true, commentVisibilityMode: "GROUP" },
        reviewGroups: [
          {
            id: "group",
            name: "Group",
            archived: false,
            members: [
              { kind, id: "deleted" },
              { kind, id: "live" },
            ],
          },
        ],
      };
      const manager = {
        findOne: jest.fn(async (entity, options) => {
          if (entity === AcpAccessConfig) return config;
          expect(entity).toBe(kind === "user" ? AcpUserRole : AcpCredential);
          return (options.where.userId || options.where.id) === "live"
            ? {}
            : null;
        }),
        find: jest.fn(async () => []),
        save: jest.fn(async (value) => value),
        transaction: async (fn: any): Promise<any> => fn(manager),
      };
      const controller = new ReviewController(
        { assert: jest.fn() } as any,
        {} as any,
        { manager, findOne: async () => config } as any,
        { check: jest.fn() } as any,
      );
      const result = await controller.configure(
        "acp",
        {
          enableReview: false,
          visibilityMode: "GROUP",
          configVersion: 1,
          groups: config.reviewGroups.map((group) => ({
            ...group,
            name: "Renamed",
            archived: true,
          })),
        },
        {},
      );
      expect(result).toEqual({
        enableReview: false,
        hideReviewDeveloperNames: false,
        visibilityMode: "GROUP",
        configVersion: 2,
        groups: [
          {
            id: "group",
            name: "Renamed",
            archived: true,
            members: [{ kind, id: "live" }],
          },
        ],
      });
      expect(config.reviewRevision).toBe("1");
      expect(manager.save).toHaveBeenCalledWith(config);
    },
  );

  it.each(["user", "credential"] as const)(
    "rejects newly assigned invalid %s identities even if another group contains them",
    async (kind) => {
      const config = {
        id: "config",
        reviewConfigVersion: 1,
        featureConfig: { commentVisibilityMode: "GROUP" },
        reviewGroups: [
          {
            id: "old-group",
            name: "Old",
            archived: false,
            members: [{ kind, id: "deleted" }],
          },
          { id: "new-group", name: "New", archived: false, members: [] },
        ],
      };
      const manager = {
        findOne: jest.fn(async (entity) =>
          entity === AcpAccessConfig ? config : null,
        ),
        save: jest.fn(),
        transaction: async (fn: any): Promise<any> => fn(manager),
      };
      const controller = new ReviewController(
        { assert: jest.fn() } as any,
        {} as any,
        { manager, findOne: async () => config } as any,
        { check: jest.fn().mockResolvedValue({ status: "READY" }) } as any,
      );
      await expect(
        controller.configure(
          "acp",
          {
            enableReview: true,
            visibilityMode: "GROUP",
            configVersion: 1,
            groups: config.reviewGroups.map((group) => ({
              ...group,
              members: [{ kind, id: "deleted" }],
            })),
          },
          {},
        ),
      ).rejects.toThrow(BadRequestException);
      expect(manager.save).not.toHaveBeenCalled();
    },
  );

  it("blocks activation when the ACP is not technically ready", async () => {
    const config = {
      reviewConfigVersion: 1,
      reviewRevision: "0",
      featureConfig: { enableReview: false, commentVisibilityMode: "PRIVATE" },
      reviewGroups: [],
    };
    const manager = { transaction: jest.fn() };
    const readiness = {
      check: jest.fn().mockResolvedValue({
        status: "BLOCKED",
        blockers: ["Kein Booklet"],
        warnings: [],
      }),
    };
    const controller = new ReviewController(
      { assert: jest.fn() } as any,
      {} as any,
      { manager, findOne: async () => config } as any,
      readiness as any,
    );

    await expect(
      controller.configure(
        "acp",
        {
          enableReview: true,
          visibilityMode: "PRIVATE",
          configVersion: 1,
          groups: [],
        },
        {},
      ),
    ).rejects.toThrow(BadRequestException);
    expect(readiness.check).toHaveBeenCalledWith("acp");
    expect(manager.transaction).not.toHaveBeenCalled();
  });
});

describe("deleting review groups", () => {
  it.each([0, 1])(
    "allows only comment-free groups (comment count %i)",
    async (count) => {
      const config = {
        id: "cfg",
        reviewConfigVersion: 1,
        reviewRevision: "0",
        featureConfig: { enableReview: false },
        reviewGroups: [
          { id: "g", name: "Group", members: [], archived: false },
        ],
      };
      const manager: any = {
        findOne: jest.fn(async () => config),
        count: jest.fn(async () => count),
        save: jest.fn(async (x) => x),
        transaction: async (fn: any) => fn(manager),
      };
      const controller = new ReviewController(
        { assert: jest.fn() } as any,
        {} as any,
        { manager, findOne: async () => config } as any,
        {} as any,
      );
      const dto = {
        configVersion: 1,
        enableReview: false,
        visibilityMode: "PRIVATE" as const,
        groups: [],
        deletedGroupIds: ["g"],
      };
      if (count) {
        await expect(controller.configure("acp", dto, {})).rejects.toThrow(
          "enthält Kommentare",
        );
        expect(manager.save).not.toHaveBeenCalled();
      } else {
        expect((await controller.configure("acp", dto, {})).groups).toEqual([]);
      }
      expect(manager.findOne).toHaveBeenCalledWith(
        AcpAccessConfig,
        expect.objectContaining({ lock: { mode: "pessimistic_write" } }),
      );
      expect(manager.count).toHaveBeenCalledWith(expect.anything(), {
        where: { acpId: "acp", groupId: "g" },
      });
    },
  );
  it("requires an explicit deletion confirmation", async () => {
    const config = {
      reviewConfigVersion: 1,
      featureConfig: {},
      reviewGroups: [{ id: "g" }],
    };
    const manager: any = {
      findOne: async () => config,
      transaction: async (fn: any) => fn(manager),
      save: jest.fn(),
    };
    const controller = new ReviewController(
      { assert: jest.fn() } as any,
      {} as any,
      { manager, findOne: async () => config } as any,
      {} as any,
    );
    await expect(
      controller.configure(
        "acp",
        {
          configVersion: 1,
          enableReview: false,
          visibilityMode: "PRIVATE",
          groups: [],
        },
        {},
      ),
    ).rejects.toThrow("bestätigt");
    expect(manager.save).not.toHaveBeenCalled();
  });
});

describe("review developer metadata visibility", () => {
  it.each([true, false, undefined])(
    "persists %s and preserves the setting for older clients that omit it",
    async (hideReviewDeveloperNames) => {
      const config = {
        reviewConfigVersion: 1,
        reviewRevision: "0",
        featureConfig: {
          enableReview: true,
          hideReviewDeveloperNames: true,
          showMetadata: true,
        },
        reviewGroups: [],
      };
      const manager: any = {
        findOne: jest.fn(async () => config),
        save: jest.fn(async (value) => value),
        transaction: async (fn: any) => fn(manager),
      };
      const capabilities = { assert: jest.fn() };
      const controller = new ReviewController(
        capabilities as any,
        {} as any,
        { manager, findOne: async () => config } as any,
        {} as any,
      );
      const result = await controller.configure(
        "acp",
        {
          enableReview: true,
          visibilityMode: "PRIVATE",
          configVersion: 1,
          hideReviewDeveloperNames,
        },
        {},
      );
      expect(result.hideReviewDeveloperNames).toBe(
        hideReviewDeveloperNames ?? true,
      );
      expect(config.featureConfig.showMetadata).toBe(true);
      expect(
        (await controller.getConfig("acp", {})).hideReviewDeveloperNames,
      ).toBe(hideReviewDeveloperNames ?? true);
      expect(capabilities.assert).toHaveBeenCalledWith({}, "review:manage");
      expect(manager.save).toHaveBeenCalledWith(config);
    },
  );
});
