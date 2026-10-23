import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DataSource } from "typeorm";
import * as request from "supertest";
import {
  Acp,
  AcpAccessConfig,
  AcpCredential,
  AcpFile,
  AcpUserRole,
  User,
} from "../src/database/entities";
import { UnitParserService } from "../src/files/unit-parser.service";
import { ReviewManifestService } from "../src/review/review-manifest.service";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("Published reviewer column boundary (HTTP)", () => {
  jest.setTimeout(60000);
  let app: INestApplication,
    db: DataSource,
    server: any,
    acpId: string,
    configId: string,
    temp: string;
  const tokens: Record<string, string> = {};
  const headers = (name: string) => ({
    Authorization: `Bearer ${tokens[name]}`,
  });
  const fileIds: Record<string, string> = {};
  const item = {
    itemId: "I",
    unitId: "U",
    uuid: "10000000-0000-4000-8000-000000000001",
    rowKey: "U_I",
    unitLabel: "Secret task",
    description: "Secret description",
    variableId: "I",
    metadata: { skill: "reading", hidden: "SECRET_METADATA" },
    empiricalDifficulty: 123456,
    bista: 123457,
    rowNumber: 1,
    bookletOccurrences: [],
    tags: ["SECRET_TAG"],
  };
  let version: number;
  async function patch(
    restricted: boolean,
    visible = ["system:itemId", "metadata:skill"],
  ) {
    const response = await request(server)
      .patch(`/api/acp/${acpId}/item-explorer/draft`)
      .set(headers("editor"))
      .send({
        baseVersion: version,
        changeType: "METADATA_COLUMNS_CHANGED",
        patch: {
          metadataColumns: {
            restrictReviewerColumnsToManagerSelection: restricted,
            configured: true,
            visible: ["skill"],
            order: ["skill"],
            widths: {},
            layout: { configured: true, visible, order: visible, widths: {} },
          },
        },
      })
      .expect(200);
    version = response.body.version;
  }
  async function publish() {
    const response = await request(server)
      .post(`/api/acp/${acpId}/item-explorer/draft/save`)
      .set(headers("editor"))
      .send({ baseVersion: version })
      .expect(201);
    version = response.body.version;
  }
  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== "test" ||
      !process.env.DB_DATABASE?.includes("e2e")
    )
      throw new Error("Isolated e2e database required");
    const { AppModule } = await import("../src/app.module");
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(UnitParserService)
      .useValue({
        getItemRowKeysFromFiles: async () => new Set(["U_I"]),
        getItemListFromFiles: async () => ({
          items: [structuredClone(item)],
          columns: [
            { id: "skill", label: "Skill" },
            { id: "hidden", label: "Hidden" },
          ],
          unitMetadata: {
            U: [
              { id: "skill", valueAsText: "reading" },
              { id: "hidden", valueAsText: "SECRET_METADATA" },
            ],
          },
          codingSchemes: {},
        }),
        getUnitViewFromFiles: async () => ({
          id: "U",
          name: "Secret task",
          dependencies: [{ type: "METADATA", fileId: fileIds["U.vomd"] }],
        }),
      })
      .overrideProvider(ReviewManifestService)
      .useValue({
        getManifest: async () => ({ booklets: [], units: [], issues: [] }),
      })
      .compile();
    app = module.createNestApplication();
    app.useLogger(["error"]);
    app.setGlobalPrefix("api");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    server = app.getHttpServer();
    db = app.get(DataSource);
    const acp = await db.getRepository(Acp).save({
      packageId: `columns-${Date.now()}`,
      name: "Column policy",
      acpIndex: {
        units: [
          {
            id: "U",
            name: "Secret task",
            items: [{ id: "I", name: "Secret description" }],
            dependencies: [
              { id: "U.vomd", type: "METADATA" },
              { id: "P.html", type: "PLAYER" },
            ],
          },
        ],
      },
    });
    acpId = acp.id;
    const config = await db.getRepository(AcpAccessConfig).save({
      acpId,
      accessModel: "CREDENTIALS_LIST" as any,
      featureConfig: {
        enableItemList: true,
        enablePersonalItemData: true,
        enableItemCollections: true,
        allowFileDownload: true,
        allowUnitDownload: true,
      },
    });
    configId = config.id;
    const jwt = app.get(JwtService);
    for (const [name, grants] of Object.entries({
      reader: ["item-explorer:view"],
      editor: ["item-explorer:edit"],
      reviewer: ["review:participate"],
      reviewManager: ["review:manage", "item-explorer:view"],
      admin: [],
    })) {
      const user = await db.getRepository(User).save({
        username: `columns-${name}-${Date.now()}`,
        isAppAdmin: name === "admin",
      });
      await db.getRepository(AcpUserRole).save({
        acpId,
        userId: user.id,
        role: "READ_ONLY" as any,
        capabilities: grants,
      });
      tokens[name] = jwt.sign({
        sub: user.id,
        username: user.username,
        type: "oidc",
        authType: "oidc",
        isAppAdmin: user.isAppAdmin,
      });
    }
    const credential = await db.getRepository(AcpCredential).save({
      accessConfigId: configId,
      username: "columns-credential",
      passwordHash: "unused",
      capabilities: ["item-explorer:view"],
    });
    tokens.credential = jwt.sign({
      sub: credential.id,
      username: credential.username,
      type: "credential",
      acpId,
    });
    temp = await mkdtemp(join(tmpdir(), "reviewer-columns-"));
    for (const name of ["U.vomd", "U.xml", "P.html", "raw.json"]) {
      const filePath = join(temp, name);
      await writeFile(
        filePath,
        name === "P.html" ? "<html>Player</html>" : "SECRET_RAW",
      );
      const file = await db.getRepository(AcpFile).save({
        acpId,
        originalName: name,
        filePath,
        fileType: "text/plain",
        fileSize: 10,
        checksum: name,
      });
      fileIds[name] = file.id;
    }
    const state = await request(server)
      .get(`/api/view/acp/${acpId}/item-explorer/state`)
      .set(headers("editor"))
      .expect(200);
    version = state.body.version;
  });
  afterAll(async () => {
    if (db && acpId) await db.getRepository(Acp).delete(acpId);
    if (app) await app.close();
    if (temp) await rm(temp, { recursive: true, force: true });
  });

  it("keeps defaults and drafts readable until publish, then enforces users, credentials and admin previews", async () => {
    const path = `/api/acp/${acpId}/files/item-list`;
    const before = await request(server)
      .get(path)
      .set(headers("reader"))
      .expect(200);
    expect(before.body.items[0].empiricalDifficulty).toBe(123456);
    await patch(true);
    const draft = await request(server)
      .get(path)
      .set(headers("reader"))
      .expect(200);
    expect(draft.body.items[0].empiricalDifficulty).toBe(123456);
    await publish();
    const reviewerState = await request(server)
      .get(`/api/view/acp/${acpId}/item-explorer/state`)
      .set(headers("reader"))
      .expect(200);
    expect(
      reviewerState.body.publishedState.metadataColumns.layout.visible,
    ).toEqual(expect.arrayContaining(["system:position", "system:itemId"]));
    for (const actor of ["reader", "credential", "reviewManager"]) {
      const response = await request(server)
        .get(`${path}?perspective=editor`)
        .set(headers(actor))
        .expect(200);
      expect(response.body.items[0]).toMatchObject({
        itemId: "I",
        metadata: { skill: "reading" },
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /SECRET|123456|123457|Secret task/,
      );
      expect(response.headers["cache-control"]).toContain("no-store");
    }
    for (const actor of ["editor", "admin"]) {
      const response = await request(server)
        .get(path)
        .set(headers(actor))
        .expect(200);
      expect(response.body.items[0].empiricalDifficulty).toBe(123456);
      const preview = await request(server)
        .get(`${path}?perspective=read-only`)
        .set(headers(actor))
        .expect(200);
      expect(preview.body.items[0]).not.toHaveProperty("empiricalDifficulty");
    }
    await request(server).get(path).set(headers("reviewer")).expect(403);
    await request(server)
      .patch(`/api/acp/${acpId}/item-explorer/draft`)
      .set(headers("reader"))
      .send({
        changeType: "BYPASS",
        patch: {
          metadataColumns: { restrictReviewerColumnsToManagerSelection: false },
        },
      })
      .expect(403);
  });

  it("covers alternate lists, states, metadata, raw files, archives and filter side channels", async () => {
    for (const path of [
      `/api/view/acp/${acpId}/items`,
      `/api/view/acp/${acpId}/units/U`,
      `/api/acp/${acpId}/items`,
      `/api/acp/${acpId}/items/U_I`,
      `/api/view/acp/${acpId}/item-explorer/state`,
      `/api/acp/${acpId}/files/unit-view/U`,
      "/api/acp",
    ]) {
      const response = await request(server)
        .get(path)
        .set(headers("reader"))
        .expect(200);
      expect(JSON.stringify(response.body)).not.toMatch(
        /SECRET|123456|123457|Secret task/,
      );
    }
    for (const name of ["U.vomd", "U.xml", "raw.json"])
      for (const action of ["download", "preview"]) {
        await request(server)
          .get(`/api/acp/${acpId}/files/${fileIds[name]}/${action}`)
          .set(headers("reader"))
          .expect(403);
      }
    await request(server)
      .get(`/api/acp/${acpId}/files/${fileIds["P.html"]}/download`)
      .set(headers("reader"))
      .expect(200);
    for (const path of [
      `/api/view/acp/${acpId}/index`,
      `/api/view/acp/${acpId}/index/export`,
      `/api/acp/${acpId}/files?format=zip&unitId=U`,
      `/api/acp/${acpId}/items?sortBy=empiricalDifficulty`,
      `/api/acp/${acpId}/items?filter=Secret`,
    ]) {
      await request(server).get(path).set(headers("reader")).expect(403);
    }
  });

  it("keeps own data and filters XLSX and collection CSV columns before serialization", async () => {
    await request(server)
      .patch(`/api/view/acp/${acpId}/items/preferences/row-data`)
      .set(headers("reader"))
      .send({
        rowKey: "U_I",
        rowData: { note: "My own note", tags: ["My tag"] },
        perspective: "read-only",
      })
      .expect(200);
    const xlsx = await request(server)
      .post(`/api/view/acp/${acpId}/items/preferences/export.xlsx`)
      .set(headers("reader"))
      .send({ rowKeys: ["U_I"], perspective: "editor" })
      .buffer(true)
      .parse((res, callback) => {
        const parts: Buffer[] = [];
        res.on("data", (part) => parts.push(part));
        res.on("end", () => callback(null, Buffer.concat(parts)));
      })
      .expect(201);
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.body);
    const values = JSON.stringify(workbook.worksheets[0].getSheetValues());
    expect(values).toContain("My own note");
    expect(values).not.toMatch(
      /123456|123457|Secret task|Itemschwierigkeit|BiSta/,
    );
    const created = await request(server)
      .post(`/api/view/acp/${acpId}/items/collections`)
      .set(headers("reader"))
      .send({ name: "My collection" })
      .expect(201);
    const id = created.body.collections.find(
      (c: any) => c.name === "My collection",
    ).id;
    await request(server)
      .patch(`/api/view/acp/${acpId}/items/collections/${id}`)
      .set(headers("reader"))
      .send({
        baseVersion: created.body.collections.find((c: any) => c.id === id)
          .version,
        rowKeys: ["U_I"],
        perspective: "read-only",
      })
      .expect(200);
    await request(server)
      .post(`/api/view/acp/${acpId}/items/collections/${id}/export.csv`)
      .set(headers("reader"))
      .expect(201)
      .expect((response) => {
        expect(response.text).toContain("My own note");
        expect(response.text).not.toMatch(
          /123456|123457|Secret task|Itemschwierigkeit|BiSta|Trennschärfe/,
        );
      });
  });

  it("keeps the published restriction when discarding and restores released defaults on publish", async () => {
    await patch(false);
    const state = await request(server)
      .get(`/api/view/acp/${acpId}/item-explorer/state`)
      .set(headers("reader"))
      .expect(200);
    expect(state.body.draftState).toEqual(state.body.publishedState);
    expect(
      state.body.publishedState.metadataColumns
        .restrictReviewerColumnsToManagerSelection,
    ).toBe(true);
    const discarded = await request(server)
      .post(`/api/acp/${acpId}/item-explorer/draft/discard`)
      .set(headers("editor"))
      .send({ baseVersion: version })
      .expect(201);
    version = discarded.body.version;
    await patch(true, ["system:itemId", "system:empiricalDifficulty"]);
    await publish();
    const released = await request(server)
      .get(`/api/acp/${acpId}/files/item-list`)
      .set(headers("reader"))
      .expect(200);
    expect(released.body.items[0].empiricalDifficulty).toBe(123456);
    expect(released.body.items[0]).not.toHaveProperty("bista");
    await db
      .getRepository(AcpAccessConfig)
      .update(configId, { accessModel: "PUBLIC" as any });
    const publicView = await request(server)
      .get(`/api/acp/${acpId}/files/item-list`)
      .expect(200);
    expect(publicView.body.items[0]).not.toHaveProperty("bista");
    await patch(false);
    await publish();
    const unrestricted = await request(server)
      .get(`/api/acp/${acpId}/files/item-list`)
      .expect(200);
    expect(unrestricted.body.items[0].bista).toBe(123457);
  });
  it("applies booklet label visibility to start-page, sequence-list and detail endpoints", async () => {
    await db
      .getRepository(AcpAccessConfig)
      .update(configId, { accessModel: "CREDENTIALS_LIST" as any });
    const acp = await db.getRepository(Acp).findOneByOrFail({ id: acpId });
    await db.getRepository(Acp).update(acpId, {
      acpIndex: {
        ...acp.acpIndex,
        assessmentParts: [
          {
            id: "part",
            bookletModules: [
              { id: "M", name: "HIDDEN_MODULE_TITLE", units: [{ id: "U" }] },
            ],
          },
        ],
      },
    });
    const manifests = app.get(ReviewManifestService);
    const original = manifests.getManifest;
    manifests.getManifest = async () => ({
      booklets: [
        {
          id: "B",
          name: "HIDDEN_BOOKLET_TITLE",
          definitionId: "HIDDEN_BOOKLET_TITLE.xml",
          children: [],
          units: [],
        },
      ],
      units: [],
      issues: [],
    });
    try {
      for (const visible of [false, true]) {
        await patch(
          true,
          visible ? ["system:itemId", "metadata:booklet"] : ["system:itemId"],
        );
        await publish();
        for (const actor of ["reader", "credential"]) {
          for (const suffix of [
            "",
            "/sequences",
            "/sequences/B?kind=booklet",
            "/sequences/M",
          ]) {
            const response = await request(server)
              .get(`/api/view/acp/${acpId}${suffix}`)
              .set(headers(actor))
              .expect(200);
            expect(
              /HIDDEN_BOOKLET_TITLE|HIDDEN_MODULE_TITLE/.test(response.text),
            ).toBe(visible);
            const sequence =
              suffix === ""
                ? response.body.sequences[0]
                : suffix === "/sequences"
                  ? response.body[0]
                  : response.body;
            expect(sequence.id).toBe(suffix === "/sequences/M" ? "M" : "B");
            if (suffix === "/sequences/M")
              expect(sequence.units).toEqual([{ id: "U" }]);
          }
        }
      }
    } finally {
      manifests.getManifest = original;
    }
  });
});
