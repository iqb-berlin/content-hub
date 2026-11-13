import * as fs from "fs/promises";
import type { ApFile } from "../database/entities";
import type { FileCatalogCache } from "./file-catalog.cache";
import { UnitViewResolver } from "./unit-view.resolver";

jest.mock("fs/promises", () => ({
  readFile: jest.fn(),
}));

describe("UnitViewResolver", () => {
  it("rebuilds an invalidated AP without evicting other AP views", async () => {
    const catalogs: Record<string, ApFile[]> = {
      "ap-1": [
        {
          id: "file-1",
          apId: "ap-1",
          originalName: "u1.xml",
          filePath: "/tmp/ap-1-u1.xml",
        } as ApFile,
      ],
      "ap-2": [
        {
          id: "file-2",
          apId: "ap-2",
          originalName: "u1.xml",
          filePath: "/tmp/ap-2-u1.xml",
        } as ApFile,
      ],
    };
    const fileCatalogCache = {
      get: jest.fn(async (apId: string) => ({
        files: catalogs[apId],
        signature: `${apId}-revision`,
        cacheStatus: "hit" as const,
        sourceReadMs: 0,
        fileSignatureMs: 0,
      })),
    } as unknown as FileCatalogCache;
    (fs.readFile as jest.Mock).mockImplementation(async (filePath: string) => {
      const unitLabel = filePath.includes("ap-1") ? "AP 1" : "AP 2";
      return `<Unit>
        <Id>u1</Id>
        <Label>${unitLabel}</Label>
        <DefinitionRef player="">u1.voud</DefinitionRef>
      </Unit>`;
    });
    const resolver = new UnitViewResolver(fileCatalogCache);

    await expect(resolver.resolve("ap-1", "u1")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "miss" }),
    );
    await expect(resolver.resolve("ap-2", "u1")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "miss" }),
    );
    await expect(resolver.resolve("ap-1", "u1")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "hit" }),
    );
    await expect(resolver.resolve("ap-2", "u1")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "hit" }),
    );

    resolver.invalidate("ap-1");

    await expect(resolver.resolve("ap-1", "u1")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "miss" }),
    );
    await expect(resolver.resolve("ap-2", "u1")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "hit" }),
    );
    expect(fs.readFile).toHaveBeenCalledTimes(3);
  });
});
