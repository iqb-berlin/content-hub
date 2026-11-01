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
  AcpUserRole,
  AcpCredential,
  AcpRole,
  AcpAccessConfig,
  AccessModel,
} from "../../database/entities";
import { User } from "../../database/entities/user.entity";
import { assertUuidParam } from "../../common/uuid-param";

/**
 * Guard that checks if the current user has access to the ACP specified by :acpId param.
 * Access is granted if:
 * 1. User is an App Admin
 * 2. User has an ACP role (ACP_MANAGER or READ_ONLY)
 * 3. The ACP is configured for PUBLIC access
 * 4. User is authenticated via credential-based login for this ACP
 */
@Injectable()
export class AcpAccessGuard implements CanActivate {
  constructor(
    @InjectRepository(AcpUserRole)
    private readonly acpUserRoleRepository: Repository<AcpUserRole>,
    @InjectRepository(AcpAccessConfig)
    private readonly accessConfigRepository: Repository<AcpAccessConfig>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    @InjectRepository(AcpCredential)
    private readonly credentialRepository: Repository<AcpCredential>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const acpId = request.params.acpId || request.params.id;

    if (!acpId) {
      throw new NotFoundException("AP ID not found in request");
    }
    assertUuidParam(acpId, "AP ID");

    // Try to resolve user from JWT even if no JwtAuthGuard is attached.
    // This keeps ACP routes compatible with optional-auth scenarios.
    if (!request.user) {
      request.user = await this.resolveUserFromRequestToken(request, acpId);
    }
    const user = request.user;

    if (user) {
      // App Admin has full access
      if (user.isAppAdmin) {
        request.acpAccessLevel = "ADMIN";
        return true;
      }

      // Credential-based access
      if (user.type === "credential" && user.acpId === acpId) {
        const credential = await this.credentialRepository.findOne({
          where: { id: user.sub },
          relations: ["accessConfig"],
        });
        const config = credential?.accessConfig;
        if (
          !config ||
          config.acpId !== acpId ||
          config.accessModel !== AccessModel.CREDENTIALS_LIST ||
          (config.validFrom && config.validFrom > new Date()) ||
          (config.validUntil && config.validUntil < new Date())
        ) {
          throw new ForbiddenException("Zugang ist nicht mehr gültig");
        }
        request.acpAccessLevel = "CREDENTIAL";
        return true;
      }

      // Role-based access for OIDC users.
      if (user.type === "oidc") {
        const role = Object.prototype.hasOwnProperty.call(
          user,
          "resolvedAcpRole",
        )
          ? user.resolvedAcpRole
            ? { role: user.resolvedAcpRole }
            : null
          : await this.acpUserRoleRepository.findOne({
              where: { userId: user.sub, acpId },
            });
        if (role) {
          request.acpAccessLevel =
            role.role === AcpRole.ACP_MANAGER ? "MANAGER" : "READ_ONLY";
          return true;
        }
      }
    }

    // Public access is a fallback (anonymous or authenticated users without ACP role).
    const publicConfig = await this.accessConfigRepository.findOne({
      where: { acpId, accessModel: AccessModel.PUBLIC },
    });
    if (publicConfig) {
      request.acpAccessLevel = "PUBLIC";
      return true;
    }

    // For non-public ACPs, authentication is required.
    if (!user) {
      throw new ForbiddenException("Authentication required");
    }

    throw new ForbiddenException("No access to this AP");
  }

  private async resolveUserFromRequestToken(
    request: any,
    acpId: string,
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

      // Credential users are not persisted in user table.
      if (payload.type === "credential") {
        return {
          sub: payload.sub,
          username: payload.username,
          isAppAdmin: false,
          type: payload.type,
          authType: payload.authType,
          acpId: payload.acpId,
          acpRoles: [],
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
              r."role" AS "acpRole"
            FROM "users" u
            LEFT JOIN "acp_user_roles" r
              ON r."user_id" = u."id"
             AND r."acp_id" = $2
            WHERE u."id" = $1
            LIMIT 1
          `,
          [payload.sub, acpId],
        )) as Array<{
          isAppAdmin: boolean;
          acpRole: AcpRole | null;
        }>;
        const resolvedUser = rows[0];

        if (!resolvedUser) {
          return null;
        }

        return {
          sub: payload.sub,
          username: payload.username,
          isAppAdmin: resolvedUser.isAppAdmin,
          type: payload.type,
          authType: payload.authType,
          acpId: payload.acpId,
          acpRoles: resolvedUser.acpRole
            ? [{ acpId, role: resolvedUser.acpRole }]
            : [],
          resolvedAcpRole: resolvedUser.acpRole,
        };
      }

      // Test doubles and non-PostgreSQL repository implementations retain the
      // established relation-based fallback.
      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        relations: ["acpRoles", "acpRoles.acp"],
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
        acpId: payload.acpId,
        acpRoles: user.acpRoles.map((role) => ({
          acpId: role.acpId,
          acpName: role.acp?.name,
          role: role.role,
        })),
      };
    } catch {
      return null;
    }
  }
}
