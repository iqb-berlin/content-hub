import type { Repository } from "typeorm";
import { ApFile } from "../database/entities";
import { FileCatalogCache } from "./file-catalog.cache";

describe("FileCatalogCache", () => {
  it("invalidates only entries belonging to the requested AP", async () => {
    const fileRepository = {
      query: jest.fn(async (_sql: string, [apId]: [string]) => [
        { count: "1", hash: `${apId}-revision` },
      ]),
      find: jest.fn(
        async ({ where: { apId } }: { where: { apId: string } }) => [
          {
            id: `${apId}-file`,
            apId,
            originalName: `${apId}.xml`,
            filePath: `/tmp/${apId}.xml`,
          },
        ],
      ),
    } as unknown as Repository<ApFile>;
    const cache = new FileCatalogCache(fileRepository);

    await expect(cache.get("ap-1")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "miss" }),
    );
    await expect(cache.get("ap-2")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "miss" }),
    );
    await expect(cache.get("ap-1")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "hit" }),
    );
    await expect(cache.get("ap-2")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "hit" }),
    );

    cache.invalidate("ap-1");

    await expect(cache.get("ap-1")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "miss" }),
    );
    await expect(cache.get("ap-2")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "hit" }),
    );
    expect(fileRepository.find).toHaveBeenCalledTimes(3);
  });
});
