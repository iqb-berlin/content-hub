import { ReviewReadinessSnapshot } from "../database/entities/review-readiness-snapshot.entity";
import { ReviewController } from "../review/review.controller";
import { ReviewManifestModule } from "../review/review-manifest.module";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ViewsService } from "./views.service";
import { ViewsController } from "./views.controller";
import {
  Ap,
  ApAccessConfig,
  ApFile,
  AppSettings,
  ApUserRole,
  ApItemPreference,
} from "../database/entities";
import { AuthModule } from "../auth/auth.module";
import { ItemExplorerModule } from "../item-explorer/item-explorer.module";
import { FilesModule } from "../files/files.module";
import { ItemCollectionsModule } from "../item-collections/item-collections.module";
import { ValidationModule } from "../validation/validation.module";
import { ReviewReadinessService } from "../review/review-readiness.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReviewReadinessSnapshot,
      Ap,
      ApAccessConfig,
      ApFile,
      AppSettings,
      ApUserRole,
      ApItemPreference,
    ]),
    ReviewManifestModule,
    AuthModule,
    ItemExplorerModule,
    FilesModule,
    ItemCollectionsModule,
    ValidationModule,
  ],
  controllers: [ViewsController, ReviewController],
  providers: [ViewsService, ReviewReadinessService],
  exports: [ViewsService],
})
export class ViewsModule {}
