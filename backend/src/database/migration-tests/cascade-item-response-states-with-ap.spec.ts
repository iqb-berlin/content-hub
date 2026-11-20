import { QueryRunner } from "typeorm";
import { CascadeItemResponseStatesWithAcp1784200000000 } from "../migrations/1784200000000-CascadeItemResponseStatesWithAcp";

describe("CascadeItemResponseStatesWithAp migration", () => {
  it("removes orphans and installs a cascading AP foreign key", async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query.replace(/\s+/g, " ").trim());
      }),
    } as unknown as QueryRunner;

    await new CascadeItemResponseStatesWithAcp1784200000000().up(queryRunner);

    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain('DELETE FROM "item_response_states"');
    expect(queries[0]).toContain("WHERE NOT EXISTS");
    expect(queries[1]).toContain('ALTER COLUMN "acp_id" TYPE uuid');
    expect(queries[2]).toContain(
      'FOREIGN KEY ("acp_id") REFERENCES "acp"("id")',
    );
    expect(queries[2]).toContain("ON DELETE CASCADE");
  });

  it("removes the foreign key before restoring the varchar column", async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query.replace(/\s+/g, " ").trim());
      }),
    } as unknown as QueryRunner;

    await new CascadeItemResponseStatesWithAcp1784200000000().down(queryRunner);

    expect(queries[0]).toContain(
      'DROP CONSTRAINT IF EXISTS "FK_item_response_states_acp"',
    );
    expect(queries[1]).toContain(
      'ALTER COLUMN "acp_id" TYPE character varying',
    );
  });
});
