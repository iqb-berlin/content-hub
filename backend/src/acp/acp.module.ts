import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AcpCredentialsService } from "./acp-credentials.service";
import { AcpService } from "./acp.service";
import { AcpController } from "./acp.controller";
import {
  Acp,
  AcpUserRole,
  AcpAccessConfig,
  AcpCredential,
  AppSettings,
  User,
} from "../database/entities";
import { AuthModule } from "../auth/auth.module";
import { ItemExplorerModule } from "../item-explorer/item-explorer.module";
import { AdminModule } from "../admin/admin.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Acp,
      AcpUserRole,
      AcpAccessConfig,
      AcpCredential,
      AppSettings,
      User,
    ]),
    AuthModule,
    ItemExplorerModule,
    AdminModule,
  ],
  controllers: [AcpController],
  providers: [AcpService, AcpCredentialsService],
  exports: [AcpService],
})
export class AcpModule {}
