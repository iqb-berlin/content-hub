import { ServerApiController } from "./server-api.controller";
import { SERVER_API_SCOPES_KEY } from "./server-api-scopes.decorator";
import { createServerApiRequest, TEST_UUIDS } from "../testing/test-fixtures";

describe("ServerApiController", () => {
  let controller: ServerApiController;
  let serverApiService: {
    listAps: jest.Mock;
    getApTransferData: jest.Mock;
    getApIndex: jest.Mock;
    updateApIndex: jest.Mock;
    listFiles: jest.Mock;
    getFile: jest.Mock;
    downloadFile: jest.Mock;
    uploadFiles: jest.Mock;
    replaceCodingSchemeFiles: jest.Mock;
    receiveAp: jest.Mock;
  };
  let serverApiAuditService: { list: jest.Mock };

  beforeEach(() => {
    serverApiService = {
      listAps: jest.fn().mockResolvedValue([{ id: "ap-1" }]),
      getApTransferData: jest.fn().mockResolvedValue({ id: "ap-1", files: [] }),
      getApIndex: jest.fn().mockResolvedValue({ version: "0.5.0" }),
      updateApIndex: jest.fn().mockResolvedValue({ operation: "updated" }),
      listFiles: jest.fn().mockResolvedValue([{ id: "file-1" }]),
      getFile: jest.fn().mockResolvedValue({ id: "file-1" }),
      downloadFile: jest.fn().mockResolvedValue({
        file: { originalName: "unit.xml", fileType: "text/xml" },
        buffer: Buffer.from("<xml/>"),
      }),
      uploadFiles: jest.fn().mockResolvedValue({ uploaded: 1 }),
      replaceCodingSchemeFiles: jest
        .fn()
        .mockResolvedValue({ replacedFiles: [] }),
      receiveAp: jest.fn().mockResolvedValue({ operation: "created" }),
    };

    serverApiAuditService = {
      list: jest.fn().mockResolvedValue([{ id: "log-1" }]),
    };

    controller = new ServerApiController(
      serverApiService as any,
      serverApiAuditService as any,
    );
  });

  it("delegates AP list/read/export/index operations to the service", async () => {
    await expect(controller.listAps()).resolves.toEqual([{ id: "ap-1" }]);
    await expect(controller.getAp("ap-1")).resolves.toEqual({
      id: "ap-1",
      files: [],
    });
    await expect(controller.exportAp("ap-1")).resolves.toEqual({
      id: "ap-1",
      files: [],
    });
    await expect(controller.getApIndex("ap-1")).resolves.toEqual({
      version: "0.5.0",
    });

    expect(serverApiService.listAps).toHaveBeenCalled();
    expect(serverApiService.getApTransferData).toHaveBeenNthCalledWith(
      1,
      "ap-1",
      undefined,
    );
    expect(serverApiService.getApTransferData).toHaveBeenNthCalledWith(
      2,
      "ap-1",
      undefined,
    );
    expect(serverApiService.getApIndex).toHaveBeenCalledWith("ap-1", undefined);
  });

  it("reports authenticated token scopes without requiring an AP", () => {
    expect(
      Reflect.getMetadata(SERVER_API_SCOPES_KEY, controller.getCapabilities),
    ).toEqual([]);
    expect(
      controller.getCapabilities(
        createServerApiRequest({
          id: "coding-box",
          scopes: ["ap.read", "files.read"],
          allowedApIds: [TEST_UUIDS.ap],
        }),
      ),
    ).toEqual({
      clientId: "coding-box",
      scopes: ["ap.read", "files.read"],
      capabilities: {
        "ap.read": true,
        "transfer.read": false,
        "transfer.write": false,
        "index.read": false,
        "index.write": false,
        "files.read": true,
        "files.write": false,
        "audit.read": false,
      },
      allowedApIds: [TEST_UUIDS.ap],
    });
  });

  it("updates AP index using strategy and optimistic timestamp", async () => {
    const result = await controller.updateApIndex(
      "ap-1",
      {
        apIndex: { a: 1 },
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      } as any,
      "merge",
    );

    expect(result).toEqual({ operation: "updated" });
    expect(serverApiService.updateApIndex).toHaveBeenCalledWith(
      "ap-1",
      { a: 1 },
      "merge",
      "2026-01-01T00:00:00.000Z",
      undefined,
    );
  });

  it("delegates file listing/reading/uploading", async () => {
    const files = await controller.listFiles("ap-1");
    const oneFile = await controller.getFile("ap-1", "file-1");

    const uploadResult = await controller.uploadFiles(
      "ap-1",
      [{ originalname: "a.xml" } as Express.Multer.File],
      "overwrite",
    );

    expect(files).toEqual([{ id: "file-1" }]);
    expect(oneFile).toEqual({ id: "file-1" });
    expect(uploadResult).toEqual({ uploaded: 1 });

    expect(serverApiService.listFiles).toHaveBeenCalledWith("ap-1", undefined);
    expect(serverApiService.getFile).toHaveBeenCalledWith(
      "ap-1",
      "file-1",
      undefined,
    );
    expect(serverApiService.uploadFiles).toHaveBeenCalledWith(
      "ap-1",
      [{ originalname: "a.xml" }],
      "overwrite",
      undefined,
    );
  });

  it("streams downloaded files via response headers and buffer", async () => {
    const res = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };

    await controller.downloadFile("ap-1", "file-1", res as any);

    expect(serverApiService.downloadFile).toHaveBeenCalledWith(
      "ap-1",
      "file-1",
      undefined,
    );
    expect(res.setHeader).toHaveBeenNthCalledWith(
      1,
      "Content-Disposition",
      'attachment; filename="unit.xml"',
    );
    expect(res.setHeader).toHaveBeenNthCalledWith(
      2,
      "Content-Type",
      "text/xml",
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from("<xml/>"));
  });

  it("replaces coding scheme files with source client id from request", async () => {
    const result = await controller.replaceCodingSchemes(
      "ap-1",
      [{ originalname: "test.vocs" } as Express.Multer.File],
      {
        changelog: "new scheme",
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      } as any,
      createServerApiRequest({ id: "sync-client" }),
    );

    expect(result).toEqual({ replacedFiles: [] });
    expect(serverApiService.replaceCodingSchemeFiles).toHaveBeenCalledWith(
      "ap-1",
      [{ originalname: "test.vocs" }],
      {
        changelog: "new scheme",
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        sourceClientId: "sync-client",
      },
      null,
    );
  });

  it("delegates import endpoints and passes conflict strategy through", async () => {
    const payload = {
      packageId: "pkg-1",
      name: "AP",
      apIndex: { version: "0.5.0" },
    } as any;

    const importResult = await controller.importAp(payload, "merge");
    const legacyResult = await controller.receiveAp(payload, "overwrite");

    expect(importResult).toEqual({ operation: "created" });
    expect(legacyResult).toEqual({ operation: "created" });
    expect(serverApiService.receiveAp).toHaveBeenNthCalledWith(
      1,
      payload,
      "merge",
      undefined,
    );
    expect(serverApiService.receiveAp).toHaveBeenNthCalledWith(
      2,
      payload,
      "overwrite",
      undefined,
    );
  });

  it("uses parsed audit limit and defaults to 100 for invalid values", async () => {
    await expect(
      controller.getAuditLogs(
        "50",
        "ap.read",
        "client-1",
        createServerApiRequest({ allowedApIds: [TEST_UUIDS.ap] }),
      ),
    ).resolves.toEqual([{ id: "log-1" }]);
    await expect(
      controller.getAuditLogs("NaN", undefined, undefined),
    ).resolves.toEqual([{ id: "log-1" }]);

    expect(serverApiAuditService.list).toHaveBeenNthCalledWith(
      1,
      50,
      "ap.read",
      "client-1",
      [TEST_UUIDS.ap],
    );
    expect(serverApiAuditService.list).toHaveBeenNthCalledWith(
      2,
      100,
      undefined,
      undefined,
      undefined,
    );
  });
});
