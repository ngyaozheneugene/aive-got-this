// Dispatch Coordinator v1.1
// Memory adapter for tests; Postgres when DATABASE_URL is set.

import { IDatabase } from './interface';
import { InMemoryDatabase } from './memory';
import { PostgresDatabase } from './postgres';

export * from './interface';
export * from './memory';
export * from './postgres';

let dbInstance: IDatabase | null = null;

export function getDatabase(): IDatabase {
  if (!dbInstance) {
    const useMemory = process.env.USE_MEMORY_DB === 'true' || process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL;
    if (useMemory) {
      dbInstance = new InMemoryDatabase();
    } else {
      dbInstance = new PostgresDatabase();
    }
  }
  return dbInstance;
}

export const db = getDatabase();
