import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "../../database/entities/user.entity";
import { createRemoteJWKSet, jwtVerify } from "jose";

export interface OidcUserInfo {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

@Injectable()
export class OidcValidationService {
  private jwksUrl: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    const issuerUrl = this.configService.get<string>("OIDC_ISSUER_URL");
    if (issuerUrl) {
      this.jwksUrl = `${issuerUrl}/protocol/openid-connect/certs`;
    }
  }

  async validateIdToken(idToken: string): Promise<any> {
    if (!this.jwksUrl) {
      throw new UnauthorizedException("OIDC not configured");
    }

    const issuerUrl = this.configService.get<string>("OIDC_ISSUER_URL");
    const expectedIssuer =
      this.configService.get<string>("OIDC_PUBLIC_ISSUER_URL") || issuerUrl;
    const clientId = this.configService.get<string>("OIDC_CLIENT_ID");

    if (!expectedIssuer || !clientId) {
      throw new UnauthorizedException("OIDC configuration is incomplete");
    }

    try {
      const JWKS = createRemoteJWKSet(new URL(this.jwksUrl));

      // Prefer strict OIDC ID token validation (issuer + audience).
      // If legacy access tokens are still submitted, fall back to azp validation.
      let payload: any;
      try {
        const result = await jwtVerify(idToken, JWKS, {
          issuer: expectedIssuer,
          audience: clientId,
        });
        payload = result.payload;
      } catch (error) {
        if (!this.isAudienceValidationError(error)) {
          throw error;
        }

        const result = await jwtVerify(idToken, JWKS, {
          issuer: expectedIssuer,
        });
        const authorizedParty = result.payload.azp as string | undefined;

        if (!authorizedParty || authorizedParty !== clientId) {
          throw new UnauthorizedException(
            "Invalid OIDC token: azp does not match configured client",
          );
        }

        payload = result.payload;
      }

      const sub = payload.sub as string | undefined;
      const email = payload.email as string | undefined;
      const name = payload.name as string | undefined;
      const preferredUsername = payload.preferred_username as
        | string
        | undefined;

      const realmRoles = (payload.realm_access as any)?.roles || [];
      const resourceAccess = payload.resource_access as any;
      const clientRoles = resourceAccess?.[clientId]?.roles || [];
      const isKeycloakAdmin =
        realmRoles.includes("admin") || clientRoles.includes("admin");

      if (!sub) {
        throw new UnauthorizedException(
          "Invalid OIDC token: missing sub claim",
        );
      }

      const baseUsername =
        preferredUsername ||
        email?.split("@")[0] ||
        `oidc_${sub.substring(0, 8)}`;

      let user = await this.userRepository.findOne({
        where: { oidcSub: sub },
        relations: ["acpRoles", "acpRoles.acp"],
      });

      if (!user) {
        // If a pre-provisioned profile with the same username exists and is not linked yet,
        // bind this OIDC identity to that account to avoid duplicate users/role drift.
        const existingByUsername = await this.userRepository.findOne({
          where: { username: baseUsername },
          relations: ["acpRoles", "acpRoles.acp"],
        });

        if (existingByUsername && !existingByUsername.oidcSub) {
          existingByUsername.oidcSub = sub;
          existingByUsername.isAppAdmin =
            existingByUsername.isAppAdmin || isKeycloakAdmin;
          if (!existingByUsername.displayName && (name || preferredUsername)) {
            existingByUsername.displayName = name || preferredUsername;
          }
          user = await this.userRepository.save(existingByUsername);
        } else {
          let username = baseUsername;
          let counter = 1;

          while (await this.userRepository.findOne({ where: { username } })) {
            username = `${baseUsername}_${counter}`;
            counter++;
          }

          user = this.userRepository.create({
            username,
            displayName: name || preferredUsername || username,
            oidcSub: sub,
            isAppAdmin: isKeycloakAdmin,
          });

          await this.userRepository.save(user);
        }
      } else {
        // Keycloak admin role can elevate rights, but must not remove
        // app-admin rights that were granted inside Content Hub.
        const shouldBeAppAdmin = user.isAppAdmin || isKeycloakAdmin;
        if (user.isAppAdmin !== shouldBeAppAdmin) {
          user.isAppAdmin = shouldBeAppAdmin;
          await this.userRepository.save(user);
        }
      }

      return {
        sub: user.id,
        username: user.username,
        displayName: user.displayName,
        isAppAdmin: user.isAppAdmin,
        type: "oidc",
        authType: "oidc",
        oidcSub: sub,
        acpRoles: (user.acpRoles || []).map((role) => ({
          acpId: role.acpId,
          acpName: role.acp?.name,
          role: role.role,
        })),
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : "Unknown verification error";
      throw new UnauthorizedException(`Invalid OIDC token: ${message}`);
    }
  }

  isOidcEnabled(): boolean {
    const issuerUrl = this.configService.get<string>("OIDC_ISSUER_URL");
    const clientId = this.configService.get<string>("OIDC_CLIENT_ID");
    return !!(issuerUrl && clientId);
  }

  private isAudienceValidationError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;

    const code = (error as { code?: string }).code;
    const claim = (error as { claim?: string }).claim;
    return code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && claim === "aud";
  }
}
