import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { isRawApIndexPath, translateApContract } from "./ap-contract";

export const AP_TERMINOLOGY_HEADER = "X-Content-Hub-Terminology";
export type ApCompatibilityRequest = Request & { apTerminology?: "ap" | "acp" };

@Injectable()
export class ApCompatibilityMiddleware implements NestMiddleware {
  use(req: ApCompatibilityRequest, res: Response, next: NextFunction): void {
    const queryStart = req.originalUrl.indexOf("?");
    const pathname =
      queryStart < 0 ? req.originalUrl : req.originalUrl.slice(0, queryStart);
    const search = queryStart < 0 ? "" : req.originalUrl.slice(queryStart);
    const searchParams = new URLSearchParams(search);
    let queryChanged = false;
    const canonicalPath = pathname.replace(
      /^(\/api(?:\/(?:server|view))?)\/acp(?=\/|$)/,
      "$1/ap",
    );
    const canonicalRoute = /^(\/api(?:\/(?:server|view))?)\/ap(?:\/|$)/.test(
      pathname,
    );
    req.apTerminology =
      canonicalRoute || req.get(AP_TERMINOLOGY_HEADER) === "ap" ? "ap" : "acp";
    res.vary(AP_TERMINOLOGY_HEADER);
    res.setHeader(AP_TERMINOLOGY_HEADER, req.apTerminology);
    if (
      req.apTerminology === "acp" &&
      isRawApIndexPath(canonicalPath) &&
      canonicalPath.endsWith("/export")
    ) {
      const setHeader = res.setHeader.bind(res);
      res.setHeader = (name, value) =>
        setHeader(
          name,
          name.toLowerCase() === "content-disposition" &&
            typeof value === "string"
            ? value.replace('filename="ap-index-', 'filename="acp-index-')
            : value,
        );
    }
    try {
      for (const [oldName, newName] of [
        ["allowedAcpId", "allowedApId"],
        ["acpId", "apId"],
      ]) {
        if (!searchParams.has(oldName)) continue;
        queryChanged = true;
        const oldValue = searchParams.getAll(oldName);
        const newValue = searchParams.getAll(newName);
        if (
          newValue.length &&
          JSON.stringify(oldValue) !== JSON.stringify(newValue)
        ) {
          // Use the same conflict handling as JSON envelopes.
          translateApContract({ [oldName]: oldValue, [newName]: newValue });
        }
        if (!newValue.length)
          for (const value of oldValue) searchParams.append(newName, value);
        searchParams.delete(oldName);
      }
      // This runs before route matching, so old URLs use the same guards and handlers.
      req.url = canonicalPath + (queryChanged ? `?${searchParams}` : search);
      if (!isRawApIndexPath(canonicalPath))
        req.body = translateApContract(req.body);
      next();
    } catch (error) {
      next(error);
    }
  }
}
