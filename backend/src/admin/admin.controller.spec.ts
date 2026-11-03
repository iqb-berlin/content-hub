import { AdminController } from "./admin.controller";

describe("AdminController", () => {
  let controller: AdminController;
  let adminService: any;

  beforeEach(() => {
    adminService = {
      getSettings: jest
        .fn()
        .mockResolvedValue({ language: "de", logoUrl: "/logo.svg" }),
      updateSettings: jest
        .fn()
        .mockResolvedValue({ language: "en", logoUrl: "/logo.svg" }),
      listApplicationTokens: jest.fn().mockResolvedValue([{ id: "token-1" }]),
      createApplicationToken: jest.fn().mockResolvedValue({
        id: "token-1",
        token: "ch_secret",
      }),
      revokeApplicationToken: jest.fn().mockResolvedValue({
        id: "token-1",
        active: false,
      }),
      uploadGeoGebraBundle: jest.fn().mockResolvedValue({
        geoGebraBundle: { sourceFileName: "bundle.zip" },
      }),
      deleteGeoGebraBundle: jest
        .fn()
        .mockResolvedValue({ geoGebraBundle: null }),
    };

    controller = new AdminController(adminService);
  });

  it("returns settings", async () => {
    await expect(controller.getSettings()).resolves.toEqual({
      language: "de",
      logoUrl: "/logo.svg",
    });
    expect(adminService.getSettings).toHaveBeenCalledTimes(1);
  });

  it("updates settings", async () => {
    const payload = { language: "en" };

    await expect(controller.updateSettings(payload)).resolves.toEqual({
      language: "en",
      logoUrl: "/logo.svg",
    });
    expect(adminService.updateSettings).toHaveBeenCalledWith(payload);
  });

  it("lists application tokens with pagination", async () => {
    await expect(controller.listApplicationTokens("25", "10")).resolves.toEqual(
      [{ id: "token-1" }],
    );
    expect(adminService.listApplicationTokens).toHaveBeenCalledWith({
      limit: 25,
      offset: 10,
    });
  });

  it("creates application tokens for the current admin user", async () => {
    const payload = {
      name: "Studio",
      scopes: ["acp.read"],
    };

    await expect(
      controller.createApplicationToken(payload, { user: { sub: "admin-1" } }),
    ).resolves.toEqual({
      id: "token-1",
      token: "ch_secret",
    });
    expect(adminService.createApplicationToken).toHaveBeenCalledWith(
      payload,
      "admin-1",
    );
  });

  it("revokes application tokens for the current admin user", async () => {
    await expect(
      controller.revokeApplicationToken("token-1", {
        user: { sub: "admin-1" },
      }),
    ).resolves.toEqual({
      id: "token-1",
      active: false,
    });
    expect(adminService.revokeApplicationToken).toHaveBeenCalledWith(
      "token-1",
      "admin-1",
    );
  });

  it("uploads a GeoGebra bundle", async () => {
    const file = {
      originalname: "GeoGebra.itcr.zip",
    } as Express.Multer.File;

    await expect(controller.uploadGeoGebraBundle(file)).resolves.toEqual({
      geoGebraBundle: { sourceFileName: "bundle.zip" },
    });
    expect(adminService.uploadGeoGebraBundle).toHaveBeenCalledWith(file);
  });

  it("deletes the GeoGebra bundle", async () => {
    await expect(controller.deleteGeoGebraBundle()).resolves.toEqual({
      geoGebraBundle: null,
    });
    expect(adminService.deleteGeoGebraBundle).toHaveBeenCalledTimes(1);
  });
});
