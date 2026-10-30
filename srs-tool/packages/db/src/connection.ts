import { Pool, type PoolConfig } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export type DatabaseInstance = NodePgDatabase<typeof schema>;

export interface DbConfig {
  connectionString?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

/**
 * Creates a configured PostgreSQL connection pool.
 */
export function createDbPool(config: DbConfig = {}): Pool {
  const connectionString =
    config.connectionString ||
    process.env['DATABASE_URL'] ||
    'postgres://srs:srs@localhost:5433/srsdb';

  const poolConfig: PoolConfig = {
    connectionString,
    max: config.max ?? 10,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30000,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 3000,
  };

  return new Pool(poolConfig);
}

/**
 * Creates a Drizzle ORM client attached to the connection pool.
 */
export function createDb(pool: Pool): DatabaseInstance {
  return drizzle(pool, { schema });
}

/**
 * Helper to run queries inside a transaction with project-level Row Level Security context.
 */
export async function withProjectContext<T>(
  pool: Pool,
  projectId: string,
  fn: (db: DatabaseInstance) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Set local RLS variable for tenant isolation
    await client.query('SELECT set_config($1, $2, true)', ['app.current_project_id', projectId]);
    const db = drizzle(client, { schema });
    const result = await fn(db);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Executes initial SQL migration to ensure all extensions, tables, indexes, and RLS policies exist.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const fs = await import('fs');
    const path = await import('path');
    
    // Resolve migration path
    const migrationPath = path.resolve(__dirname, '..', 'migrations', '0000_initial_schema.sql');
    if (fs.existsSync(migrationPath)) {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      await client.query(sql);
    }
  } catch (err: any) {
    // If running in an environment where file path is different, don't crash, log error
    console.warn(`[DB Migration] Notice: ${err.message}`);
  } finally {
    client.release();
  }
}

