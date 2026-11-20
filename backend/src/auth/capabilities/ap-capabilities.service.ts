import { Injectable, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  ApCredential,
  ApUserRole,
  ApAccessConfig,
} from "../../database/entities";
import {
  ApCapability,
  hasCapability,
  isExplorerAvailable,
} from "./ap-capabilities";

@Injectable()
export class ApCapabilitiesService {
  constructor(
    @InjectRepository(ApCredential)
    private readonly credentials: Repository<ApCredential>,
    @InjectRepository(ApUserRole)
    private readonly roles: Repository<ApUserRole>,
    @InjectRepository(ApAccessConfig)
    private readonly configs: Repository<ApAccessConfig>,
  ) {}

  async resolve(req: any): Promise<string[]> {
    const apId = req.params.apId || req.params.id;
    let grants: string[] = [];
    if (req.user?.type === "credential") {
      if (req.user.apId !== apId && req.apAccessLevel === "PUBLIC") {
        req.apCapabilities = [];
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
        req.user.apId !== apId ||
        config?.apId !== apId ||
        config.accessModel !== "CREDENTIALS_LIST" ||
        (config.validFrom && config.validFrom > new Date()) ||
        (config.validUntil && config.validUntil < new Date())
      ) {
        throw new ForbiddenException("Zugang ist nicht mehr gültig");
      }
      grants = credential.capabilities || [];
    } else if (req.user?.sub) {
      const role = await this.roles.findOne({
        where: { userId: req.user.sub, apId },
      });
      grants = role?.capabilities || [];
    }
    // Administration never implies review participation.
    if (req.user?.isAppAdmin)
      grants = [...grants, "review:manage", "item-explorer:edit"];
    req.apCapabilities = [...new Set(grants)];
    return req.apCapabilities;
  }

  async assert(
    req: any,
    capability: ApCapability,
    allowPublic = false,
  ): Promise<void> {
    const grants = await this.resolve(req);
    let config: ApAccessConfig | null = null;
    if (
      capability === "item-explorer:view" ||
      capability === "item-explorer:edit"
    ) {
      config = await this.configs.findOne({
        where: { apId: req.params.apId || req.params.id },
      });
      if (!isExplorerAvailable(req, config?.featureConfig)) {
        throw new ForbiddenException("Item list is not enabled for this AP");
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
