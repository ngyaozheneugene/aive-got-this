// Applies db/migrations/*.sql in name order, each once. Everything pending
// goes in one transaction, so a failed migration leaves nothing half-applied.
// Read from disk at runtime: the Docker image copies the folder
// next to server.js, and dev and tests run from the repo root.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type postgres from 'postgres';

// Arbitrary, fixed: serialises two processes starting against one database.
const MIGRATION_LOCK = 7_204_151;

export function migrationsDir(): string {
  return process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), 'db', 'migrations');
}

export function listMigrations(dir = migrationsDir()): Array<{ name: string; sql: string }> {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(dir, name), 'utf8') }));
}

/** Returns the names it applied this time. */
export async function migrate(sql: postgres.Sql, dir = migrationsDir()): Promise<string[]> {
  const pending = listMigrations(dir);
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`;
    await tx`
      CREATE TABLE IF NOT EXISTS schema_migration (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    const done = new Set((await tx<{ name: string }[]>`SELECT name FROM schema_migration`).map((r) => r.name));
    for (const m of pending) {
      if (done.has(m.name)) continue;
      await tx.unsafe(m.sql);
      await tx`INSERT INTO schema_migration (name) VALUES (${m.name})`;
      applied.push(m.name);
    }
  });
  return applied;
}
