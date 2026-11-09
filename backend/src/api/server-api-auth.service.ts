import { normalizeApScope } from "../common/ap-contract";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import * as crypto from "crypto";
import { Repository } from "typeorm";
import { ApplicationToken } from "../database/entities";
import { ALL_SERVER_API_SCOPES } from "./server-api-scopes";
import { hashServerApiToken } from "./server-api-token.util";

const LAST_USED_AT_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

export interface ServerApiClient {
  id: string;
  token: string;
  scopes: string[];
  allowedApIds?: string[] | null;
}

@Injectable()
export class ServerApiAuthService {
  private readonly logger = new Logger(ServerApiAuthService.name);
  private readonly clients: ServerApiClient[];
  private applicationTokenStoreUnavailableLogged = false;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(ApplicationToken)
    private readonly applicationTokenRepository: Repository<ApplicationToken>,
  ) {
    this.clients = this.loadClients();
    if (!this.clients.length) {
      this.logger.log(
        "No SERVER_API_TOKENS or SERVER_API_KEY configured. Database-backed application tokens can still authenticate integrations.",
      );
    }
  }

  async validateToken(
    token: string,
  ): Promise<Omit<ServerApiClient, "token"> | null> {
    const normalizedToken = token.trim();
    let applicationTokenClient: Omit<ServerApiClient, "token"> | null = null;
    try {
      applicationTokenClient =
        await this.validateApplicationToken(normalizedToken);
    } catch (error) {
      if (!this.isApplicationTokenStoreUnavailable(error)) {
        throw error;
      }

      this.logApplicationTokenStoreUnavailable(error);
    }

    if (applicationTokenClient) {
      return applicationTokenClient;
    }

    return this.validateConfiguredToken(normalizedToken);
  }

  private validateConfiguredToken(
    token: string,
  ): Omit<ServerApiClient, "token"> | null {
    for (const client of this.clients) {
      if (this.tokensEqual(client.token, token)) {
        return {
          id: client.id,
          scopes: [...client.scopes],
          allowedApIds: client.allowedApIds || null,
        };
      }
    }

    return null;
  }

  private async validateApplicationToken(
    token: string,
  ): Promise<Omit<ServerApiClient, "token"> | null> {
    if (!token) {
      return null;
    }

    const tokenHash = hashServerApiToken(token);
    const applicationToken = await this.applicationTokenRepository.findOne({
      where: { tokenHash },
    });
    if (!applicationToken) {
      return null;
    }

    if (!this.tokensEqual(applicationToken.tokenHash, tokenHash)) {
      return null;
    }

    if (
      !applicationToken.active ||
      applicationToken.revokedAt ||
      (applicationToken.expiresAt && applicationToken.expiresAt <= new Date())
    ) {
      return null;
    }

    const lastUsedAt = new Date();
    if (this.shouldUpdateLastUsedAt(applicationToken.lastUsedAt, lastUsedAt)) {
      await this.updateApplicationTokenLastUsedAt(applicationToken, lastUsedAt);
    }

    return {
      id: applicationToken.name,
      scopes: Array.isArray(applicationToken.scopes)
        ? applicationToken.scopes.map(normalizeApScope)
        : [],
      allowedApIds: Array.isArray(applicationToken.allowedApIds)
        ? [...applicationToken.allowedApIds]
        : null,
    };
  }

  hasScopes(clientScopes: string[], requiredScopes: string[]): boolean {
    if (!requiredScopes.length) return true;
    const normalized = new Set(clientScopes.map(normalizeApScope));
    return requiredScopes.every((scope) =>
      normalized.has(normalizeApScope(scope)),
    );
  }

  private loadClients(): ServerApiClient[] {
    const fromJson = this.loadClientsFromJson();
    if (fromJson.length) {
      return fromJson;
    }

    // Fallback for simple setup
    const legacyToken = (
      this.configService.get<string>("SERVER_API_KEY", "") || ""
    ).trim();
    if (legacyToken) {
      return [
        {
          id: "legacy",
          token: legacyToken,
          scopes: [...ALL_SERVER_API_SCOPES],
          allowedApIds: null,
        },
      ];
    }

    return [];
  }

  private shouldUpdateLastUsedAt(
    currentLastUsedAt: Date | string | null | undefined,
    now: Date,
  ): boolean {
    if (!currentLastUsedAt) {
      return true;
    }

    const currentDate =
      currentLastUsedAt instanceof Date
        ? currentLastUsedAt
        : new Date(currentLastUsedAt);
    if (Number.isNaN(currentDate.getTime())) {
      return true;
    }

    return (
      now.getTime() - currentDate.getTime() >= LAST_USED_AT_UPDATE_INTERVAL_MS
    );
  }

  private async updateApplicationTokenLastUsedAt(
    applicationToken: ApplicationToken,
    lastUsedAt: Date,
  ): Promise<void> {
    try {
      await this.applicationTokenRepository.update(applicationToken.id, {
        lastUsedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not update lastUsedAt for application token ${applicationToken.id}; continuing authentication. ${message}`,
      );
    }
  }

  private isApplicationTokenStoreUnavailable(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }

    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "42703") {
      return true;
    }

    const message =
      error instanceof Error ? error.message : String((error as any).message);
    return (
      message.includes("application_tokens") &&
      message.toLowerCase().includes("does not exist")
    );
  }

  private logApplicationTokenStoreUnavailable(error: unknown): void {
    if (this.applicationTokenStoreUnavailableLogged) {
      return;
    }

    this.applicationTokenStoreUnavailableLogged = true;
    const message =
      error instanceof Error
        ? error.message
        : String((error as { message?: string })?.message || error);
    this.logger.warn(
      `Application token table is unavailable; falling back to configured server API tokens for this process. ${message}`,
    );
  }

  private loadClientsFromJson(): ServerApiClient[] {
    const raw = (
      this.configService.get<string>("SERVER_API_TOKENS", "") || ""
    ).trim();
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.logger.warn(
          "SERVER_API_TOKENS must be a JSON array. Ignoring malformed config.",
        );
        return [];
      }

      const clients: ServerApiClient[] = [];
      for (const entry of parsed) {
        if (!entry || typeof entry !== "object") continue;

        const id = String((entry as any).id || "").trim();
        const token = String((entry as any).token || "").trim();
        const scopesInput = Array.isArray((entry as any).scopes)
          ? (entry as any).scopes
          : [];
        const scopes = Array.from(
          new Set<string>(
            scopesInput
              .map((scope: unknown) =>
                normalizeApScope(String(scope || "").trim()),
              )
              .filter((scope: string) => scope.length > 0),
          ),
        );

        if (!id || !token) {
          continue;
        }

        clients.push({
          id,
          token,
          scopes: scopes.length ? scopes : [...ALL_SERVER_API_SCOPES],
          allowedApIds: null,
        });
      }

      return clients;
    } catch {
      this.logger.warn(
        "SERVER_API_TOKENS contains invalid JSON. Ignoring malformed config.",
      );
      return [];
    }
  }

  private tokensEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
  }
}
