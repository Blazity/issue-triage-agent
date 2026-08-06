import { Client } from "pg";

import { applyMigrations, loadMigrations } from "../src/migrations";

const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  await applyMigrations(
    {
      exec: (sql) => client.query(sql),
      query: (sql, params) => client.query(sql, params),
    },
    await loadMigrations(new URL("../db/migrations/", import.meta.url)),
  );
} finally {
  await client.end();
}

console.log("Applied database migrations");
