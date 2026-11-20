import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Ap,
  ApAccessConfig,
  ApItemExplorerChangeLog,
  ApItemExplorerState,
} from "../database/entities";
import { ItemExplorerStateService } from "./item-explorer-state.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ap,
      ApAccessConfig,
      ApItemExplorerState,
      ApItemExplorerChangeLog,
    ]),
  ],
  providers: [ItemExplorerStateService],
  exports: [ItemExplorerStateService],
})
export class ItemExplorerModule {}
