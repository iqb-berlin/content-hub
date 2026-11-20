import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SnapshotsService } from "./snapshots.service";
import { SnapshotsController } from "./snapshots.controller";
import { ApSnapshot, ApSnapshotFile, Ap, ApFile } from "../database/entities";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([ApSnapshot, ApSnapshotFile, Ap, ApFile]),
    AuthModule,
  ],
  controllers: [SnapshotsController],
  providers: [SnapshotsService],
  exports: [SnapshotsService],
})
export class SnapshotsModule {}
