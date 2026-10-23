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
  AcpFile,
  AcpExternalResourceCache,
} from "../database/entities";
import { AuthModule } from "../auth/auth.module";
import { ItemExplorerModule } from "../item-explorer/item-explorer.module";
import { AdminModule } from "../admin/admin.module";
import { SnapshotsModule } from "../snapshots/snapshots.module";
import { AcpIndexService } from "./acp-index.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Acp,
      AcpUserRole,
      AcpAccessConfig,
      AcpCredential,
      AppSettings,
      User,
      AcpFile,
      AcpExternalResourceCache,
    ]),
    AuthModule,
    ItemExplorerModule,
    AdminModule,
    SnapshotsModule,
  ],
  controllers: [AcpController],
  providers: [AcpService, AcpIndexService, AcpCredentialsService],
  exports: [AcpService, AcpIndexService],
})
export class AcpModule {}
