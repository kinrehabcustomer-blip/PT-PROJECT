/**
 * Loads the demo clinic (invented therapists, patients, courses, appointments)
 * into the database that DATABASE_URL points to, keeping existing user
 * accounts and settings.
 *
 *   npm run db:seed-demo
 *
 * Refuses to run if the database already holds patients, therapists, courses
 * or appointments, so it can never overwrite real data.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { createPostgresRepository } from "../src/infrastructure/repositories/postgres-repository";
import { seedData } from "../src/infrastructure/repositories/seed-data";

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
    console.error("ไม่พบ DATABASE_URL");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 15_000 });
  try {
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

    const outcome = await repo.transact<{ ok: boolean; used: number }>((current) => {
      const used = current.patients.length + current.therapists.length + current.courses.length + current.appointments.length;
      if (used > 0) return { result: { ok: false, used } };
      const phone = current.settings?.contactPhone;
      return {
        result: { ok: true, used: 0 },
        data: {
          ...seedData,
          users: current.users,
          linkCodes: current.linkCodes,
          settings: { ...seedData.settings, ...(current.settings ?? {}), contactPhone: phone || seedData.settings.contactPhone },
        },
      };
    });

    if (!outcome.ok) {
      console.error(`\nฐานข้อมูลมีข้อมูลอยู่แล้ว (${outcome.used} รายการ) จึงไม่ใส่ข้อมูลตัวอย่างทับ\n`);
      process.exitCode = 1;
      return;
    }
    const d = await repo.loadData();
    console.log(
      `\n✔ ใส่ข้อมูลตัวอย่างแล้ว: นักกายภาพ ${d.therapists.length}, ผู้รับบริการ ${d.patients.length}, ` +
        `คอร์ส ${d.courses.length}, นัดหมาย ${d.appointments.length} (บัญชีผู้ใช้เดิม ${d.users.length} บัญชี ไม่ถูกแตะต้อง)\n`,
    );
  } catch (error) {
    console.error("\nไม่สำเร็จ:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
