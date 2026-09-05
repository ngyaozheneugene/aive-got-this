// Dispatch Coordinator Agent v0.4
// Database Module Entrypoint
// Selects InMemoryDatabase (for local/testing) or PostgresDatabase (for RDS/Docker) based on environment.

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
