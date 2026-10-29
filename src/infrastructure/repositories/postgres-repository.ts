import type {
  AppData,
  AppNotification,
  Appointment,
  CourseAuditEntry,
  CourseHistoryEntry,
  CareAssignment,
  LinkCode,
  LinkRequest,
  NotificationSettings,
  Patient,
  Therapist,
  TreatmentCourse,
  User,
} from "@/domain/models";
import { seedData } from "@/infrastructure/repositories/seed-data";

/**
 * PostgreSQL (Neon) storage. Each kind of record has its own table (see
 * db/schema.sql). The app still works on one AppData value, so a transaction
 * loads every table, runs the use case, and writes back only the rows that
 * changed. An advisory lock serialises writers, so concurrent requests on
 * different server instances can never overwrite each other.
 */

export interface SqlTx {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}
export interface SqlDb extends SqlTx {
  transaction<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T>;
}

const WRITE_LOCK_ID = 727_001;
const CHUNK = 40;

type Row = Record<string, unknown>;

interface Spec<T> {
  table: string;
  key: (item: T) => string;
  keyColumn: string;
  columns: string[];
  values: (item: T) => unknown[];
  fromRow: (row: Row) => T;
  list: (data: AppData) => T[];
  orderBy: string;
  /** Rows are inserted in reverse so a newest-first list gets increasing seq values. */
  reverseInsert?: boolean;
}

const nn = <T,>(value: T | null | undefined): T | undefined => (value === null || value === undefined ? undefined : value);
const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value));
const isoOpt = (value: unknown): string | undefined => (value === null || value === undefined ? undefined : iso(value));
const json = (value: unknown): string | null => (value === undefined || value === null ? null : JSON.stringify(value));

interface HistoryRow extends CourseHistoryEntry { courseId: string; position: number }

const patients: Spec<Patient> = {
  table: "patients", keyColumn: "id", key: (p) => p.id, orderBy: "seq",
  columns: ["id", "name", "phone", "condition", "line_user_id", "relative_line_user_id", "reminder"],
  values: (p) => [p.id, p.name, p.phone, p.condition, p.lineUserId ?? null, p.relativeLineUserId ?? null, json(p.reminder)],
  fromRow: (r) => ({
    id: r.id as string, name: r.name as string, phone: r.phone as string, condition: r.condition as string,
    lineUserId: nn(r.line_user_id as string | null), relativeLineUserId: nn(r.relative_line_user_id as string | null),
    reminder: nn(r.reminder as Patient["reminder"] | null),
  }),
  list: (d) => d.patients,
};

const therapists: Spec<Therapist> = {
  table: "therapists", keyColumn: "id", key: (t) => t.id, orderBy: "seq",
  columns: ["id", "name", "initials", "color", "phone", "line_user_id"],
  values: (t) => [t.id, t.name, t.initials, t.color, t.phone, t.lineUserId ?? null],
  fromRow: (r) => ({
    id: r.id as string, name: r.name as string, initials: r.initials as string, color: r.color as string,
    phone: r.phone as string, lineUserId: nn(r.line_user_id as string | null),
  }),
  list: (d) => d.therapists,
};

const courses: Spec<TreatmentCourse> = {
  table: "courses", keyColumn: "id", key: (c) => c.id, orderBy: "seq",
  columns: ["id", "patient_id", "service_name", "total_sessions", "used_sessions"],
  values: (c) => [c.id, c.patientId, c.serviceName, c.totalSessions, c.usedSessions],
  fromRow: (r) => ({
    id: r.id as string, patientId: r.patient_id as string, serviceName: r.service_name as string,
    totalSessions: r.total_sessions as number, usedSessions: r.used_sessions as number, history: [],
  }),
  // History is stored in its own table; compare the course without it.
  list: (d) => d.courses.map((c) => ({ ...c, history: [] })),
};

const history: Spec<HistoryRow> = {
  table: "course_history", keyColumn: "id", key: (h) => h.id, orderBy: "course_id, position",
  columns: ["id", "course_id", "position", "appointment_id", "date", "therapist_name", "service_name", "voided"],
  values: (h) => [h.id, h.courseId, h.position, h.appointmentId, h.date, h.therapistName, h.serviceName, Boolean(h.voided)],
  fromRow: (r) => ({
    id: r.id as string, courseId: r.course_id as string, position: r.position as number,
    appointmentId: r.appointment_id as string, date: r.date as string, therapistName: r.therapist_name as string,
    serviceName: r.service_name as string, voided: r.voided ? true : undefined,
  }),
  list: (d) => d.courses.flatMap((c) => c.history.map((h, position) => ({ ...h, voided: h.voided ? true : undefined, courseId: c.id, position }))),
};

