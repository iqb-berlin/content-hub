import * as fs from "fs/promises";
import type { AcpFile } from "../database/entities";
import type { FileCatalogCache } from "./file-catalog.cache";
import { UnitViewResolver } from "./unit-view.resolver";

jest.mock("fs/promises", () => ({
  readFile: jest.fn(),
}));

describe("UnitViewResolver", () => {
  it("rebuilds an invalidated ACP without evicting other ACP views", async () => {
    const catalogs: Record<string, AcpFile[]> = {
      "acp-1": [
        {
          id: "file-1",
          acpId: "acp-1",
          originalName: "u1.xml",
          filePath: "/tmp/acp-1-u1.xml",
        } as AcpFile,
      ],
      "acp-2": [
        {
          id: "file-2",
          acpId: "acp-2",
          originalName: "u1.xml",
          filePath: "/tmp/acp-2-u1.xml",
        } as AcpFile,
      ],
    };
    const fileCatalogCache = {
      get: jest.fn(async (acpId: string) => ({
        files: catalogs[acpId],
        signature: `${acpId}-revision`,
        cacheStatus: "hit" as const,
        sourceReadMs: 0,
        fileSignatureMs: 0,
      })),
    } as unknown as FileCatalogCache;
    (fs.readFile as jest.Mock).mockImplementation(async (filePath: string) => {
      const unitLabel = filePath.includes("acp-1") ? "ACP 1" : "ACP 2";
      return `<Unit>
        <Id>u1</Id>
        <Label>${unitLabel}</Label>
        <DefinitionRef player="">u1.voud</DefinitionRef>
      </Unit>`;
    });
    const resolver = new UnitViewResolver(fileCatalogCache);

    await expect(resolver.resolve("acp-1", "u1")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "miss" }),
    );
    await expect(resolver.resolve("acp-2", "u1")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "miss" }),
    );
    await expect(resolver.resolve("acp-1", "u1")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "hit" }),
    );
    await expect(resolver.resolve("acp-2", "u1")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "hit" }),
    );

    resolver.invalidate("acp-1");

    await expect(resolver.resolve("acp-1", "u1")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "miss" }),
    );
    await expect(resolver.resolve("acp-2", "u1")).resolves.toEqual(
      expect.objectContaining({ cacheStatus: "hit" }),
    );
    expect(fs.readFile).toHaveBeenCalledTimes(3);
  });

  it("resolves a unit by the same slug used for its part path", async () => {
    const files = [
      {
        id: "file-mathe",
        acpId: "acp-1",
        originalName: "u1.xml",
        relativePath: "units/Mäthe Teil 1/u1.xml",
        filePath: "/tmp/mathe-u1.xml",
      },
      {
        id: "file-sprache",
        acpId: "acp-1",
        originalName: "u1.xml",
        relativePath: "units/Sprache/u1.xml",
        filePath: "/tmp/sprache-u1.xml",
      },
    ] as AcpFile[];
    const fileCatalogCache = {
      get: jest.fn(async () => ({
        files,
        signature: "revision",
        cacheStatus: "hit" as const,
        sourceReadMs: 0,
        fileSignatureMs: 0,
      })),
    } as unknown as FileCatalogCache;
    (fs.readFile as jest.Mock).mockResolvedValue(`<Unit>
      <Id>u1</Id><Label>Mathe</Label><DefinitionRef player="">u1.voud</DefinitionRef>
    </Unit>`);

    const result = await new UnitViewResolver(fileCatalogCache).resolve(
      "acp-1",
      "u1",
      "",
      "mathe-teil-1",
    );

    expect(result.value).toEqual(
      expect.objectContaining({ id: "u1", partId: "mathe-teil-1" }),
    );
    expect(fs.readFile).toHaveBeenCalledWith("/tmp/mathe-u1.xml", "utf-8");
  });
});
