import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CommentsService } from "./comments.service";
import { CommentsController } from "./comments.controller";
import { ReviewCommentsController } from "./review-comments.controller";
import { Ap, Comment, ApAccessConfig } from "../database/entities";
import { AuthModule } from "../auth/auth.module";
import { FilesModule } from "../files/files.module";
import { ReviewPolicyService } from "./review-policy.service";
import { ReviewAccessGuard } from "./review-access.guard";
import { ReviewManifestModule } from "../review/review-manifest.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Ap, Comment, ApAccessConfig]),
    AuthModule,
    FilesModule,
    ReviewManifestModule,
  ],
  controllers: [CommentsController, ReviewCommentsController],
  providers: [CommentsService, ReviewPolicyService, ReviewAccessGuard],
  exports: [CommentsService, ReviewPolicyService],
})
export class CommentsModule {}