const appointments: Spec<Appointment> = {
  table: "appointments", keyColumn: "id", key: (a) => a.id, orderBy: "seq",
  columns: ["id", "patient_id", "therapist_id", "course_id", "date", "time", "service_name", "location", "address", "map_url", "status", "acknowledged", "no_show_resolution"],
  values: (a) => [a.id, a.patientId, a.therapistId, a.courseId, a.date, a.time, a.serviceName, a.location, a.address, a.mapUrl ?? null, a.status, a.acknowledged, a.noShowResolution ?? null],
  fromRow: (r) => ({
    id: r.id as string, patientId: r.patient_id as string, therapistId: r.therapist_id as string, courseId: r.course_id as string,
    date: r.date as string, time: r.time as string, serviceName: r.service_name as string, location: r.location as string,
    address: r.address as string, mapUrl: nn(r.map_url as string | null), status: r.status as Appointment["status"],
    acknowledged: r.acknowledged as boolean, noShowResolution: nn(r.no_show_resolution as Appointment["noShowResolution"] | null),
  }),
  list: (d) => d.appointments,
};

const notifications: Spec<AppNotification> = {
  table: "notifications", keyColumn: "id", key: (n) => n.id, orderBy: "seq",
  columns: ["id", "dedupe_key", "kind", "audience", "recipient_id", "appointment_id", "course_id", "message", "scheduled_at", "status", "sent_at", "detail", "attempts", "delivered_to"],
  values: (n) => [n.id, n.dedupeKey, n.kind, n.audience, n.recipientId, n.appointmentId ?? null, n.courseId ?? null, n.message, n.scheduledAt, n.status, n.sentAt ?? null, n.detail ?? null, n.attempts ?? null, json(n.deliveredTo)],
  fromRow: (r) => ({
    id: r.id as string, dedupeKey: r.dedupe_key as string, kind: r.kind as AppNotification["kind"],
    audience: r.audience as AppNotification["audience"], recipientId: r.recipient_id as string,
    appointmentId: nn(r.appointment_id as string | null), courseId: nn(r.course_id as string | null),
    message: r.message as string, scheduledAt: iso(r.scheduled_at), status: r.status as AppNotification["status"],
    sentAt: isoOpt(r.sent_at), detail: nn(r.detail as string | null), attempts: nn(r.attempts as number | null),
    deliveredTo: nn(r.delivered_to as string[] | null),
  }),
  list: (d) => d.notifications,
};

const audit: Spec<CourseAuditEntry> = {
  table: "course_audit", keyColumn: "id", key: (a) => a.id, orderBy: "seq DESC", reverseInsert: true,
  columns: ["id", "course_id", "at", "actor", "action", "before", "after", "reason"],
  values: (a) => [a.id, a.courseId, a.at, a.actor, a.action, json(a.before), json(a.after), a.reason],
  fromRow: (r) => ({
    id: r.id as string, courseId: r.course_id as string, at: iso(r.at), actor: r.actor as string,
    action: r.action as CourseAuditEntry["action"], before: r.before as CourseAuditEntry["before"],
    after: r.after as CourseAuditEntry["after"], reason: r.reason as string,
  }),
  list: (d) => d.courseAudit,
};

const users: Spec<User> = {
  table: "users", keyColumn: "id", key: (u) => u.id, orderBy: "seq",
  columns: ["id", "username", "name", "role", "therapist_id", "active"],
  values: (u) => [u.id, u.username, u.name, u.role, u.therapistId ?? null, u.active],
  fromRow: (r) => ({
    id: r.id as string, username: r.username as string, name: r.name as string, role: r.role as User["role"],
    therapistId: nn(r.therapist_id as string | null), active: r.active as boolean,
  }),
  list: (d) => d.users,
};

const linkCodes: Spec<LinkCode> = {
  table: "link_codes", keyColumn: "code", key: (c) => c.code, orderBy: "expires_at",
  columns: ["code", "target", "target_id", "expires_at"],
  values: (c) => [c.code, c.target, c.targetId, c.expiresAt],
  fromRow: (r) => ({ code: r.code as string, target: r.target as LinkCode["target"], targetId: r.target_id as string, expiresAt: iso(r.expires_at) }),
  list: (d) => d.linkCodes,
};

