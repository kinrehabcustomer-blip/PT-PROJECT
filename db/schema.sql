-- PT Care schema (PostgreSQL / Neon). Safe to run more than once.
-- Apply with:  npm run db:migrate          (needs DATABASE_URL)
-- or paste this whole file into the Neon console > SQL Editor.

CREATE TABLE IF NOT EXISTS patients (
  seq bigserial UNIQUE,                       -- insertion order, so lists keep the order staff entered them
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  phone                 text NOT NULL,
  condition             text NOT NULL DEFAULT '',
  line_user_id          text,
  relative_line_user_id text,
  reminder              jsonb,                       -- per-patient override of the clinic reminder settings
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS therapists (
  seq bigserial UNIQUE,                       -- insertion order, so lists keep the order staff entered them
  id           text PRIMARY KEY,
  name         text NOT NULL,
  initials     text NOT NULL,
  color        text NOT NULL,
  phone        text NOT NULL,
  line_user_id text
);

CREATE TABLE IF NOT EXISTS courses (
  seq bigserial UNIQUE,                       -- insertion order, so lists keep the order staff entered them
  id             text PRIMARY KEY,
  patient_id     text NOT NULL REFERENCES patients (id),
  service_name   text NOT NULL,
  total_sessions integer NOT NULL CHECK (total_sessions > 0),
  used_sessions  integer NOT NULL CHECK (used_sessions >= 0),
  CHECK (used_sessions <= total_sessions)
);
CREATE INDEX IF NOT EXISTS courses_patient_idx ON courses (patient_id);

-- One row per deducted visit. position 0 is the newest.
CREATE TABLE IF NOT EXISTS course_history (
  id             text PRIMARY KEY,
  course_id      text NOT NULL REFERENCES courses (id),
  position       integer NOT NULL,
  appointment_id text NOT NULL,
  date           text NOT NULL,                      -- "YYYY-MM-DD HH:MM" as shown to staff
  therapist_name text NOT NULL,
  service_name   text NOT NULL,
  voided         boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS course_history_course_idx ON course_history (course_id, position);

CREATE TABLE IF NOT EXISTS appointments (
  seq bigserial UNIQUE,                       -- insertion order, so lists keep the order staff entered them
  id                 text PRIMARY KEY,
  patient_id         text NOT NULL REFERENCES patients (id),
  therapist_id       text NOT NULL REFERENCES therapists (id),
  course_id          text NOT NULL REFERENCES courses (id),
  date               text NOT NULL CHECK (date ~ '^\d{4}-\d{2}-\d{2}$'),
  time               text NOT NULL CHECK (time ~ '^\d{2}:\d{2}$'),
  service_name       text NOT NULL,
  location           text NOT NULL,
  address            text NOT NULL,
  map_url            text,
  status             text NOT NULL CHECK (status IN ('รอยืนยัน', 'ยืนยันแล้ว', 'เสร็จสิ้น', 'ไม่มาตามนัด', 'ยกเลิก')),
  acknowledged       boolean NOT NULL DEFAULT false,
  no_show_resolution text CHECK (no_show_resolution IN ('deducted', 'waived'))
);
CREATE INDEX IF NOT EXISTS appointments_date_idx ON appointments (date, time);
CREATE INDEX IF NOT EXISTS appointments_therapist_idx ON appointments (therapist_id, date);
CREATE INDEX IF NOT EXISTS appointments_course_idx ON appointments (course_id);

CREATE TABLE IF NOT EXISTS notifications (
  seq bigserial UNIQUE,                       -- insertion order, so lists keep the order staff entered them
  id             text PRIMARY KEY,
  dedupe_key     text NOT NULL,
  kind           text NOT NULL,
  audience       text NOT NULL CHECK (audience IN ('patient', 'therapist', 'admin')),
  recipient_id   text NOT NULL,
  appointment_id text,
  course_id      text,
  message        text NOT NULL,
  scheduled_at   timestamptz NOT NULL,
  status         text NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  sent_at        timestamptz,
  detail         text,
  attempts       integer,
  delivered_to   jsonb                                -- LINE ids that already received it (prevents duplicates on retry)
);
CREATE INDEX IF NOT EXISTS notifications_due_idx ON notifications (status, scheduled_at);
CREATE INDEX IF NOT EXISTS notifications_appointment_idx ON notifications (appointment_id);
CREATE INDEX IF NOT EXISTS notifications_dedupe_idx ON notifications (dedupe_key);

-- Append-only trail of every change to a course's counts.
CREATE TABLE IF NOT EXISTS course_audit (
  seq bigserial UNIQUE,                       -- insertion order, so lists keep the order staff entered them
  id        text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses (id),
  at        timestamptz NOT NULL,
  actor     text NOT NULL,
  action    text NOT NULL CHECK (action IN ('deduct', 'restore', 'adjust-total', 'adjust-used')),
  before    jsonb NOT NULL,
  after     jsonb NOT NULL,
  reason    text NOT NULL
);
CREATE INDEX IF NOT EXISTS course_audit_course_idx ON course_audit (course_id, at DESC);

CREATE TABLE IF NOT EXISTS users (
  seq bigserial UNIQUE,                       -- insertion order, so lists keep the order staff entered them
  id           text PRIMARY KEY,
  username     text NOT NULL UNIQUE,
  name         text NOT NULL,
  role         text NOT NULL CHECK (role IN ('admin', 'staff', 'therapist')),
  therapist_id text REFERENCES therapists (id),
  active       boolean NOT NULL DEFAULT true
);

-- Password hashes live apart from users so they are never loaded into app state.
CREATE TABLE IF NOT EXISTS credentials (
  user_id text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  hash    text NOT NULL
);

CREATE TABLE IF NOT EXISTS link_codes (
  code       text PRIMARY KEY,
  target     text NOT NULL CHECK (target IN ('patient', 'relative', 'therapist')),
  target_id  text NOT NULL,
  expires_at timestamptz NOT NULL
);

-- Exactly one row. Its presence also marks the database as initialised
-- (otherwise the app shows demo data until the first save).
CREATE TABLE IF NOT EXISTS settings (
  id               integer PRIMARY KEY CHECK (id = 1),
  channel          text NOT NULL DEFAULT 'LINE',
  evening_time     text NOT NULL DEFAULT '18:00',
  lead_hours       integer NOT NULL DEFAULT 2 CHECK (lead_hours IN (0, 1, 2)),
  patient_reminder text NOT NULL DEFAULT 'both' CHECK (patient_reminder IN ('evening', 'lead', 'both')),
  contact_phone    text NOT NULL DEFAULT ''
);

-- Operational helpers (login throttle, single-run dispatch lock).
CREATE TABLE IF NOT EXISTS rate_limits (
  key      text PRIMARY KEY,
  count    integer NOT NULL,
  reset_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS locks (
  name       text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
