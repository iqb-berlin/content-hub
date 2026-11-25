import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { PublicTask } from "../database/entities/public-task.entity";
import {
  PublicTaskManagementController,
  PublicTasksController,
} from "./public-tasks.controller";
import { PublicTasksService } from "./public-tasks.service";

@Module({
  imports: [TypeOrmModule.forFeature([PublicTask]), AuthModule],
  controllers: [PublicTaskManagementController, PublicTasksController],
  providers: [PublicTasksService],
})
export class PublicTasksModule {}
