import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Ap, ApFile } from "../database/entities";
import { ReviewManifestService } from "./review-manifest.service";

@Module({
  imports: [TypeOrmModule.forFeature([Ap, ApFile])],
  providers: [ReviewManifestService],
  exports: [ReviewManifestService],
})
export class ReviewManifestModule {}
