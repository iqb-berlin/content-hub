import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from "bcryptjs";
import {
  AcpAccessConfig,
  AcpCredential,
  AccessModel,
} from "../database/entities";
import { normalizeGrants } from "../auth/capabilities/acp-capabilities";
import {
  CredentialEntryDto,
  CredentialResponseDto,
  CreateCredentialDto,
  UpdateCredentialDto,
} from "./dto/acp.dto";

@Injectable()
export class AcpCredentialsService {
  constructor(
    @InjectRepository(AcpAccessConfig)
    private readonly accessConfigRepository: Repository<AcpAccessConfig>,
    @InjectRepository(AcpCredential)
    private readonly credentialRepository: Repository<AcpCredential>,
  ) {}

  async uploadCredentials(
    acpId: string,
    credentials: CredentialEntryDto[],
    mode: "replace" | "append" | "upsert" = "replace",
    grants?: string[],
  ): Promise<{
    added: number;
    updated: number;
    skipped: number;
    duplicates: string[];
  }> {
    const config = await this.accessConfigRepository.findOne({
      where: { acpId },
    });
    if (!config || config.accessModel !== AccessModel.CREDENTIALS_LIST) {
      throw new BadRequestException(
        "ACP must be configured for CREDENTIALS_LIST access",
      );
    }

    if (!["replace", "append", "upsert"].includes(mode))
      throw new BadRequestException("Ungültiger Importmodus");
    const capabilities =
      grants === undefined ? undefined : normalizeGrants(grants);
    const duplicates: string[] = [];
    const seenInUpload = new Set<string>();
    const uniqueCredentials = credentials.filter((cred) => {
      if (seenInUpload.has(cred.username)) {
        if (!duplicates.includes(cred.username)) duplicates.push(cred.username);
        return false;
      }
      seenInUpload.add(cred.username);
      return true;
    });
    const existingAppendUsernames =
      mode === "append"
        ? new Set(
            (
              await this.credentialRepository.find({
                where: { accessConfigId: config.id },
                select: ["username"],
              })
            ).map((credential) => credential.username),
          )
        : new Set<string>();
    const credentialsToHash =
      mode === "append"
        ? uniqueCredentials.filter(
            (credential) => !existingAppendUsernames.has(credential.username),
          )
        : uniqueCredentials;
    const passwordHashes = await this.hashCredentials(credentialsToHash);

    return this.credentialRepository.manager.transaction(async (manager) => {
      await manager.query(
        "SELECT id FROM acp_access_configs WHERE id = $1 FOR UPDATE",
        [config.id],
      );
      const credentialRepository = manager.getRepository(AcpCredential);
      const existingCredentials = await credentialRepository.find({
        where: { accessConfigId: config.id },
        order: { id: "ASC" },
      });
      const existingByUsername = new Map<string, AcpCredential>();
      const duplicateCredentials: AcpCredential[] = [];
      for (const credential of existingCredentials) {
        if (existingByUsername.has(credential.username)) {
          duplicateCredentials.push(credential);
        } else {
          existingByUsername.set(credential.username, credential);
        }
      }
      let added = 0;
      let updated = 0;
      let skipped = 0;
      const credentialsToSave: AcpCredential[] = [];

      for (const credential of uniqueCredentials) {
        const existing = existingByUsername.get(credential.username);
        if (existing && mode === "append") {
          skipped += 1;
          continue;
        }

        const passwordHash =
          passwordHashes.get(credential.username) ||
          (await bcrypt.hash(credential.password, 12));

        if (existing) {
          existing.passwordHash = passwordHash;
          if (capabilities !== undefined) existing.capabilities = capabilities;
          credentialsToSave.push(existing);
          updated += 1;
          continue;
        }

        credentialsToSave.push(
          credentialRepository.create({
            accessConfigId: config.id,
            username: credential.username,
            passwordHash,
            capabilities: capabilities ?? [],
          }),
        );
        added += 1;
      }

      if (credentialsToSave.length) {
        await credentialRepository.save(credentialsToSave);
      }

      if (mode === "replace") {
        const incomingUsernames = new Set(
          uniqueCredentials.map((credential) => credential.username),
        );
        const removedCredentials = existingCredentials.filter(
          (credential) =>
            duplicateCredentials.includes(credential) ||
            !incomingUsernames.has(credential.username),
        );
        if (removedCredentials.length) {
          await credentialRepository.remove(removedCredentials);
        }
      } else if (duplicateCredentials.length) {
        await credentialRepository.remove(duplicateCredentials);
      }

      return { added, updated, skipped, duplicates };
    });
  }

