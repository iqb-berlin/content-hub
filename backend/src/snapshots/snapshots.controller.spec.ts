import { SnapshotsController } from "./snapshots.controller";

describe("SnapshotsController", () => {
  let controller: SnapshotsController;
  let snapshotsService: any;

  beforeEach(() => {
    snapshotsService = {
      findByAp: jest.fn().mockResolvedValue([{ id: "s-1" }]),
      findByIdInAp: jest.fn().mockResolvedValue({ id: "s-1", apId: "ap-1" }),
      create: jest.fn().mockResolvedValue({ id: "s-2", versionNumber: 2 }),
      restore: jest.fn().mockResolvedValue({ id: "ap-1", version: 2 }),
      diff: jest.fn().mockResolvedValue({ changed: ["unit-1"] }),
      diffWithCurrent: jest.fn().mockResolvedValue({ changed: ["unit-2"] }),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    controller = new SnapshotsController(snapshotsService);
  });

  it("lists snapshots by AP", async () => {
    await expect(controller.findAll("ap-1")).resolves.toEqual([{ id: "s-1" }]);
    expect(snapshotsService.findByAp).toHaveBeenCalledWith("ap-1");
  });

  it("gets one snapshot in AP scope", async () => {
    await expect(controller.findOne("ap-1", "s-1")).resolves.toEqual({
      id: "s-1",
      apId: "ap-1",
    });
    expect(snapshotsService.findByIdInAp).toHaveBeenCalledWith("ap-1", "s-1");
  });

  it("creates snapshot with changelog", async () => {
    await expect(
      controller.create("ap-1", { changelog: "Release candidate" } as any),
    ).resolves.toEqual({
      id: "s-2",
      versionNumber: 2,
    });
    expect(snapshotsService.create).toHaveBeenCalledWith(
      "ap-1",
      "Release candidate",
    );
  });

  it("restores snapshot after AP-scoped lookup", async () => {
    await expect(controller.restore("ap-1", "s-1")).resolves.toEqual({
      id: "ap-1",
      version: 2,
    });
    expect(snapshotsService.findByIdInAp).toHaveBeenCalledWith("ap-1", "s-1");
    expect(snapshotsService.restore).toHaveBeenCalledWith("s-1");
  });

  it("returns snapshot diff after lookup", async () => {
    await expect(controller.diff("ap-1", "s-1")).resolves.toEqual({
      changed: ["unit-1"],
    });
    expect(snapshotsService.diff).toHaveBeenCalledWith("s-1");
  });

  it("returns snapshot diff against current state after lookup", async () => {
    await expect(controller.diffWithCurrent("ap-1", "s-1")).resolves.toEqual({
      changed: ["unit-2"],
    });
    expect(snapshotsService.diffWithCurrent).toHaveBeenCalledWith("s-1");
  });

  it("deletes snapshot after lookup and returns success message", async () => {
    await expect(controller.delete("ap-1", "s-1")).resolves.toEqual({
      message: "Snapshot deleted successfully",
    });
    expect(snapshotsService.findByIdInAp).toHaveBeenCalledWith("ap-1", "s-1");
    expect(snapshotsService.delete).toHaveBeenCalledWith("s-1");
  });
});
