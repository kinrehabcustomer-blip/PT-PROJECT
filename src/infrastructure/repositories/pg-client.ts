import { Pool } from "pg";
import type { SqlDb } from "@/infrastructure/repositories/postgres-repository";

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
}

const globalForPool = globalThis as unknown as { __ptPool?: Pool };

/** Shared pool. Kept small: serverless instances each open their own, and Neon's pooler fans them in. */
export function createPgDb(rawConnectionString: string): SqlDb {
  // pg already treats these modes as verify-full; saying so silences its deprecation warning without changing behaviour.
  const connectionString = rawConnectionString.replace(/sslmode=(require|prefer|verify-ca)(?=&|$)/, "sslmode=verify-full");
  const pool = (globalForPool.__ptPool ??= new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  }));
  pool.on("error", (error) => console.error("Postgres pool error", error));

  return {
    query: (text, params) => pool.query(text, params as unknown[]) as never,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: (text, params) => client.query(text, params as unknown[]) as never });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
