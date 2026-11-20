import { QueryRunner } from "typeorm";
import { ReconcileItemExplorerState1783901000000 } from "../migrations/1783901000000-ReconcileItemExplorerState";

describe("ReconcileItemExplorerState1783901000000", () => {
  it("rebases a pending draft onto newer AP item properties", async () => {
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "state-1",
            publishedState: {
              ui: {},
              tags: {
                item1: ["old"],
                stale: ["remove"],
              },
              itemProperties: {
                item1: {
                  tags: ["old"],
                  empiricalDifficulty: 1,
                  excluded: false,
                },
              },
            },
            draftState: {
              ui: { filterText: "open draft" },
              tags: {
                item1: ["draft"],
                stale: ["remove"],
              },
              itemProperties: {
                item1: {
                  tags: ["old"],
                  empiricalDifficulty: 1,
                  excluded: false,
                },
              },
            },
            itemProperties: {
              item1: {
                tags: ["domain"],
                empiricalDifficulty: 2,
                excluded: false,
              },
              item2: { tags: ["new"] },
            },
          },
        ])
        .mockResolvedValueOnce(undefined),
    } as unknown as QueryRunner;

    await new ReconcileItemExplorerState1783901000000().up(queryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(2);
    const updateParameters = (queryRunner.query as jest.Mock).mock.calls[1][1];
    expect(JSON.parse(updateParameters[0])).toEqual({
      ui: {},
      tags: {
        item1: ["domain"],
        item2: ["new"],
      },
      itemProperties: {
        item1: {
          tags: ["domain"],
          empiricalDifficulty: 2,
          excluded: false,
        },
        item2: { tags: ["new"] },
      },
    });
    expect(JSON.parse(updateParameters[1])).toEqual({
      ui: { filterText: "open draft" },
      tags: {
        item1: ["draft"],
        item2: ["new"],
      },
      itemProperties: {
        item1: {
          tags: ["draft"],
          empiricalDifficulty: 2,
          excluded: false,
        },
        item2: { tags: ["new"] },
      },
    });
    expect(updateParameters[2]).toBe("DIRTY");
    expect(updateParameters[3]).toBe("state-1");
  });

  it("keeps draft deletions while adopting unrelated domain changes", async () => {
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "state-2",
            publishedState: {
              itemProperties: {
                item1: { excluded: true, previewTargetId: "BASE_A" },
              },
            },
            draftState: {
              itemProperties: {
                item1: { previewTargetId: "BASE_A" },
              },
            },
            itemProperties: {
              item1: {
                excluded: true,
                previewTargetId: "BASE_B",
              },
            },
          },
        ])
        .mockResolvedValueOnce(undefined),
    } as unknown as QueryRunner;

    await new ReconcileItemExplorerState1783901000000().up(queryRunner);

    const updateParameters = (queryRunner.query as jest.Mock).mock.calls[1][1];
    expect(JSON.parse(updateParameters[1]).itemProperties).toEqual({
      item1: { previewTargetId: "BASE_B" },
    });
  });

  it("does not update versions when domain and explorer state already match", async () => {
    const state = {
      tags: { item1: ["current"] },
      itemProperties: { item1: { tags: ["current"] } },
    };
    const queryRunner = {
      query: jest.fn().mockResolvedValueOnce([
        {
          id: "state-3",
          publishedState: state,
          draftState: state,
          itemProperties: state.itemProperties,
        },
      ]),
    } as unknown as QueryRunner;

    await new ReconcileItemExplorerState1783901000000().up(queryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(1);
  });
});