const linkRequests: Spec<LinkRequest> = {
  table: "link_requests", keyColumn: "id", key: (r) => r.id, orderBy: "requested_at",
  columns: ["id", "target", "target_id", "line_user_id", "display_name", "requested_at"],
  values: (r) => [r.id, r.target, r.targetId, r.lineUserId, r.displayName ?? null, r.requestedAt],
  fromRow: (r) => ({
    id: r.id as string, target: r.target as LinkRequest["target"], targetId: r.target_id as string,
    lineUserId: r.line_user_id as string, displayName: nn(r.display_name as string | null), requestedAt: iso(r.requested_at),
  }),
  list: (d) => d.linkRequests,
};

const assignments: Spec<CareAssignment> = {
  table: "therapist_patients", keyColumn: "id", key: (a) => a.id, orderBy: "seq",
  columns: ["id", "therapist_id", "patient_id"],
  values: (a) => [a.id, a.therapistId, a.patientId],
  fromRow: (r) => ({ id: r.id as string, therapistId: r.therapist_id as string, patientId: r.patient_id as string }),
  list: (d) => d.assignments,
};

// Parents before children when writing; the reverse when deleting.
const SPECS = [patients, therapists, courses, history, appointments, users, assignments, notifications, audit, linkCodes, linkRequests] as unknown as Array<Spec<unknown>>;

