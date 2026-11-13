import { Controller, Get } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import request = require("supertest");
import { registerGeoGebraAssets } from "./geogebra-static-assets";

@Controller("api/private")
class PrivateController {
  @Get() get() {
    return { private: true };
  }
}

describe("GeoGebra static resources", () => {
  let app: NestExpressApplication;
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "content-hub-resource-test-"));
    await writeFile(join(directory, "probe.json"), '{"available":true}');
    const module = await Test.createTestingModule({
      controllers: [PrivateController],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    registerGeoGebraAssets(app, directory);
    // Keep the production ordering: static assets precede authenticated API CORS.
    app.enableCors({
      origin: "https://content-hub.example",
      credentials: true,
    });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  });

  it.each([
    "/assets/GeoGebra/",
    "/api/shared-assets/geogebra/",
    "/api/shared-assets/GeoGebra/",
  ])("permits credential-free sandbox reads at %s", async (prefix) => {
    const response = await request(app.getHttpServer())
      .get(`${prefix}probe.json`)
      .set("Origin", "null")
      .expect(200);
    expect(response.body).toEqual({ available: true });
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(
      response.headers["access-control-allow-credentials"],
    ).toBeUndefined();
    expect(response.headers["cross-origin-resource-policy"]).toBe(
      "cross-origin",
    );
    await request(app.getHttpServer())
      .head(`${prefix}probe.json`)
      .set("Origin", "null")
      .expect(200)
      .expect("Access-Control-Allow-Origin", "*");
  });

  it("does not broaden the API origin policy", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/private")
      .set("Origin", "null")
      .expect(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://content-hub.example",
    );
  });
});
