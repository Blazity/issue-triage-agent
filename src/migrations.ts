import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

export type Migration = { name: string; checksum: string; sql: string };

type MigrationDatabase = {
  exec(sql: string): Promise<unknown>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export async function loadMigrations(directory: URL): Promise<Migration[]> {
  const names = (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .toSorted();

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(new URL(name, directory), "utf8");
      return {
        name,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}

export async function applyMigrations(
  database: MigrationDatabase,
  migrations: Migration[],
) {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const migration of migrations) {
    const existing = await database.query<{ checksum: string }>(
      "SELECT checksum FROM schema_migrations WHERE name = $1",
      [migration.name],
    );

    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== migration.checksum) {
        throw new Error(`Applied migration changed: ${migration.name}`);
      }
      continue;
    }

    await database.exec("BEGIN");
    try {
      await database.exec("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
      const raced = await database.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE name = $1",
        [migration.name],
      );

      if (raced.rows[0]) {
        if (raced.rows[0].checksum !== migration.checksum) {
          throw new Error(`Applied migration changed: ${migration.name}`);
        }
      } else {
        await database.exec(migration.sql);
        await database.query(
          "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
          [migration.name, migration.checksum],
        );
      }

      await database.exec("COMMIT");
    } catch (error) {
      await database.exec("ROLLBACK");
      throw error;
    }
  }
}