/** Key order and undefined fields must not matter when deciding whether a row changed. */
function canon(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

const EMPTY: AppData = {
  patients: [], therapists: [], courses: [], appointments: [], notifications: [], courseAudit: [], users: [], linkCodes: [], linkRequests: [], assignments: [],
  settings: undefined as unknown as NotificationSettings,
};

async function selectAll<T>(tx: SqlTx, spec: Spec<T>): Promise<T[]> {
  const { rows } = await tx.query(`SELECT * FROM ${spec.table} ORDER BY ${spec.orderBy}`);
  return rows.map((r) => spec.fromRow(r as Row));
}

async function readState(tx: SqlTx): Promise<{ data: AppData; initialized: boolean }> {
  const settingsRows = (await tx.query("SELECT * FROM settings WHERE id = 1")).rows as Row[];
  if (!settingsRows.length) return { data: seedData, initialized: false };
  const s = settingsRows[0];
  const settings: NotificationSettings = {
    channel: s.channel as "LINE", eveningTime: s.evening_time as string, leadHours: s.lead_hours as 0 | 1 | 2,
    patientReminder: s.patient_reminder as NotificationSettings["patientReminder"], contactPhone: s.contact_phone as string,
  };
  const courseRows = await selectAll(tx, courses);
  const historyRows = await selectAll(tx, history);
  const byCourse = new Map<string, CourseHistoryEntry[]>();
  for (const { courseId, position: _p, ...entry } of historyRows) {
    byCourse.set(courseId, [...(byCourse.get(courseId) ?? []), entry]);
  }
  return {
    initialized: true,
    data: {
      settings,
      patients: await selectAll(tx, patients),
      therapists: await selectAll(tx, therapists),
      courses: courseRows.map((c) => ({ ...c, history: byCourse.get(c.id) ?? [] })),
      appointments: await selectAll(tx, appointments),
      notifications: await selectAll(tx, notifications),
      courseAudit: await selectAll(tx, audit),
      users: await selectAll(tx, users),
      linkCodes: await selectAll(tx, linkCodes),
      linkRequests: await selectAll(tx, linkRequests),
      assignments: await selectAll(tx, assignments),
    },
  };
}

async function upsert<T>(tx: SqlTx, spec: Spec<T>, items: T[]): Promise<void> {
  const ordered = spec.reverseInsert ? [...items].reverse() : items;
  const cols = spec.columns;
  const update = cols.filter((c) => c !== spec.keyColumn).map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  for (let i = 0; i < ordered.length; i += CHUNK) {
    const chunk = ordered.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const tuples = chunk.map((item) => {
      const placeholders = spec.values(item).map((v) => { params.push(v); return `$${params.length}`; });
      return `(${placeholders.join(", ")})`;
    });
    await tx.query(
      `INSERT INTO ${spec.table} (${cols.join(", ")}) VALUES ${tuples.join(", ")} ` +
        `ON CONFLICT (${spec.keyColumn}) DO UPDATE SET ${update}`,
      params,
    );
  }
}

async function writeDiff(tx: SqlTx, before: AppData, after: AppData): Promise<void> {
  for (const spec of SPECS) {
    const old = new Map(spec.list(before).map((item) => [spec.key(item), canon(item)]));
    const next = spec.list(after);
    const changed = next.filter((item) => old.get(spec.key(item)) !== canon(item));
    if (changed.length) await upsert(tx, spec, changed);
  }
  // Rows that disappeared (pruned notifications, used or expired link codes), children first.
  for (const spec of [...SPECS].reverse()) {
    const keep = new Set(spec.list(after).map((item) => spec.key(item)));
    const gone = spec.list(before).map((item) => spec.key(item)).filter((k) => !keep.has(k));
    for (let i = 0; i < gone.length; i += 200) {
      await tx.query(`DELETE FROM ${spec.table} WHERE ${spec.keyColumn} = ANY($1::text[])`, [gone.slice(i, i + 200)]);
    }
  }
  if (!before.settings || canon(before.settings) !== canon(after.settings)) {
    const s = after.settings;
    await tx.query(
      `INSERT INTO settings (id, channel, evening_time, lead_hours, patient_reminder, contact_phone) VALUES (1, $1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET channel = EXCLUDED.channel, evening_time = EXCLUDED.evening_time,
         lead_hours = EXCLUDED.lead_hours, patient_reminder = EXCLUDED.patient_reminder, contact_phone = EXCLUDED.contact_phone`,
      [s.channel, s.eveningTime, s.leadHours, s.patientReminder, s.contactPhone],
    );
  }
}

export function createPostgresRepository(db: SqlDb) {
  return {
    async loadData(): Promise<AppData> {
      return db.transaction(async (tx) => {
        await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        return (await readState(tx)).data;
      });
    },

    /**
     * Runs `fn` against the latest data under a write lock and stores what
     * changed. Safe against concurrent requests; `fn` runs exactly once.
     */
    async transact<T extends { ok: boolean }>(
      fn: (data: AppData) => Promise<{ result: T; data?: AppData }> | { result: T; data?: AppData },
    ): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK_ID]);
        const { data: current, initialized } = await readState(tx);
        const { result, data } = await fn(current);
        if (data) await writeDiff(tx, initialized ? current : EMPTY, data);
        return result;
      });
    },

    async findUser(id: string): Promise<User | undefined> {
      const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [id]);
      return rows[0] ? users.fromRow(rows[0] as Row) : undefined;
    },

    async getHash(userId: string): Promise<string | undefined> {
      const { rows } = await db.query<{ hash: string }>("SELECT hash FROM credentials WHERE user_id = $1", [userId]);
      return rows[0]?.hash;
    },

    async setHash(userId: string, hash: string): Promise<void> {
      await db.query(
        "INSERT INTO credentials (user_id, hash) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET hash = EXCLUDED.hash",
        [userId, hash],
      );
    },

    /** Cross-instance lock so two dispatch runs cannot message the same person twice. */
    async tryLock<T>(name: string, ttlSeconds: number, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
      const got = await db.query(
        `INSERT INTO locks (name, expires_at) VALUES ($1, now() + make_interval(secs => $2))
         ON CONFLICT (name) DO UPDATE SET expires_at = EXCLUDED.expires_at WHERE locks.expires_at < now()
         RETURNING name`,
        [name, ttlSeconds],
      );
      if (!got.rows.length) return { ran: false };
      try {
        return { ran: true, value: await fn() };
      } finally {
        await db.query("DELETE FROM locks WHERE name = $1", [name]).catch(() => undefined);
      }
    },

    /** Counts an attempt; true once `key` exceeds `max` within the window. */
    async tooManyAttempts(key: string, max: number, windowSeconds: number): Promise<boolean> {
      const { rows } = await db.query<{ count: number }>(
        `INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN rate_limits.reset_at < now() THEN 1 ELSE rate_limits.count + 1 END,
           reset_at = CASE WHEN rate_limits.reset_at < now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
         RETURNING count`,
        [key, windowSeconds],
      );
      return rows[0].count > max;
    },

    async clearAttempts(key: string): Promise<void> {
      await db.query("DELETE FROM rate_limits WHERE key = $1", [key]);
    },
  };
}

export type PostgresRepository = ReturnType<typeof createPostgresRepository>;
