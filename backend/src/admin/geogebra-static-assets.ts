import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Response } from "express";
import {
  GEOGEBRA_API_PREFIX,
  GEOGEBRA_ASSET_PREFIX,
  GEOGEBRA_PLAYER_API_PREFIX,
} from "./geogebra-bundle.util";

/** These resources are public and must also work from opaque player sandboxes. */
export function registerGeoGebraAssets(
  app: NestExpressApplication,
  directory: string,
): void {
  for (const prefix of [
    GEOGEBRA_ASSET_PREFIX,
    GEOGEBRA_API_PREFIX,
    GEOGEBRA_PLAYER_API_PREFIX,
  ]) {
    app.useStaticAssets(directory, {
      prefix,
      index: false,
      redirect: false,
      setHeaders: (res: Response) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      },
    });
  }
}
