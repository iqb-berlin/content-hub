import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  ApUserRole,
  ApCredential,
  ApRole,
  ApAccessConfig,
  AccessModel,
} from "../../database/entities";
import { User } from "../../database/entities/user.entity";
import { normalizeApRole } from "../../common/ap-contract";
import { assertUuidParam } from "../../common/uuid-param";

/**
 * Guard that checks if the current user has access to the AP specified by :apId param.
 * Access is granted if:
 * 1. User is an App Admin
 * 2. User has an AP role (AP_MANAGER or READ_ONLY)
 * 3. The AP is configured for PUBLIC access
 * 4. User is authenticated via credential-based login for this AP
 */
@Injectable()
export class ApAccessGuard implements CanActivate {
  constructor(
    @InjectRepository(ApUserRole)
    private readonly apUserRoleRepository: Repository<ApUserRole>,
    @InjectRepository(ApAccessConfig)
    private readonly accessConfigRepository: Repository<ApAccessConfig>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    @InjectRepository(ApCredential)
    private readonly credentialRepository: Repository<ApCredential>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apId = request.params.apId || request.params.id;

    if (!apId) {
      throw new NotFoundException("AP ID not found in request");
    }
    assertUuidParam(apId, "AP ID");

    // Try to resolve user from JWT even if no JwtAuthGuard is attached.
    // This keeps AP routes compatible with optional-auth scenarios.
    if (!request.user) {
      request.user = await this.resolveUserFromRequestToken(request, apId);
    }
    const user = request.user;

    if (user) {
      // App Admin has full access
      if (user.isAppAdmin) {
        request.apAccessLevel = "ADMIN";
        return true;
      }

      // Credential-based access
      if (user.type === "credential" && user.apId === apId) {
        const credential = await this.credentialRepository.findOne({
          where: { id: user.sub },
          relations: ["accessConfig"],
        });
        const config = credential?.accessConfig;
        if (
          !config ||
          config.apId !== apId ||
          config.accessModel !== AccessModel.CREDENTIALS_LIST ||
          (config.validFrom && config.validFrom > new Date()) ||
          (config.validUntil && config.validUntil < new Date())
        ) {
          throw new ForbiddenException("Zugang ist nicht mehr gültig");
        }
        request.apAccessLevel = "CREDENTIAL";
        return true;
      }

      // Role-based access for OIDC users.
      if (user.type === "oidc") {
        const role = Object.prototype.hasOwnProperty.call(
          user,
          "resolvedApRole",
        )
          ? user.resolvedApRole
            ? { role: user.resolvedApRole }
            : null
          : await this.apUserRoleRepository.findOne({
              where: { userId: user.sub, apId },
            });
        if (role) {
          request.apAccessLevel =
            role.role === ApRole.AP_MANAGER ? "MANAGER" : "READ_ONLY";
          return true;
        }
      }
    }

    // Public access is a fallback (anonymous or authenticated users without AP role).
    const publicConfig = await this.accessConfigRepository.findOne({
      where: { apId, accessModel: AccessModel.PUBLIC },
    });
    if (publicConfig) {
      request.apAccessLevel = "PUBLIC";
      return true;
    }

    // For non-public APs, authentication is required.
    if (!user) {
      throw new ForbiddenException("Authentication required");
    }

    throw new ForbiddenException("No access to this AP");
  }

  private async resolveUserFromRequestToken(
    request: any,
    apId: string,
  ): Promise<any | null> {
    const authHeader = request.headers?.authorization as string | undefined;
    const bearerToken =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length).trim()
        : null;
    const queryToken = (request.query?.token || request.query?.auth_token) as
      | string
      | undefined;
    const token = bearerToken || queryToken;

    if (!token) {
      return null;
    }

    try {
      const payload = await this.jwtService.verifyAsync<any>(token);
      if (payload.apId && payload.acpId && payload.apId !== payload.acpId)
        return null;
      payload.apId = payload.apId || payload.acpId;

      // Credential users are not persisted in user table.
      if (payload.type === "credential") {
        return {
          sub: payload.sub,
          username: payload.username,
          isAppAdmin: false,
          type: payload.type,
          authType: payload.authType,
          apId: payload.apId,
          apRoles: [],
        };
      }

      if (payload.type !== "oidc" || payload.authType !== "oidc") {
        return null;
      }

      // Resolve the persisted user and the role relevant to this request in one
      // compact query. Besides avoiding the former second role lookup, this
      // intentionally keeps deleted users and revoked roles visible immediately.
      if (typeof this.userRepository.query === "function") {
        const rows = (await this.userRepository.query(
          `
            SELECT
              u."is_app_admin" AS "isAppAdmin",
              r."role" AS "apRole"
            FROM "users" u
            LEFT JOIN "acp_user_roles" r
              ON r."user_id" = u."id"
             AND r."acp_id" = $2
            WHERE u."id" = $1
            LIMIT 1
          `,
          [payload.sub, apId],
        )) as Array<{
          isAppAdmin: boolean;
          apRole: ApRole | null;
        }>;
        const resolvedUser = rows[0];
        if (resolvedUser?.apRole)
          resolvedUser.apRole = normalizeApRole(resolvedUser.apRole) as ApRole;

        if (!resolvedUser) {
          return null;
        }

        return {
          sub: payload.sub,
          username: payload.username,
          isAppAdmin: resolvedUser.isAppAdmin,
          type: payload.type,
          authType: payload.authType,
          apId: payload.apId,
          apRoles: resolvedUser.apRole
            ? [{ apId, role: resolvedUser.apRole }]
            : [],
          resolvedApRole: resolvedUser.apRole,
        };
      }

      // Test doubles and non-PostgreSQL repository implementations retain the
      // established relation-based fallback.
      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        relations: ["apRoles", "apRoles.ap"],
      });

      if (!user) {
        return null;
      }

      return {
        sub: payload.sub,
        username: payload.username,
        isAppAdmin: user.isAppAdmin,
        type: payload.type,
        authType: payload.authType,
        apId: payload.apId,
        apRoles: user.apRoles.map((role) => ({
          apId: role.apId,
          apName: role.ap?.name,
          role: role.role,
        })),
      };
    } catch {
      return null;
    }
  }
}
