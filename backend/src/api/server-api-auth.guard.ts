import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ServerApiAuthService } from "./server-api-auth.service";
import { SERVER_API_SCOPES_KEY } from "./server-api-scopes.decorator";
import { Request } from "express";
import { ServerApiRequest } from "./server-api.types";

@Injectable()
export class ServerApiAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: ServerApiAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ServerApiRequest>();
    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException("Missing server API token");
    }

    const client = await this.authService.validateToken(token);
    if (!client) {
      throw new UnauthorizedException("Invalid server API token");
    }

    const requiredScopes =
      this.reflector.getAllAndOverride<string[]>(SERVER_API_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || [];

    if (!this.authService.hasScopes(client.scopes, requiredScopes)) {
      throw new ForbiddenException(
        `Missing required scopes: ${requiredScopes.join(", ")}`,
      );
    }

    req.serverApiClient = {
      id: client.id,
      scopes: client.scopes,
      allowedApIds: client.allowedApIds || null,
    };

    return true;
  }

  private extractToken(req: Request): string | null {
    const xServerToken =
      (req.headers?.["x-server-token"] as string | undefined) ||
      (req.headers?.["x-integration-token"] as string | undefined);

    if (xServerToken && xServerToken.trim()) {
      return xServerToken.trim();
    }

    const authHeader = req.headers?.authorization as string | undefined;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.slice("Bearer ".length).trim();
    }

    return null;
  }
}
