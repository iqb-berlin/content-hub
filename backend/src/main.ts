import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import * as fs from "fs/promises";
import { AppModule } from "./app.module";
import {
  GEOGEBRA_API_PREFIX,
  GEOGEBRA_ASSET_PREFIX,
  GEOGEBRA_PLAYER_API_PREFIX,
  getGeoGebraBundleCurrentDir,
} from "./admin/geogebra-bundle.util";

const MAX_JSON_BODY_SIZE = "6mb";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const isProduction = process.env.NODE_ENV === "production";

  // The personal Item Explorer export accepts up to 10,000 ordered row keys.
  // The validated worst case is slightly above 5 MB (10,000 × 500 chars).
  app.useBodyParser("json", { limit: MAX_JSON_BODY_SIZE });

  const geoGebraAssetsDir = getGeoGebraBundleCurrentDir();
  await fs.mkdir(geoGebraAssetsDir, { recursive: true });
  app.useStaticAssets(geoGebraAssetsDir, {
    prefix: GEOGEBRA_ASSET_PREFIX,
    index: false,
    redirect: false,
  });
  app.useStaticAssets(geoGebraAssetsDir, {
    prefix: GEOGEBRA_API_PREFIX,
    index: false,
    redirect: false,
  });
  app.useStaticAssets(geoGebraAssetsDir, {
    prefix: GEOGEBRA_PLAYER_API_PREFIX,
    index: false,
    redirect: false,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS
  const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:4200")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    credentials: true,
  });

  // API prefix
  app.setGlobalPrefix("api");

  // Swagger documentation (disabled in production by default)
  const swaggerEnabled =
    (
      process.env.SWAGGER_ENABLED || (!isProduction ? "true" : "false")
    ).toLowerCase() === "true";

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle("IQB ContentPool API")
      .setDescription("API for managing Assessment Content Packages")
      .setVersion(process.env.APP_VERSION || "0.0.0-dev")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, document);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`ContentPool API running on port ${port}`);
}
bootstrap().catch((error: unknown) => {
  console.error("Failed to start ContentPool API", error);
  process.exitCode = 1;
});
