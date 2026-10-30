import { DataSource } from "typeorm";
import { config } from "dotenv";

config();

/**
 * TypeORM data source for CLI-based migrations.
 *
 * Usage:
 *   npx typeorm-ts-node-commonjs migration:generate -d src/database/data-source.ts src/database/migrations/Init
 *   npx typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts
 *   npx typeorm-ts-node-commonjs migration:revert -d src/database/data-source.ts
 */
export default new DataSource({
  type: "postgres",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  username: process.env.DB_USERNAME || "contenthub",
  password: process.env.DB_PASSWORD || "contenthub_dev",
  database: process.env.DB_DATABASE || "contenthub",
  entities: [__dirname + "/entities/**/*.entity{.ts,.js}"],
  migrations: [__dirname + "/migrations/**/*{.ts,.js}"],
  synchronize: false,
  logging: true,
});
