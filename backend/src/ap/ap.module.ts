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
} from "../database/entities";
import { AuthModule } from "../auth/auth.module";
import { ItemExplorerModule } from "../item-explorer/item-explorer.module";
import { AdminModule } from "../admin/admin.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ap,
      ApUserRole,
      ApAccessConfig,
      ApCredential,
      AppSettings,
      User,
    ]),
    AuthModule,
    ItemExplorerModule,
    AdminModule,
  ],
  controllers: [ApController],
  providers: [ApService, ApCredentialsService],
  exports: [ApService],
})
export class ApModule {}
