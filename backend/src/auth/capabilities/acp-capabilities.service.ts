import { Injectable, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  AcpCredential,
  AcpUserRole,
  AcpAccessConfig,
} from "../../database/entities";
import {
  AcpCapability,
  hasCapability,
  isExplorerAvailable,
} from "./acp-capabilities";

@Injectable()
export class AcpCapabilitiesService {
  constructor(
    @InjectRepository(AcpCredential)
    private readonly credentials: Repository<AcpCredential>,
    @InjectRepository(AcpUserRole)
    private readonly roles: Repository<AcpUserRole>,
    @InjectRepository(AcpAccessConfig)
    private readonly configs: Repository<AcpAccessConfig>,
  ) {}

  async resolve(req: any): Promise<string[]> {
    const acpId = req.params.acpId || req.params.id;
    let grants: string[] = [];
    if (req.user?.type === "credential") {
      if (req.user.acpId !== acpId && req.acpAccessLevel === "PUBLIC") {
        req.acpCapabilities = [];
        return [];
      }
      const credential = await this.credentials.findOne({
        where: { id: req.user.sub },
        relations: ["accessConfig"],
      });
      const config = credential?.accessConfig;
      if (
        !credential ||
        !config ||
        req.user.acpId !== acpId ||
        config?.acpId !== acpId ||
        config.accessModel !== "CREDENTIALS_LIST" ||
        (config.validFrom && config.validFrom > new Date()) ||
        (config.validUntil && config.validUntil < new Date())
      ) {
        throw new ForbiddenException("Zugang ist nicht mehr gültig");
      }
      grants = credential.capabilities || [];
    } else if (req.user?.sub) {
      const role = await this.roles.findOne({
        where: { userId: req.user.sub, acpId },
      });
      grants = role?.capabilities || [];
    }
    // Administration never implies review participation.
    if (req.user?.isAppAdmin)
      grants = [...grants, "review:manage", "item-explorer:edit"];
    req.acpCapabilities = [...new Set(grants)];
    return req.acpCapabilities;
  }

  async assert(
    req: any,
    capability: AcpCapability,
    allowPublic = false,
  ): Promise<void> {
    const grants = await this.resolve(req);
    let config: AcpAccessConfig | null = null;
    if (
      capability === "item-explorer:view" ||
      capability === "item-explorer:edit"
    ) {
      config = await this.configs.findOne({
        where: { acpId: req.params.acpId || req.params.id },
      });
      if (!isExplorerAvailable(req, config?.featureConfig)) {
        throw new ForbiddenException("Item list is not enabled for this ACP");
      }
    }
    if (hasCapability(grants, capability)) return;
    if (allowPublic && capability === "item-explorer:view") {
      if (
        config?.accessModel === "PUBLIC" &&
        config.featureConfig?.enableItemList !== false
      )
        return;
    }
    throw new ForbiddenException(
      "Erforderliche Berechtigung fehlt: " + capability,
    );
  }
}
