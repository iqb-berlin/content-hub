import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ApAccessGuard } from "../guards/ap-access.guard";
import { ApCapabilitiesService } from "./ap-capabilities.service";

@Injectable()
export class ExplorerReadGuard implements CanActivate {
  constructor(
    private readonly access: ApAccessGuard,
    private readonly capabilities: ApCapabilitiesService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.access.canActivate(context);
    await this.capabilities.assert(
      context.switchToHttp().getRequest(),
      "item-explorer:view",
      true,
    );
    return true;
  }
}
@Injectable()
export class ExplorerEditGuard implements CanActivate {
  constructor(
    private readonly access: ApAccessGuard,
    private readonly capabilities: ApCapabilitiesService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.access.canActivate(context);
    await this.capabilities.assert(
      context.switchToHttp().getRequest(),
      "item-explorer:edit",
    );
    return true;
  }
}
