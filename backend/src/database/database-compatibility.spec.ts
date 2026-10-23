import { DataSource, QueryRunner } from "typeorm";
import { prepareSchemaForSynchronization } from "./database-compatibility";

describe("prepareSchemaForSynchronization", () => {
  function createDataSource(hasItemResponseStates: boolean) {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      hasTable: jest.fn().mockResolvedValue(hasItemResponseStates),
      hasColumn: jest.fn().mockResolvedValue(true),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    } as unknown as QueryRunner;
    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as unknown as DataSource;
    return { dataSource, queryRunner };
  }

  it("does nothing for a fresh database before synchronize creates tables", async () => {
    const { dataSource, queryRunner } = createDataSource(false);

    await prepareSchemaForSynchronization(dataSource);

    expect(queryRunner.query).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it("backfills the stable row key before synchronize enforces it", async () => {
    const { dataSource, queryRunner } = createDataSource(true);

    await prepareSchemaForSynchronization(dataSource);

    const statements = (queryRunner.query as jest.Mock).mock.calls.map(
      ([statement]) => statement as string,
    );
    expect(
      statements.some((statement) =>
        statement.includes('ADD COLUMN IF NOT EXISTS "row_key"'),
      ),
    ).toBe(true);
    expect(
      statements.some(
        (statement) =>
          statement.includes('SET "row_key" = "unit_id"') &&
          !statement.includes('ALTER COLUMN "row_key" SET NOT NULL'),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes('ALTER COLUMN "row_key" SET NOT NULL'),
      ),
    ).toBe(true);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it("reconciles existing item explorer state before synchronization", async () => {
    const { dataSource, queryRunner } = createDataSource(false);
    (queryRunner.hasTable as jest.Mock).mockImplementation(
      async (table: string) =>
        table === "acp" || table === "acp_item_explorer_state",
    );

    await prepareSchemaForSynchronization(dataSource);

    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM "acp_item_explorer_state" state'),
    );
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it("backfills stable credential preference ids before synchronization", async () => {
    const { dataSource, queryRunner } = createDataSource(false);
    (queryRunner.hasTable as jest.Mock).mockImplementation(
      async (table: string) =>
        table === "acp_item_preferences" ||
        table === "acp_credentials" ||
        table === "acp_access_configs",
    );

    await prepareSchemaForSynchronization(dataSource);

    const statements = (queryRunner.query as jest.Mock).mock.calls.map(
      ([statement]) => statement as string,
    );
    expect(
      statements.some((statement) =>
        statement.includes('ADD COLUMN IF NOT EXISTS "credential_id"'),
      ),
    ).toBe(true);
    expect(
      statements.some(
        (statement) =>
          statement.includes('SET "credential_id" = credential."id"') &&
          statement.includes(
            'preference."credential_username" = credential."username"',
          ),
      ),
    ).toBe(true);
    expect(
      statements.some(
        (statement) =>
          statement.includes('DELETE FROM "acp_item_preferences"') &&
          statement.includes('"credential_id" IS NULL') &&
          statement.includes('"credential_username" IS NOT NULL'),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes(
          'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_acp_credentials_unique_username"',
        ),
      ),
    ).toBe(true);
    const createTemporaryTableIndex = statements.findIndex((statement) =>
      statement.includes(
        'CREATE TEMPORARY TABLE "acp_credential_dedup_map_1783903000000"',
      ),
    );
    const dropTemporaryTableIndex = statements.findIndex((statement) =>
      statement.includes('DROP TABLE "acp_credential_dedup_map_1783903000000"'),
    );
    expect(createTemporaryTableIndex).toBeGreaterThanOrEqual(0);
    expect(dropTemporaryTableIndex).toBeGreaterThan(createTemporaryTableIndex);
  });
});
