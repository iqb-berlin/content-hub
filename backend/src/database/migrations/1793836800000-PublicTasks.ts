import { MigrationInterface, QueryRunner } from "typeorm";

export class PublicTasks1793836800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS public_tasks (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      source_ap_id uuid NOT NULL,
      snapshot jsonb NOT NULL,
      title varchar NOT NULL,
      unit_id varchar NOT NULL,
      published boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_public_tasks_source_ap" ON public_tasks (source_ap_id)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    // Never silently destroy long-lived public links during a rollback.
    const rows = await q.query(`SELECT 1 FROM public_tasks LIMIT 1`);
    if (rows.length)
      throw new Error(
        "Public tasks exist; retain their data before rolling back this migration",
      );
    await q.query(`DROP TABLE public_tasks`);
  }
}
