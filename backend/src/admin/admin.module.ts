import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { MulterModule } from "@nestjs/platform-express";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import {
  Ap,
  AppSettings,
  ApplicationToken,
  ServerApiAuditLog,
} from "../database/entities";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ap,
      AppSettings,
      ApplicationToken,
      ServerApiAuditLog,
    ]),
    MulterModule.register({
      limits: { fileSize: 512 * 1024 * 1024 },
    }),
    AuthModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
