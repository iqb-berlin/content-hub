import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { assertUuidParam } from "../../common/uuid-param";

export const ROLES_KEY = "roles";

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    this.logger.log(`RolesGuard checking: ${JSON.stringify(requiredRoles)}`);

    if (!requiredRoles) {
      return true;
    }

    const { user, params } = context.switchToHttp().getRequest();

    this.logger.log(`User object: ${JSON.stringify(user, null, 2)}`);
    this.logger.log(`Request params: ${JSON.stringify(params, null, 2)}`);

    if (!user) {
      throw new ForbiddenException("Not authenticated");
    }

    const routeUuid = params.apId || params.id;
    if (routeUuid) {
      assertUuidParam(routeUuid, params.apId ? "AP ID" : "Resource ID");
    }

    // Check if user is App Admin - App Admins have access to everything
    if (user.isAppAdmin) {
      this.logger.log("Access granted: User is App Admin");
      return true;
    }

    // Check AP-specific roles (AP_MANAGER or READ_ONLY)
    const apId = params.id || params.apId;
    if (user.apRoles && apId) {
      const apRole = user.apRoles.find((role: any) => role.apId === apId);

      this.logger.log(`Checking AP roles for AP ID: ${apId}`);
      this.logger.log(
        `User AP roles: ${JSON.stringify(user.apRoles, null, 2)}`,
      );
      this.logger.log(`Found AP role: ${JSON.stringify(apRole)}`);

      // AP_MANAGER can access AP_MANAGER-protected endpoints
      if (
        requiredRoles.includes("AP_MANAGER") &&
        apRole?.role === "AP_MANAGER"
      ) {
        this.logger.log("Access granted: User is AP Manager for this AP");
        return true;
      }

      // READ_ONLY users can access READ_ONLY-protected endpoints
      if (
        requiredRoles.includes("READ_ONLY") &&
        (apRole?.role === "READ_ONLY" || apRole?.role === "AP_MANAGER")
      ) {
        this.logger.log("Access granted: User has read access for this AP");
        return true;
      }
    }

    this.logger.warn("Access denied: Insufficient permissions");
    throw new ForbiddenException("Insufficient permissions");
  }
}
