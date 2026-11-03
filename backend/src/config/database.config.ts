import { registerAs } from "@nestjs/config";

export default registerAs("database", () => ({
  type: "postgres" as const,
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  username: process.env.DB_USERNAME || "contenthub",
  password: process.env.DB_PASSWORD || "contenthub_dev",
  database: process.env.DB_DATABASE || "contenthub",
  synchronize:
    process.env.DB_SYNCHRONIZE === "true" ||
    process.env.NODE_ENV === "development",
  migrationsRun:
    process.env.DB_RUN_MIGRATIONS === "true" &&
    process.env.DB_SYNCHRONIZE !== "true" &&
    process.env.NODE_ENV !== "development",
  logging: process.env.NODE_ENV === "development",
}));
