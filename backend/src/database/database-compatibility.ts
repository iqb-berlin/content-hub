import { DataSource, DataSourceOptions, QueryRunner } from "typeorm";
import { AddItemResponseStateRowKey1783900000000 } from "./migrations/1783900000000-AddItemResponseStateRowKey";
import { ReconcileItemExplorerState1783901000000 } from "./migrations/1783901000000-ReconcileItemExplorerState";
import { ScopeItemPreferencesToCredentialId1783902000000 } from "./migrations/1783902000000-ScopeItemPreferencesToCredentialId";
import { DeduplicateAcpCredentials1783903000000 } from "./migrations/1783903000000-DeduplicateAcpCredentials";
import { CompleteCommentLifecycle1789300000000 } from "./migrations/1789300000000-CompleteCommentLifecycle";
import { ReviewVisibilityGroups1789400000000 } from "./migrations/1789400000000-ReviewVisibilityGroups";
import { CommentVotes1789500000000 } from "./migrations/1789500000000-CommentVotes";

/** Run each grant backfill only when adding its column, never on later restarts. */
async function prepareReviewSchema(q: QueryRunner): Promise<void> {
  if (!(await q.hasTable("acp_access_configs"))) return;
  for (const [table, join] of [
    ["acp_user_roles", "t.acp_id = c.acp_id AND t.role = 'READ_ONLY'"],
    ["acp_credentials", "t.access_config_id = c.id"],
  ]) {
    if (
      !(await q.hasTable(table)) ||
      (await q.hasColumn(table, "capabilities"))
    )
      continue;
    await q.query(
      `ALTER TABLE ${table} ADD COLUMN capabilities jsonb NOT NULL DEFAULT '[]'`,
    );
    if (table === "acp_user_roles") {
      await q.query(
        `UPDATE acp_user_roles SET capabilities = '["review:participate","review:manage","item-explorer:view","item-explorer:edit"]' WHERE role = 'ACP_MANAGER'`,
      );
    }
    await q.query(`UPDATE ${table} t SET capabilities =
      (CASE WHEN c.feature_config->>'enableCommenting' = 'true' THEN '["review:participate"]'::jsonb ELSE '[]'::jsonb END) ||
      (CASE WHEN COALESCE(c.feature_config->>'enableItemList', 'true') = 'true' THEN '["item-explorer:view"]'::jsonb ELSE '[]'::jsonb END)
      FROM acp_access_configs c WHERE ${join}`);
  }
  await q.query(`UPDATE acp_access_configs SET feature_config = feature_config || '{"enableReview":false}'::jsonb
    WHERE NOT (feature_config ? 'enableReview')`);
  if (
    (await q.hasTable("comments")) &&
    !(await q.hasColumn("comments", "legacy_read_only"))
  ) {
    await new CompleteCommentLifecycle1789300000000().up(q);
  }
}

/**
 * Prepare schemas that were previously maintained through TypeORM synchronize.
 *
 * Migrations remain the source of truth for deployed environments. Development
 * databases may not have a migration history, though, so changes that require
 * data backfills must run before synchronize attempts to enforce the final
 * entity constraints.
 */
export async function prepareSchemaForSynchronization(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    await queryRunner.startTransaction();
    if (await queryRunner.hasTable("item_response_states")) {
      await new AddItemResponseStateRowKey1783900000000().up(queryRunner);
    }
    if (
      (await queryRunner.hasTable("acp")) &&
      (await queryRunner.hasTable("acp_item_explorer_state"))
    ) {
      await new ReconcileItemExplorerState1783901000000().up(queryRunner);
    }
    if (
      (await queryRunner.hasTable("acp_item_preferences")) &&
      (await queryRunner.hasTable("acp_credentials")) &&
      (await queryRunner.hasTable("acp_access_configs"))
    ) {
      await new ScopeItemPreferencesToCredentialId1783902000000().up(
        queryRunner,
      );
      await new DeduplicateAcpCredentials1783903000000().up(queryRunner);
    }
    await prepareReviewSchema(queryRunner);
    await queryRunner.commitTransaction();
  } catch (error) {
    if (queryRunner.isTransactionActive)
      await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}

/**
 * Initialize TypeORM in a deterministic order: migrations first, compatibility
 * backfills second, and schema synchronization last.
 */
export async function createApplicationDataSource(
  options?: DataSourceOptions,
): Promise<DataSource> {
  if (!options) {
    throw new Error("TypeORM data source options are required");
  }

  const shouldRunMigrations = options.migrationsRun === true;
  const shouldSynchronize = options.synchronize === true;
  const dataSource = new DataSource({
    ...options,
    migrationsRun: false,
    synchronize: false,
  });

  await dataSource.initialize();
  try {
    if (shouldRunMigrations) {
      await dataSource.runMigrations();
    }
    if (shouldSynchronize) {
      await prepareSchemaForSynchronization(dataSource);
      await dataSource.synchronize();
      // synchronize only creates entity schema; trigger-based revision tracking
      // and vote cleanup must also be installed for fresh development databases.
      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();
      try {
        await queryRunner.startTransaction();
        await new ReviewVisibilityGroups1789400000000().installRevisionTrigger(
          queryRunner,
        );
        await new CommentVotes1789500000000().installTriggers(queryRunner);
        await queryRunner.commitTransaction();
      } catch (error) {
        if (queryRunner.isTransactionActive)
          await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    }
    return dataSource;
  } catch (error) {
    await dataSource.destroy();
    throw error;
  }
}
