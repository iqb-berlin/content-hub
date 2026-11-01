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

    const routeUuid = params.acpId || params.id;
    if (routeUuid) {
      assertUuidParam(routeUuid, params.acpId ? "AP ID" : "Resource ID");
    }

    // Check if user is App Admin - App Admins have access to everything
    if (user.isAppAdmin) {
      this.logger.log("Access granted: User is App Admin");
      return true;
    }

    // Check ACP-specific roles (ACP_MANAGER or READ_ONLY)
    const acpId = params.id || params.acpId;
    if (user.acpRoles && acpId) {
      const acpRole = user.acpRoles.find((role: any) => role.acpId === acpId);

      this.logger.log(`Checking ACP roles for ACP ID: ${acpId}`);
      this.logger.log(
        `User ACP roles: ${JSON.stringify(user.acpRoles, null, 2)}`,
      );
      this.logger.log(`Found ACP role: ${JSON.stringify(acpRole)}`);

      // ACP_MANAGER can access ACP_MANAGER-protected endpoints
      if (
        requiredRoles.includes("ACP_MANAGER") &&
        acpRole?.role === "ACP_MANAGER"
      ) {
        this.logger.log("Access granted: User is ACP Manager for this ACP");
        return true;
      }

      // READ_ONLY users can access READ_ONLY-protected endpoints
      if (
        requiredRoles.includes("READ_ONLY") &&
        (acpRole?.role === "READ_ONLY" || acpRole?.role === "ACP_MANAGER")
      ) {
        this.logger.log("Access granted: User has read access for this ACP");
        return true;
      }
    }

    this.logger.warn("Access denied: Insufficient permissions");
    throw new ForbiddenException("Insufficient permissions");
  }
}
