import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, catchError, tap, throwError } from "rxjs";
import {
  SERVER_API_AUDIT_KEY,
  ServerApiAuditMetadata,
} from "./server-api-audit.decorator";
import { ServerApiAuditService } from "./server-api-audit.service";
import { ServerApiRequest } from "./server-api.types";
import { Response } from "express";

@Injectable()
export class ServerApiAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ServerApiAuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: ServerApiAuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditMeta = this.reflector.getAllAndOverride<ServerApiAuditMetadata>(
      SERVER_API_AUDIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!auditMeta) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<ServerApiRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const acpId = this.firstParam(req.params?.acpId);
    const fileId = this.firstParam(req.params?.fileId);

    const baseEntry = {
      clientId: req?.serverApiClient?.id || "unknown",
      action: auditMeta.action,
      method: req?.method || "UNKNOWN",
      path: req?.originalUrl || req?.url || "",
      acpId,
      resourceId: fileId || acpId,
      details: {
        resourceType: auditMeta.resourceType,
        query: req?.query || {},
      },
    };

    return next.handle().pipe(
      tap(() => {
        this.auditService
          .log({
            ...baseEntry,
            success: true,
            statusCode: res?.statusCode,
          })
          .catch((error: unknown) => {
            this.logger.error(
              "Failed to persist server API audit entry",
              error,
            );
          });
      }),
      catchError((error) => {
        this.auditService
          .log({
            ...baseEntry,
            success: false,
            statusCode: error?.status || 500,
            details: {
              ...(baseEntry.details || {}),
              errorMessage: error?.message || "Unknown error",
            },
          })
          .catch((error: unknown) => {
            this.logger.error(
              "Failed to persist server API audit entry",
              error,
            );
          });

        return throwError(() => error);
      }),
    );
  }

  private firstParam(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }
}
