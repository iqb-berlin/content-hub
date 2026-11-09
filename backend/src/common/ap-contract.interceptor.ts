import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { catchError, map, Observable, throwError } from "rxjs";
import { ApCompatibilityRequest } from "./ap-compatibility.middleware";
import { isRawApIndexPath, translateApContract } from "./ap-contract";

@Injectable()
export class ApContractInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<ApCompatibilityRequest>();
    if (isRawApIndexPath(req.path)) return next.handle();
    return next.handle().pipe(
      map((result) =>
        req.apTerminology === "acp"
          ? translateApContract(result, true)
          : result,
      ),
      catchError((error: unknown) => {
        if (req.apTerminology !== "acp" || !(error instanceof HttpException))
          return throwError(() => error);
        const response = error.getResponse();
        const aliases: Record<string, string> = {
          AP_MANAGER: "ACP_MANAGER",
          apId: "acpId",
          apIndex: "acpIndex",
          allowedApIds: "allowedAcpIds",
          allowedApId: "allowedAcpId",
          defaultApIndex: "defaultAcpIndex",
        };
        const message = (text: string) =>
          text.replace(
            /\b(?:AP_MANAGER|apId|apIndex|allowedApIds|allowedApId|defaultApIndex)\b/g,
            (key) => aliases[key],
          );
        const body =
          typeof response === "string"
            ? message(response)
            : ({ ...response } as Record<string, unknown>);
        if (typeof body !== "string") {
          if (typeof body.message === "string")
            body.message = message(body.message);
          if (Array.isArray(body.message))
            body.message = body.message.map((value) =>
              typeof value === "string" ? message(value) : value,
            );
        }
        return throwError(
          () => new HttpException(body, error.getStatus(), { cause: error }),
        );
      }),
    );
  }
}
