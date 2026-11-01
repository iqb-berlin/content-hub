import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from "bcryptjs";
import { User, AcpCredential, AcpAccessConfig } from "../database/entities";

export interface JwtPayload {
  sub: string;
  username: string;
  isAppAdmin: boolean;
  type: "credential" | "oidc";
  authType?: "oidc";
  acpId?: string;
}

interface CredentialLoginAttemptState {
  attempts: number;
  firstAttemptAt: number;
  blockedUntil?: number;
}

@Injectable()
export class AuthService {
  private readonly credentialLoginAttempts = new Map<
    string,
    CredentialLoginAttemptState
  >();
  private readonly credentialLoginMaxAttempts = this.parsePositiveInt(
    process.env.CREDENTIAL_LOGIN_MAX_ATTEMPTS,
    5,
  );
  private readonly credentialLoginWindowMs = this.parsePositiveInt(
    process.env.CREDENTIAL_LOGIN_WINDOW_MS,
    15 * 60 * 1000,
  );
  private readonly credentialLoginBlockMs = this.parsePositiveInt(
    process.env.CREDENTIAL_LOGIN_BLOCK_MS,
    15 * 60 * 1000,
  );

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AcpCredential)
    private readonly credentialRepository: Repository<AcpCredential>,
    @InjectRepository(AcpAccessConfig)
    private readonly accessConfigRepository: Repository<AcpAccessConfig>,
    private readonly jwtService: JwtService,
  ) {}

  async credentialLogin(
    acpId: string,
    username: string,
    password: string,
    clientId = "unknown",
  ) {
    const normalizedClientId = this.normalizeClientId(clientId);
    this.enforceCredentialLoginRateLimit(acpId, username, normalizedClientId);

    try {
      // Find active access config for this ACP with credentials
      const accessConfig = await this.accessConfigRepository.findOne({
        where: { acpId, accessModel: "CREDENTIALS_LIST" as any },
      });

      if (!accessConfig) {
        throw new UnauthorizedException(
          "No credential-based access configured for this AP",
        );
      }

      // Check time validity
      const now = new Date();
      console.log("Login check:", {
        now: now.toISOString(),
        validFrom: accessConfig.validFrom?.toISOString(),
        validUntil: accessConfig.validUntil?.toISOString(),
        nowLessThanValidFrom: accessConfig.validFrom
          ? now < accessConfig.validFrom
          : null,
        nowGreaterThanValidUntil: accessConfig.validUntil
          ? now > accessConfig.validUntil
          : null,
      });
      if (accessConfig.validFrom && now < accessConfig.validFrom) {
        throw new UnauthorizedException("Access period has not started yet");
      }
      if (accessConfig.validUntil && now > accessConfig.validUntil) {
        throw new UnauthorizedException("Access period has expired");
      }

      // Find credential
      const credential = await this.credentialRepository.findOne({
        where: { accessConfigId: accessConfig.id, username },
      });

      if (!credential) {
        throw new UnauthorizedException("Invalid credentials");
      }

      const isPasswordValid = await bcrypt.compare(
        password,
        credential.passwordHash,
      );
      if (!isPasswordValid) {
        throw new UnauthorizedException("Invalid credentials");
      }

      this.clearCredentialLoginRateLimit(acpId, username, normalizedClientId);

      const payload: JwtPayload = {
        sub: credential.id,
        username: credential.username,
        isAppAdmin: false,
        type: "credential",
        acpId,
      };

      return {
        accessToken: this.jwtService.sign(payload),
        acpId,
        username: credential.username,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.registerFailedCredentialLoginAttempt(
          acpId,
          username,
          normalizedClientId,
        );
      }
      throw error;
    }
  }

  async getProfile(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ["acpRoles", "acpRoles.acp"],
    });
    if (!user) {
      throw new UnauthorizedException("User not found");
    }
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      isAppAdmin: user.isAppAdmin,
      acpRoles: user.acpRoles.map((role) => ({
        acpId: role.acpId,
        acpName: role.acp?.name,
        role: role.role,
      })),
    };
  }

  async generateTokenForOidcUser(userInfo: any) {
    const payload: JwtPayload = {
      sub: userInfo.sub,
      username: userInfo.username,
      isAppAdmin: userInfo.isAppAdmin,
      type: "oidc",
      authType: "oidc",
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: userInfo.sub,
        username: userInfo.username,
        displayName: userInfo.displayName || userInfo.username,
        isAppAdmin: userInfo.isAppAdmin,
        acpRoles: userInfo.acpRoles || [],
      },
    };
  }

  async linkOidcAccount(userId: string, oidcSub: string) {
    // Check if user exists
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    // Check if OIDC sub is already linked to another user
    const existingUser = await this.userRepository.findOne({
      where: { oidcSub },
    });
    if (existingUser && existingUser.id !== userId) {
      throw new UnauthorizedException(
        "OIDC account already linked to another user",
      );
    }

    // Update user with OIDC sub
    user.oidcSub = oidcSub;
    await this.userRepository.save(user);

    return {
      message: "OIDC account linked successfully",
      user: {
        id: user.id,
        username: user.username,
        oidcSub: user.oidcSub,
      },
    };
  }

  async logout(userId: string) {
    // Audit logging - in production, this could write to a database
    console.log(
      `[AUDIT] User ${userId} logged out at ${new Date().toISOString()}`,
    );

    return {
      message: "Logout recorded",
      userId,
      timestamp: new Date().toISOString(),
    };
  }

  private parsePositiveInt(
    value: string | undefined,
    fallback: number,
  ): number {
    const parsed = Number.parseInt(value || "", 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  private normalizeClientId(clientId: string | undefined): string {
    const normalized = (clientId || "").trim().toLowerCase();
    return normalized.length > 0 ? normalized : "unknown";
  }

  private credentialLoginRateLimitKey(
    acpId: string,
    username: string,
    clientId: string,
  ): string {
    return `${acpId}:${username.toLowerCase()}:${clientId}`;
  }

  private enforceCredentialLoginRateLimit(
    acpId: string,
    username: string,
    clientId: string,
  ): void {
    const now = Date.now();
    this.pruneCredentialLoginAttempts(now);

    const key = this.credentialLoginRateLimitKey(acpId, username, clientId);
    const attempt = this.credentialLoginAttempts.get(key);
    if (!attempt) {
      return;
    }

    if (attempt.blockedUntil && attempt.blockedUntil > now) {
      throw new HttpException(
        "Too many failed login attempts. Please try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (now - attempt.firstAttemptAt > this.credentialLoginWindowMs) {
      this.credentialLoginAttempts.delete(key);
    }
  }

  private registerFailedCredentialLoginAttempt(
    acpId: string,
    username: string,
    clientId: string,
  ): void {
    const now = Date.now();
    const key = this.credentialLoginRateLimitKey(acpId, username, clientId);
    const current = this.credentialLoginAttempts.get(key);

    if (
      !current ||
      now - current.firstAttemptAt > this.credentialLoginWindowMs
    ) {
      this.credentialLoginAttempts.set(key, {
        attempts: 1,
        firstAttemptAt: now,
      });
      return;
    }

    const attempts = current.attempts + 1;
    this.credentialLoginAttempts.set(key, {
      attempts,
      firstAttemptAt: current.firstAttemptAt,
      blockedUntil:
        attempts >= this.credentialLoginMaxAttempts
          ? now + this.credentialLoginBlockMs
          : undefined,
    });
  }

  private clearCredentialLoginRateLimit(
    acpId: string,
    username: string,
    clientId: string,
  ): void {
    const key = this.credentialLoginRateLimitKey(acpId, username, clientId);
    this.credentialLoginAttempts.delete(key);
  }

  private pruneCredentialLoginAttempts(now: number): void {
    if (this.credentialLoginAttempts.size === 0) {
      return;
    }

    const staleAfterMs = Math.max(
      this.credentialLoginWindowMs,
      this.credentialLoginBlockMs,
    );
    for (const [key, attempt] of this.credentialLoginAttempts.entries()) {
      const isExpired =
        (attempt.blockedUntil && attempt.blockedUntil <= now) ||
        now - attempt.firstAttemptAt > staleAfterMs;
      if (isExpired) {
        this.credentialLoginAttempts.delete(key);
      }
    }
  }
}
