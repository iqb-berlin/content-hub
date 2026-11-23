import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApCredentialsService } from "./ap-credentials.service";
import { ApService } from "./ap.service";
import { ApController } from "./ap.controller";
import {
  Ap,
  ApUserRole,
  ApAccessConfig,
  ApCredential,
  AppSettings,
  User,
  ApFile,
  ApExternalResourceCache,
} from "../database/entities";
import { AuthModule } from "../auth/auth.module";
import { ItemExplorerModule } from "../item-explorer/item-explorer.module";
import { AdminModule } from "../admin/admin.module";
import { SnapshotsModule } from "../snapshots/snapshots.module";
import { ApIndexService } from "./ap-index.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ap,
      ApUserRole,
      ApAccessConfig,
      ApCredential,
      AppSettings,
      User,
      ApFile,
      ApExternalResourceCache,
    ]),
    AuthModule,
    ItemExplorerModule,
    AdminModule,
    SnapshotsModule,
  ],
  controllers: [ApController],
  providers: [ApService, ApIndexService, ApCredentialsService],
  exports: [ApService, ApIndexService],
})
export class ApModule {}