  private async hashCredentials(
    credentials: CredentialEntryDto[],
  ): Promise<Map<string, string>> {
    const passwordHashes = new Map<string, string>();
    let nextIndex = 0;
    const workerCount = Math.min(4, credentials.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < credentials.length) {
        const credential = credentials[nextIndex];
        nextIndex += 1;
        passwordHashes.set(
          credential.username,
          await bcrypt.hash(credential.password, 12),
        );
      }
    });
    await Promise.all(workers);
    return passwordHashes;
  }

  async getCredentials(acpId: string): Promise<CredentialResponseDto[]> {
    const config = await this.accessConfigRepository.findOne({
      where: { acpId },
    });
    if (!config) {
      return [];
    }
    const credentials = await this.credentialRepository.find({
      where: { accessConfigId: config.id },
      select: ["id", "username", "capabilities"],
    });
    return credentials.map((c) => ({
      id: c.id,
      username: c.username,
      capabilities: c.capabilities,
    }));
  }

  async deleteCredential(acpId: string, credentialId: string): Promise<void> {
    const config = await this.accessConfigRepository.findOne({
      where: { acpId },
    });
    if (!config) {
      throw new NotFoundException("Access configuration not found");
    }
    const credential = await this.credentialRepository.findOne({
      where: { id: credentialId, accessConfigId: config.id },
    });
    if (!credential) {
      throw new NotFoundException("Credential not found");
    }
    await this.credentialRepository.remove(credential);
  }

  async createCredential(
    acpId: string,
    dto: CreateCredentialDto,
  ): Promise<CredentialResponseDto> {
    const config = await this.accessConfigRepository.findOne({
      where: { acpId },
    });
    if (!config || config.accessModel !== AccessModel.CREDENTIALS_LIST) {
      throw new BadRequestException(
        "ACP must be configured for CREDENTIALS_LIST access",
      );
    }

    // Check for duplicate username
    const existing = await this.credentialRepository.findOne({
      where: { accessConfigId: config.id, username: dto.username },
    });
    if (existing) {
      throw new ConflictException(`Username "${dto.username}" already exists`);
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const credential = this.credentialRepository.create({
      accessConfigId: config.id,
      username: dto.username,
      passwordHash,
      capabilities: normalizeGrants(dto.capabilities ?? []),
    });

    const saved = await this.credentialRepository.save(credential);
    return {
      id: saved.id,
      username: saved.username,
      capabilities: saved.capabilities,
    };
  }

  async updateCredential(
    acpId: string,
    credentialId: string,
    dto: UpdateCredentialDto,
  ): Promise<CredentialResponseDto> {
    const config = await this.accessConfigRepository.findOne({
      where: { acpId },
    });
    if (!config || config.accessModel !== AccessModel.CREDENTIALS_LIST) {
      throw new BadRequestException(
        "ACP must be configured for CREDENTIALS_LIST access",
      );
    }

    const credential = await this.credentialRepository.findOne({
      where: { id: credentialId, accessConfigId: config.id },
    });
    if (!credential) {
      throw new NotFoundException("Credential not found");
    }

    // Check for duplicate username if changing username
    if (dto.username && dto.username !== credential.username) {
      const existing = await this.credentialRepository.findOne({
        where: { accessConfigId: config.id, username: dto.username },
      });
      if (existing) {
        throw new ConflictException(
          `Username "${dto.username}" already exists`,
        );
      }
      credential.username = dto.username;
    }

    if (dto.capabilities !== undefined)
      credential.capabilities = normalizeGrants(dto.capabilities);

    // Update password if provided
    if (dto.password) {
      credential.passwordHash = await bcrypt.hash(dto.password, 12);
    }

    const saved = await this.credentialRepository.save(credential);
    return {
      id: saved.id,
      username: saved.username,
      capabilities: saved.capabilities,
    };
  }
}
