import { readFile } from "fs/promises";
import { readFileSync } from "fs";
import { join } from "path";
import { ReviewManifestService } from "./review-manifest.service";

jest.mock("fs/promises", () => ({ readFile: jest.fn() }));

describe("ReviewManifestService", () => {
  const xml = readFileSync(
    join(__dirname, "fixtures/review-booklet.xml"),
    "utf8",
  );
  const aps = { findOne: jest.fn() };
  const files = { find: jest.fn() };
  const service = new ReviewManifestService(aps as any, files as any);

  beforeEach(() => {
    jest.resetAllMocks();
    aps.findOne.mockResolvedValue({
      apIndex: {
        assessmentParts: [
          {
            units: [{ id: "intro" }, { id: "task-1" }, { id: "task-2" }],
            instruments: [
              { testcenterBooklet: [{ definitionId: "review.xml" }] },
            ],
          },
        ],
      },
    });
    files.find.mockResolvedValue([
      { originalName: "review.xml", filePath: "/storage/booklet.xml" },
      { originalName: "other.xml", filePath: "/storage/unrelated.xml" },
    ]);
    jest.mocked(readFile).mockResolvedValue(xml);
  });

  it("loads only referenced files within the requested AP and resolves navigation", async () => {
    const result = await service.getManifest("ap-1");
    expect(aps.findOne).toHaveBeenCalledWith({ where: { id: "ap-1" } });
    expect(files.find).toHaveBeenCalledWith({ where: { apId: "ap-1" } });
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith("/storage/booklet.xml", "utf8");
    expect(result.booklets[0].units.map((unit) => unit.id)).toEqual([
      "intro",
      "task-1",
      "task-2",
      "task-1",
    ]);
    expect(result.issues).toEqual([]);
  });

  it("reports unreadable definitions rather than inventing navigation", async () => {
    jest.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
    const result = await service.getManifest("ap-1");
    expect(result.booklets).toEqual([]);
    expect(result.issues[0]).toEqual(
      expect.objectContaining({
        severity: "error",
        message: "Booklet-Datei fehlt: review.xml",
      }),
    );
  });

  it("rejects unknown APs", async () => {
    aps.findOne.mockResolvedValue(null);
    await expect(service.getManifest("missing")).rejects.toThrow(
      "AP nicht gefunden",
    );
    expect(files.find).not.toHaveBeenCalled();
  });
});
