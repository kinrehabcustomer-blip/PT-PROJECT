/**
 * Creates the PT Care tables in your Postgres (Neon) database.
 *
 *   npm run db:migrate              tables + default settings (empty clinic, ready for real data)
 *   npm run db:migrate -- --demo    also loads the demo patients, therapists and appointments
 *
 * Reads DATABASE_URL from the environment or .env.local. Safe to re-run: it
 * never drops or overwrites existing data.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

function loadEnv(): Record<string, string> {
  try {
    const env: Record<string, string> = {};
    for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].split(/\s+#/)[0].trim().replace(/^["']|["']$/g, "");
    }
    return env;
  } catch {
    return {};
  }
}

async function main() {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? loadEnv().DATABASE_URL ?? loadEnv().POSTGRES_URL;
  if (!url) {
    console.error("ไม่พบ DATABASE_URL — ใส่ connection string ของ Neon ใน .env.local หรือ environment ก่อน");
    process.exit(1);
  }
  const demo = process.argv.includes("--demo");
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 15_000 });
  try {
    const host = new URL(url).host;
    console.log(`\nเชื่อมต่อ ${host} ...`);
    await pool.query("SELECT 1");

    await pool.query(readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));
    console.log("  ✔ สร้างตารางครบแล้ว");

    const existing = await pool.query("SELECT 1 FROM settings WHERE id = 1");
    if (existing.rowCount) {
      console.log("  • มีข้อมูลตั้งค่าอยู่แล้ว ไม่แตะต้องข้อมูลเดิม");
    } else if (demo) {
      // Import lazily so the plain migration does not need the app's path aliases.
      const { createPostgresRepository } = await import("../src/infrastructure/repositories/postgres-repository");
      const { seedData } = await import("../src/infrastructure/repositories/seed-data");
      const repo = createPostgresRepository({
        query: (t, p) => pool.query(t, p as unknown[]) as never,
        async transaction(fn) {
          const c = await pool.connect();
          try {
            await c.query("BEGIN");
            const r = await fn({ query: (t, p) => c.query(t, p as unknown[]) as never });
            await c.query("COMMIT");
            return r;
          } catch (e) {
            await c.query("ROLLBACK").catch(() => undefined);
            throw e;
          } finally {
            c.release();
          }
        },
      });
      await repo.transact(() => ({ result: { ok: true as const }, data: seedData }));
      console.log("  ✔ ใส่ข้อมูลตัวอย่าง (demo) แล้ว");
    } else {
      await pool.query("INSERT INTO settings (id, contact_phone) VALUES (1, '')");
      console.log("  ✔ สร้างค่าตั้งต้น (ฐานข้อมูลว่าง พร้อมใส่ข้อมูลจริง)");
    }

    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    console.log(`\nตารางในฐานข้อมูล (${rows.length}): ${rows.map((r) => r.table_name).join(", ")}\n`);
  } catch (error) {
    console.error("\nไม่สำเร็จ:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
