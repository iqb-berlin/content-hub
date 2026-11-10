import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApItemPreference } from "../database/entities";
import { FilesModule } from "../files/files.module";
import { ItemExplorerModule } from "../item-explorer/item-explorer.module";
import { ItemCollectionStore } from "./item-collection.store";
import { ItemCollectionsService } from "./item-collections.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([ApItemPreference]),
    FilesModule,
    ItemExplorerModule,
  ],
  providers: [ItemCollectionStore, ItemCollectionsService],
  exports: [ItemCollectionsService],
})
export class ItemCollectionsModule {}
