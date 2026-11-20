import { NumberedItemListCache } from "./numbered-item-list.cache";
import type { ItemListResult } from "./unit-parser.types";

const emptyItemList: ItemListResult = {
  columns: [],
  items: [],
  subIdLabel: "Sub-ID",
  subIdLabels: {},
  unitMetadata: {},
  codingSchemes: {},
  variableIdentityConsistency: {
    checkedItemCount: 0,
    collisionCount: 0,
    collisions: [],
  },
};

describe("NumberedItemListCache", () => {
  it("coalesces in-flight numbering and promotes the returned revision", async () => {
    let release!: () => void;
    const load = jest.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        itemList: emptyItemList,
        rowRevision: "revision-2",
        rowNumberingMs: 5,
      };
    });
    const cache = new NumberedItemListCache();

    const first = cache.getOrLoad("ap-1", "parse", "revision-1", load);
    const coalesced = cache.getOrLoad("ap-1", "parse", "revision-1", load);
    await Promise.resolve();
    release();

    await expect(first).resolves.toEqual(
      expect.objectContaining({ status: "miss" }),
    );
    await expect(coalesced).resolves.toEqual(
      expect.objectContaining({ status: "coalesced" }),
    );
    await expect(
      cache.getOrLoad("ap-1", "parse", "revision-2", load),
    ).resolves.toEqual(expect.objectContaining({ status: "hit" }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("removes a failed numbering operation for a clean retry", async () => {
    const cache = new NumberedItemListCache();

    await expect(
      cache.getOrLoad("ap-1", "parse", "revision-1", async () => {
        throw new Error("unstable revision");
      }),
    ).rejects.toThrow("unstable revision");
    await expect(
      cache.getOrLoad("ap-1", "parse", "revision-1", async () => ({
        itemList: emptyItemList,
        rowRevision: "revision-1",
        rowNumberingMs: 3,
      })),
    ).resolves.toEqual(expect.objectContaining({ status: "miss" }));
  });
});
