import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppData } from "@/domain/models";
import { seedData } from "@/infrastructure/repositories/seed-data";

const DB_PATH = path.join(process.cwd(), "data", "db.json");

// Serialises read-modify-write so concurrent requests in one server process
// cannot overwrite each other. Not safe across multiple processes/instances.
let queue: Promise<unknown> = Promise.resolve();

async function read(): Promise<AppData> {
  try {
    return JSON.parse(await fs.readFile(DB_PATH, "utf8")) as AppData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return seedData;
    throw error;
  }
}

async function write(data: AppData): Promise<void> {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, DB_PATH);
}

export function loadData(): Promise<AppData> {
  return read();
}

/** Runs `fn` against the latest data; persists the result when `fn` returns data. */
export function transact<T extends { ok: boolean }>(
  fn: (data: AppData) => Promise<{ result: T; data?: AppData }> | { result: T; data?: AppData },
): Promise<T> {
  const run = queue.then(async () => {
    const current = await read();
    const { result, data } = await fn(current);
    if (data) await write(data);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}
