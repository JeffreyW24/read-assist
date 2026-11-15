// The database. It's SQLite (via libSQL), so:
//   • on your laptop it's a single file: read-assist/data/read-assist.db (no setup)
//   • when the site is hosted, set DATABASE_URL (+ DATABASE_AUTH_TOKEN) to a free Turso
//     database and the exact same code talks to it over the network.
// The first time it starts, anything in the old data/db.json is copied in, so no test data is lost.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createClient, type Client, type InStatement, type Row } from "@libsql/client";
import type { ClassDigest, Course, LessonPlan, Reading, ResumeState, Session, SessionStatus, User, WebReading } from "./types";
import { countWords, toParagraphs } from "./text";
import { SAMPLE_TEXT, SAMPLE_TITLE } from "./sample";
import { normalizeAi, normalizeReport } from "./validate";

/** A list of strings from a JSON column (anything else in it is dropped). */
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Saved recall answers, keeping only well-formed ones. */
function recallOf(v: unknown): Session["recall"] {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const out: NonNullable<Session["recall"]> = {};
  for (const [k, r] of Object.entries(v as Record<string, unknown>)) {
    const o = r as { text?: unknown; savedAt?: unknown } | null;
    if (o && typeof o.text === "string") out[k] = { text: o.text, savedAt: typeof o.savedAt === "string" ? o.savedAt : "" };
  }
  return Object.keys(out).length ? out : undefined;
}

const DATA_DIR = path.join(process.cwd(), "data");
const LEGACY_JSON = path.join(DATA_DIR, "db.json");

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

function makeJoinCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (const b of randomBytes(6)) code += alphabet[b % alphabet.length];
  return code;
}

// ---------- connection + schema ----------
// Articles read on other sites, imported from the browser extension (see WebReading).
const WEB_READINGS_SCHEMA = `CREATE TABLE IF NOT EXISTS web_readings (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), url TEXT NOT NULL, title TEXT NOT NULL,
     site TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, imported_at TEXT NOT NULL,
     coverage_pct REAL NOT NULL, active_sec REAL NOT NULL, data TEXT NOT NULL, UNIQUE (user_id, url))`;
// Each student's saved eye-tracking calibration (see lib/gaze/savedCalibration.ts), as JSON.
const CALIBRATIONS_SCHEMA = `CREATE TABLE IF NOT EXISTS calibrations (
     user_id TEXT PRIMARY KEY REFERENCES users(id), data TEXT NOT NULL, updated_at TEXT NOT NULL)`;
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL,
     password_hash TEXT, demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, dyslexia_font INTEGER NOT NULL DEFAULT 0,
     username TEXT, recovery_hash TEXT)`,
  `CREATE TABLE IF NOT EXISTS courses (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL, term TEXT NOT NULL DEFAULT '',
     professor_id TEXT NOT NULL REFERENCES users(id), join_code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS enrollments (
     course_id TEXT NOT NULL REFERENCES courses(id), user_id TEXT NOT NULL REFERENCES users(id),
     joined_at TEXT NOT NULL, PRIMARY KEY (course_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS readings (
     id TEXT PRIMARY KEY, title TEXT NOT NULL, paragraphs TEXT NOT NULL, word_count INTEGER NOT NULL,
     owner_id TEXT NOT NULL REFERENCES users(id), course_id TEXT REFERENCES courses(id), due_date TEXT,
     instructions TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS readings_course ON readings(course_id)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY, reading_id TEXT NOT NULL REFERENCES readings(id), user_id TEXT NOT NULL REFERENCES users(id),
     started_at TEXT NOT NULL, ended_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'done', sittings INTEGER NOT NULL DEFAULT 1,
     report TEXT NOT NULL, ai TEXT, recall TEXT, resume TEXT, save_id TEXT)`,
  `CREATE INDEX IF NOT EXISTS sessions_reading ON sessions(reading_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS digests (
     reading_id TEXT PRIMARY KEY REFERENCES readings(id), text TEXT NOT NULL, generated_by TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS lesson_plans (
     reading_id TEXT PRIMARY KEY REFERENCES readings(id), text TEXT NOT NULL, generated_by TEXT NOT NULL,
     created_at TEXT NOT NULL, based_on_sessions INTEGER NOT NULL)`,
  WEB_READINGS_SCHEMA,
  CALIBRATIONS_SCHEMA,
  // Gemini calls per user, for a simple rate limit (see takeAiCall).
  `CREATE TABLE IF NOT EXISTS ai_calls (user_id TEXT NOT NULL, at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS ai_calls_user ON ai_calls(user_id, at)`,
  // Signed-in browsers. The cookie names one of these rows, so signing out (or changing the
  // password) can cut a session off for good, not just delete the cookie in one browser.
  `CREATE TABLE IF NOT EXISTS auth_sessions (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id)`,
  // Wrong recovery-code tries, to stop guessing (see "Forgot password").
  `CREATE TABLE IF NOT EXISTS recovery_attempts (user_id TEXT NOT NULL, at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS recovery_attempts_user ON recovery_attempts(user_id, at)`,
];

// Columns added to existing tables after they were first created. CREATE TABLE IF NOT EXISTS
// doesn't touch a table that's already there, so older databases get them here.
const ADDED_COLUMNS: { table: string; column: string; def: string }[] = [
  { table: "users", column: "dyslexia_font", def: "INTEGER NOT NULL DEFAULT 0" },
  { table: "users", column: "username", def: "TEXT" },
  { table: "users", column: "recovery_hash", def: "TEXT" },
  { table: "sessions", column: "status", def: "TEXT NOT NULL DEFAULT 'done'" },
  { table: "sessions", column: "sittings", def: "INTEGER NOT NULL DEFAULT 1" },
  { table: "sessions", column: "resume", def: "TEXT" },
  { table: "sessions", column: "save_id", def: "TEXT" },
];
// Needs save_id, so it runs after the columns are added.
const SAVE_ID_INDEX = `CREATE UNIQUE INDEX IF NOT EXISTS sessions_save ON sessions(user_id, save_id) WHERE save_id IS NOT NULL`;

async function addMissingColumns(c: Client) {
  for (const table of new Set(ADDED_COLUMNS.map((a) => a.table))) {
    const { rows } = await c.execute(`PRAGMA table_info(${table})`);
    const have = new Set(rows.map((r) => String(r.name)));
    for (const a of ADDED_COLUMNS)
      if (a.table === table && !have.has(a.column))
        await c.execute(`ALTER TABLE ${a.table} ADD COLUMN ${a.column} ${a.def}`).catch((e) => {
          // Another server instance starting at the same moment may have just added it.
          if (!/duplicate column/i.test(String(e?.message ?? e))) throw e;
        });
  }
  await c.execute(SAVE_ID_INDEX);
  await backfillUsernames(c);
}

// ---------- usernames ----------
// People sign in with a username. Accounts made before usernames existed get one from their
// email (the part before the @), made unique with a number when needed.
export const USERNAME_RULE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

/** A username as stored: trimmed and lowercase (usernames aren't case-sensitive). */
export const normalizeUsername = (u: string) => u.trim().toLowerCase();

async function backfillUsernames(c: Client) {
  const { rows } = await c.execute("SELECT id, email FROM users WHERE username IS NULL OR username = ''");
  if (rows.length) {
    const taken = new Set((await c.execute("SELECT username FROM users WHERE username IS NOT NULL")).rows.map((r) => String(r.username)));
    for (const r of rows) {
      let base = String(r.email).split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+/, "").slice(0, 26);
      if (base.length < 3) base = (base + "user").slice(0, 26);
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
      taken.add(name);
      await c.execute({ sql: "UPDATE users SET username = ? WHERE id = ?", args: [name, String(r.id)] });
    }
  }
  await c.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(username)");
}

const g = globalThis as unknown as { __raClient?: Client; __raReady?: Promise<void> };

function client(): Client {
  if (!g.__raClient) {
    const url = process.env.DATABASE_URL;
    if (!url) mkdirSync(DATA_DIR, { recursive: true });
    g.__raClient = createClient({
      url: url || `file:${path.join(DATA_DIR, "read-assist.db")}`,
      authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
    });
  }
  return g.__raClient;
}

async function db(): Promise<Client> {
  g.__raReady ??= init().catch((e) => {
    g.__raReady = undefined; // retry next request
    throw e;
  });
  await g.__raReady;
  return client();
}

async function init() {
  const c = client();
  await c.batch(SCHEMA, "write");
  await addMissingColumns(c);
  const { rows } = await c.execute("SELECT COUNT(*) AS n FROM users");
  if (Number(rows[0].n) > 0) return;
  if (existsSync(LEGACY_JSON)) await importLegacyJson(c);
  else await seed(c);
  await backfillUsernames(c);
}

// ---------- row mappers ----------
/** A JSON column, or the fallback when it's empty or damaged (a bad row must never crash a page). */
const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    console.error("[db] unreadable JSON in a row; using a default");
    return fallback;
  }
};
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

function toUser(r: Row): User {
  return { id: String(r.id), name: String(r.name), username: String(r.username ?? ""), email: String(r.email), role: r.role as User["role"], createdAt: String(r.created_at), demo: !!Number(r.demo), dyslexiaFont: !!Number(r.dyslexia_font ?? 0), hasRecoveryCode: !!r.recovery_hash };
}
function toCourse(r: Row): Course {
  return {
    id: String(r.id), name: String(r.name), code: String(r.code), term: String(r.term),
    professorId: String(r.professor_id), joinCode: String(r.join_code), createdAt: String(r.created_at),
  };
}
function toReading(r: Row): Reading {
  return {
    id: String(r.id), title: String(r.title), paragraphs: strings(json<unknown>(r.paragraphs, [])), wordCount: Number(r.word_count),
    ownerId: String(r.owner_id), courseId: str(r.course_id), dueDate: str(r.due_date), instructions: String(r.instructions ?? ""),
    source: r.source as Reading["source"], createdAt: String(r.created_at),
  };
}
function toSession(r: Row, withResume = false): Session {
  return {
    id: String(r.id), readingId: String(r.reading_id), userId: String(r.user_id), startedAt: String(r.started_at),
    endedAt: String(r.ended_at), status: (r.status as SessionStatus) ?? "done", sittings: Number(r.sittings ?? 1),
    report: normalizeReport(json<unknown>(r.report, null)), ai: normalizeAi(json<unknown>(r.ai, null)), recall: recallOf(json<unknown>(r.recall, undefined)),
    resume: withResume ? json<ResumeState | null>(r.resume, null) : undefined,
  };
}
// The resume blob can be large (one number per word); only load it when needed.
const SESSION_COLS = "id, reading_id, user_id, started_at, ended_at, status, sittings, report, ai, recall";

// ---------- seed / import ----------
async function seed(c: Client) {
  const now = new Date().toISOString();
  const paragraphs = toParagraphs(SAMPLE_TEXT);
  // Due in 5 days, stored as noon UTC on that calendar day (see formatDueDate).
  const due = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) + "T12:00:00.000Z";
  await c.batch(
    [
      { sql: "INSERT INTO users (id,name,email,username,role,demo,created_at) VALUES (?,?,?,?,?,1,?)", args: ["user_demo_prof", "Prof. Rivera", "prof@demo.edu", "prof.rivera", "professor", now] },
      { sql: "INSERT INTO users (id,name,email,username,role,demo,created_at) VALUES (?,?,?,?,?,1,?)", args: ["user_demo_student", "Sam Student", "student@demo.edu", "sam.student", "student", now] },
      {
        sql: "INSERT INTO courses (id,name,code,term,professor_id,join_code,created_at) VALUES (?,?,?,?,?,?,?)",
        args: ["course_demo", "Cognitive Science of Learning", "PSYC 214", "Fall 2026", "user_demo_prof", "READ01", now],
      },
      { sql: "INSERT INTO enrollments (course_id,user_id,joined_at) VALUES (?,?,?)", args: ["course_demo", "user_demo_student", now] },
      {
        sql: "INSERT INTO readings (id,title,paragraphs,word_count,owner_id,course_id,due_date,instructions,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        args: [
          "reading_demo", SAMPLE_TITLE, JSON.stringify(paragraphs), countWords(paragraphs), "user_demo_prof", "course_demo", due,
          "Read before Thursday's lecture on attention. Focus on regressions and return sweeps.", "sample", now,
        ],
      },
    ],
    "write",
  );
}

interface LegacyDb {
  users: User[];
  courses: Course[];
  enrollments: { courseId: string; userId: string; joinedAt: string }[];
  readings: Reading[];
  sessions: Session[];
  digests?: ClassDigest[];
}

async function importLegacyJson(c: Client) {
  const d = JSON.parse(readFileSync(LEGACY_JSON, "utf8")) as LegacyDb;
  const stmts: InStatement[] = [];
  // Accounts from the old demo had no passwords, so they stay one-click "demo" accounts.
  for (const u of d.users)
    stmts.push({ sql: "INSERT INTO users (id,name,email,role,demo,created_at) VALUES (?,?,?,?,1,?)", args: [u.id, u.name, u.email, u.role, u.createdAt] });
  if (!d.users.some((u) => u.email === "student@demo.edu")) {
    stmts.push({
      sql: "INSERT INTO users (id,name,email,role,demo,created_at) VALUES (?,?,?,?,1,?)",
      args: ["user_demo_student", "Sam Student", "student@demo.edu", "student", new Date().toISOString()],
    });
  }
  for (const x of d.courses)
    stmts.push({
      sql: "INSERT INTO courses (id,name,code,term,professor_id,join_code,created_at) VALUES (?,?,?,?,?,?,?)",
      args: [x.id, x.name, x.code, x.term, x.professorId, x.joinCode, x.createdAt],
    });
  if (!d.users.some((u) => u.email === "student@demo.edu") && d.courses.some((x) => x.id === "course_demo"))
    stmts.push({ sql: "INSERT OR IGNORE INTO enrollments (course_id,user_id,joined_at) VALUES ('course_demo','user_demo_student',?)", args: [new Date().toISOString()] });
  for (const e of d.enrollments)
    stmts.push({ sql: "INSERT OR IGNORE INTO enrollments (course_id,user_id,joined_at) VALUES (?,?,?)", args: [e.courseId, e.userId, e.joinedAt] });
  for (const r of d.readings)
    stmts.push({
      sql: "INSERT INTO readings (id,title,paragraphs,word_count,owner_id,course_id,due_date,instructions,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: [r.id, r.title, JSON.stringify(r.paragraphs), r.wordCount, r.ownerId, r.courseId, r.dueDate, r.instructions ?? "", r.source, r.createdAt],
    });
  for (const s of d.sessions)
    stmts.push({
      sql: "INSERT INTO sessions (id,reading_id,user_id,started_at,ended_at,status,sittings,report,ai,recall) VALUES (?,?,?,?,?,'done',1,?,?,?)",
      args: [s.id, s.readingId, s.userId, s.startedAt, s.endedAt, JSON.stringify(s.report), s.ai ? JSON.stringify(s.ai) : null, s.recall ? JSON.stringify(s.recall) : null],
    });
  for (const x of d.digests ?? [])
    stmts.push({ sql: "INSERT INTO digests (reading_id,text,generated_by,created_at) VALUES (?,?,?,?)", args: [x.readingId, x.text, x.generatedBy, x.createdAt] });
  await c.batch(stmts, "write");
  console.log(`[db] imported data/db.json: ${d.users.length} users, ${d.courses.length} courses, ${d.readings.length} readings, ${d.sessions.length} sessions`);
}

/** A per-install secret (used to sign login cookies when AUTH_SECRET isn't set). */
export async function getOrCreateSecret(): Promise<string> {
  const c = await db();
  const { rows } = await c.execute("SELECT value FROM meta WHERE key = 'auth_secret'");
  if (rows[0]) return String(rows[0].value);
  const secret = randomBytes(32).toString("hex");
  await c.execute({ sql: "INSERT OR IGNORE INTO meta (key, value) VALUES ('auth_secret', ?)", args: [secret] });
  const again = await c.execute("SELECT value FROM meta WHERE key = 'auth_secret'");
  return String(again.rows[0].value);
}

// ---------- Users ----------
export async function getUser(id: string | undefined | null): Promise<User | null> {
  if (!id) return null;
  const { rows } = await (await db()).execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
  return rows[0] ? toUser(rows[0]) : null;
}

export type UserWithPassword = User & { passwordHash: string | null };

export async function getUserByUsername(username: string): Promise<UserWithPassword | null> {
  const { rows } = await (await db()).execute({ sql: "SELECT * FROM users WHERE username = ?", args: [normalizeUsername(username)] });
  return rows[0] ? { ...toUser(rows[0]), passwordHash: str(rows[0].password_hash) } : null;
}

/**
 * The account someone is signing in to. Usernames are the normal way; accounts made when the
 * app used emails can still sign in with that email.
 */
export async function getUserForSignIn(login: string): Promise<UserWithPassword | null> {
  const v = login.trim().toLowerCase();
  const { rows } = await (await db()).execute({
    sql: v.includes("@") ? "SELECT * FROM users WHERE email = ?" : "SELECT * FROM users WHERE username = ?",
    args: [v],
  });
  return rows[0] ? { ...toUser(rows[0]), passwordHash: str(rows[0].password_hash) } : null;
}

/** Creates the account, or returns null when the username is already taken (even by a sign-up that raced this one). */
export async function createUser(name: string, username: string, role: User["role"], passwordHash: string | null): Promise<User | null> {
  const u = normalizeUsername(username);
  const id = newId("user");
  // There's no email any more; the old column still needs a unique value. ".invalid" can never be a real address.
  const user: User = { id, name: name.trim(), username: u, email: `${id}@no-email.invalid`, role, createdAt: new Date().toISOString(), demo: false };
  const res = await (await db()).execute({
    sql: "INSERT INTO users (id,name,email,username,role,password_hash,demo,created_at) VALUES (?,?,?,?,?,?,0,?) ON CONFLICT DO NOTHING",
    args: [user.id, user.name, user.email, user.username, user.role, passwordHash, user.createdAt],
  });
  return res.rowsAffected > 0 ? user : null;
}

// ---------- Sign-in sessions and passwords ----------
/** Start a sign-in session; returns its id (what the cookie carries). Old expired ones are cleared. */
export async function createAuthSession(userId: string, maxAgeSec: number): Promise<string> {
  const id = randomBytes(24).toString("base64url");
  const now = new Date();
  await (await db()).batch(
    [
      { sql: "INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)", args: [id, userId, now.toISOString(), new Date(now.getTime() + maxAgeSec * 1000).toISOString()] },
      { sql: "DELETE FROM auth_sessions WHERE expires_at < ?", args: [now.toISOString()] },
    ],
    "write",
  );
  return id;
}

/** The user a still-valid sign-in session belongs to, or null. */
export async function userForAuthSession(sessionId: string): Promise<User | null> {
  const { rows } = await (await db()).execute({
    sql: "SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?",
    args: [sessionId, new Date().toISOString()],
  });
  return rows[0] ? toUser(rows[0]) : null;
}

export async function deleteAuthSession(sessionId: string) {
  await (await db()).execute({ sql: "DELETE FROM auth_sessions WHERE id = ?", args: [sessionId] });
}

/** Sign a user out everywhere, except (optionally) the session they're using right now. */
export async function deleteAuthSessionsForUser(userId: string, exceptSessionId: string | null = null) {
  await (await db()).execute({
    sql: "DELETE FROM auth_sessions WHERE user_id = ? AND id != ?",
    args: [userId, exceptSessionId ?? ""],
  });
}

export async function getPasswordHash(userId: string): Promise<string | null> {
  const { rows } = await (await db()).execute({ sql: "SELECT password_hash FROM users WHERE id = ?", args: [userId] });
  return rows[0] ? str(rows[0].password_hash) : null;
}

/** Set a new password (real accounts only: shared demo accounts never get one). */
export async function setPasswordHash(userId: string, passwordHash: string) {
  await (await db()).execute({ sql: "UPDATE users SET password_hash = ? WHERE id = ? AND demo = 0", args: [passwordHash, userId] });
}

/** The stored (hashed) recovery code, if the account has one. */
export async function getRecoveryHash(userId: string): Promise<string | null> {
  const { rows } = await (await db()).execute({ sql: "SELECT recovery_hash FROM users WHERE id = ?", args: [userId] });
  return rows[0] ? str(rows[0].recovery_hash) : null;
}

/** Give the account a new recovery code (by its hash), replacing any old one. Real accounts only. */
export async function setRecoveryHash(userId: string, hash: string) {
  await (await db()).execute({ sql: "UPDATE users SET recovery_hash = ? WHERE id = ? AND demo = 0", args: [hash, userId] });
}

/** Wrong recovery-code tries for this account since a moment. */
export async function countRecoveryAttemptsSince(userId: string, sinceIso: string): Promise<number> {
  const { rows } = await (await db()).execute({ sql: "SELECT COUNT(*) AS n FROM recovery_attempts WHERE user_id = ? AND at > ?", args: [userId, sinceIso] });
  return Number(rows[0].n);
}

export async function recordRecoveryAttempt(userId: string) {
  const now = new Date();
  await (await db()).batch(
    [
      { sql: "INSERT INTO recovery_attempts (user_id, at) VALUES (?, ?)", args: [userId, now.toISOString()] },
      { sql: "DELETE FROM recovery_attempts WHERE at < ?", args: [new Date(now.getTime() - 86_400_000).toISOString()] },
    ],
    "write",
  );
}

export async function clearRecoveryAttempts(userId: string) {
  await (await db()).execute({ sql: "DELETE FROM recovery_attempts WHERE user_id = ?", args: [userId] });
}

/** Save a user's display settings (see the Settings page). */
export async function saveUserSettings(id: string, settings: { dyslexiaFont: boolean }) {
  await (await db()).execute({ sql: "UPDATE users SET dyslexia_font = ? WHERE id = ?", args: [settings.dyslexiaFont ? 1 : 0, id] });
}

export async function demoUsers(): Promise<User[]> {
  const { rows } = await (await db()).execute("SELECT * FROM users WHERE demo = 1 ORDER BY role, created_at");
  return rows.map(toUser);
}

// ---------- Courses ----------
export async function coursesForUser(user: User): Promise<Course[]> {
  const c = await db();
  const { rows } =
    user.role === "professor"
      ? await c.execute({ sql: "SELECT * FROM courses WHERE professor_id = ? ORDER BY created_at", args: [user.id] })
      : await c.execute({
          sql: "SELECT c.* FROM courses c JOIN enrollments e ON e.course_id = c.id WHERE e.user_id = ? ORDER BY e.joined_at",
          args: [user.id],
        });
  return rows.map(toCourse);
}

export async function getCourse(id: string): Promise<Course | null> {
  const { rows } = await (await db()).execute({ sql: "SELECT * FROM courses WHERE id = ?", args: [id] });
  return rows[0] ? toCourse(rows[0]) : null;
}

export async function createCourse(professorId: string, name: string, code: string, term: string): Promise<Course> {
  const c = await db();
  for (let attempt = 0; ; attempt++) {
    const course: Course = {
      id: newId("course"), name: name.trim(), code: code.trim(), term: term.trim(), professorId,
      joinCode: makeJoinCode(), createdAt: new Date().toISOString(),
    };
    try {
      await c.execute({
        sql: "INSERT INTO courses (id,name,code,term,professor_id,join_code,created_at) VALUES (?,?,?,?,?,?,?)",
        args: [course.id, course.name, course.code, course.term, professorId, course.joinCode, course.createdAt],
      });
      return course;
    } catch (e) {
      if (attempt >= 4) throw e; // join code collision: try another code
    }
  }
}

export async function joinCourse(userId: string, joinCode: string): Promise<Course | null> {
  const c = await db();
  const { rows } = await c.execute({ sql: "SELECT * FROM courses WHERE join_code = ?", args: [joinCode.trim().toUpperCase()] });
  if (!rows[0]) return null;
  const course = toCourse(rows[0]);
  if (course.professorId === userId) return course;
  await c.execute({
    sql: "INSERT OR IGNORE INTO enrollments (course_id,user_id,joined_at) VALUES (?,?,?)",
    args: [course.id, userId, new Date().toISOString()],
  });
  return course;
}

export async function isEnrolled(userId: string, courseId: string): Promise<boolean> {
  const { rows } = await (await db()).execute({ sql: "SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?", args: [userId, courseId] });
  return rows.length > 0;
}

export async function studentsInCourse(courseId: string): Promise<User[]> {
  const { rows } = await (await db()).execute({
    sql: "SELECT u.* FROM users u JOIN enrollments e ON e.user_id = u.id WHERE e.course_id = ? ORDER BY u.name COLLATE NOCASE",
    args: [courseId],
  });
  return rows.map(toUser);
}

export async function studentCounts(courseIds: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (!courseIds.length) return m;
  const { rows } = await (await db()).execute({
    sql: `SELECT course_id, COUNT(*) AS n FROM enrollments WHERE course_id IN (${courseIds.map(() => "?").join(",")}) GROUP BY course_id`,
    args: courseIds,
  });
  for (const r of rows) m.set(String(r.course_id), Number(r.n));
  return m;
}

/** Can this user see this course at all? */
export async function canViewCourse(user: User, course: Course): Promise<boolean> {
  return course.professorId === user.id || (await isEnrolled(user.id, course.id));
}

// ---------- Readings ----------
export async function getReading(id: string): Promise<Reading | null> {
  const { rows } = await (await db()).execute({ sql: "SELECT * FROM readings WHERE id = ?", args: [id] });
  return rows[0] ? toReading(rows[0]) : null;
}

export async function readingsForCourse(courseId: string): Promise<Reading[]> {
  const { rows } = await (await db()).execute({
    sql: "SELECT * FROM readings WHERE course_id = ? ORDER BY COALESCE(due_date, '9'), created_at",
    args: [courseId],
  });
  return rows.map(toReading);
}

export async function readingsForCourses(courseIds: string[]): Promise<Reading[]> {
  if (!courseIds.length) return [];
  const { rows } = await (await db()).execute({
    sql: `SELECT * FROM readings WHERE course_id IN (${courseIds.map(() => "?").join(",")}) ORDER BY COALESCE(due_date, '9'), created_at`,
    args: courseIds,
  });
  return rows.map(toReading);
}

export async function personalReadings(userId: string): Promise<Reading[]> {
  const { rows } = await (await db()).execute({
    sql: "SELECT * FROM readings WHERE owner_id = ? AND course_id IS NULL ORDER BY created_at DESC",
    args: [userId],
  });
  return rows.map(toReading);
}

export async function canViewReading(user: User, reading: Reading): Promise<boolean> {
  if (reading.ownerId === user.id) return true;
  if (!reading.courseId) return false;
  const course = await getCourse(reading.courseId);
  return !!course && (await canViewCourse(user, course));
}

export async function createReading(input: Omit<Reading, "id" | "createdAt" | "wordCount">): Promise<Reading> {
  const reading: Reading = { ...input, id: newId("reading"), wordCount: countWords(input.paragraphs), createdAt: new Date().toISOString() };
  await (await db()).execute({
    sql: "INSERT INTO readings (id,title,paragraphs,word_count,owner_id,course_id,due_date,instructions,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    args: [
      reading.id, reading.title, JSON.stringify(reading.paragraphs), reading.wordCount, reading.ownerId, reading.courseId,
      reading.dueDate, reading.instructions, reading.source, reading.createdAt,
    ],
  });
  return reading;
}

/** Change a reading's details after posting (the text itself stays, so student data still fits it). */
export async function updateReadingDetails(id: string, d: { title: string; dueDate: string | null; instructions: string }) {
  await (await db()).execute({
    sql: "UPDATE readings SET title = ?, due_date = ?, instructions = ? WHERE id = ?",
    args: [d.title, d.dueDate, d.instructions, id],
  });
}

// ---------- Sessions ----------
/**
 * Saves a new session. `saveId` identifies this save from the browser: if the same save was
 * already stored (a retry after a lost response, a double submit), nothing new is written and
 * the session that holds it is returned.
 */
export async function createSession(input: Omit<Session, "id">, saveId: string | null = null): Promise<Session> {
  const session: Session = { ...input, id: newId("session") };
  const c = await db();
  const res = await c.execute({
    sql: `INSERT INTO sessions (id,reading_id,user_id,started_at,ended_at,status,sittings,report,ai,recall,resume,save_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT (user_id, save_id) WHERE save_id IS NOT NULL DO NOTHING`,
    args: [
      session.id, session.readingId, session.userId, session.startedAt, session.endedAt, session.status, session.sittings,
      JSON.stringify(session.report), session.ai ? JSON.stringify(session.ai) : null, null,
      session.resume ? JSON.stringify(session.resume) : null, saveId,
    ],
  });
  if (res.rowsAffected === 0 && saveId) {
    const existing = await sessionBySaveId(session.userId, saveId);
    if (existing) return existing;
  }
  return session;
}

/** The session a given browser save went into, if it was already stored. */
export async function sessionBySaveId(userId: string, saveId: string): Promise<Session | null> {
  const { rows } = await (await db()).execute({ sql: `SELECT ${SESSION_COLS} FROM sessions WHERE user_id = ? AND save_id = ?`, args: [userId, saveId] });
  return rows[0] ? toSession(rows[0]) : null;
}

/** Save progress on an existing session (pause again, or finish it). */
export async function updateSession(
  id: string,
  patch: { endedAt: string; status: SessionStatus; sittings: number; report: Session["report"]; ai: Session["ai"]; resume: ResumeState | null },
  saveId: string | null = null,
) {
  await (await db()).execute({
    sql: "UPDATE sessions SET ended_at = ?, status = ?, sittings = ?, report = ?, ai = ?, resume = ?, save_id = COALESCE(?, save_id) WHERE id = ?",
    args: [patch.endedAt, patch.status, patch.sittings, JSON.stringify(patch.report), patch.ai ? JSON.stringify(patch.ai) : null, patch.resume ? JSON.stringify(patch.resume) : null, saveId, id],
  });
}

/** Replace a finished session's AI summary (used when an earlier attempt failed and is retried). */
export async function saveSessionAi(id: string, ai: NonNullable<Session["ai"]>) {
  await (await db()).execute({ sql: "UPDATE sessions SET ai = ? WHERE id = ?", args: [JSON.stringify(ai), id] });
}

export async function saveRecall(sessionId: string, section: number, text: string): Promise<Session | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  const recall = { ...(session.recall ?? {}) };
  if (text.trim()) recall[String(section)] = { text: text.trim(), savedAt: new Date().toISOString() };
  else delete recall[String(section)];
  session.recall = Object.keys(recall).length ? recall : undefined;
  await (await db()).execute({
    sql: "UPDATE sessions SET recall = ? WHERE id = ?",
    args: [session.recall ? JSON.stringify(session.recall) : null, sessionId],
  });
  return session;
}

export async function getSession(id: string, withResume = false): Promise<Session | null> {
  const { rows } = await (await db()).execute({
    sql: `SELECT ${withResume ? "*" : SESSION_COLS} FROM sessions WHERE id = ?`,
    args: [id],
  });
  return rows[0] ? toSession(rows[0], withResume) : null;
}

/** The student's paused (unfinished) session for a reading, if any, with its resume state. */
export async function pausedSession(userId: string, readingId: string): Promise<Session | null> {
  const { rows } = await (await db()).execute({
    sql: "SELECT * FROM sessions WHERE user_id = ? AND reading_id = ? AND status = 'paused' ORDER BY ended_at DESC LIMIT 1",
    args: [userId, readingId],
  });
  return rows[0] ? toSession(rows[0], true) : null;
}

export async function sessionsFor(userId: string, readingId?: string): Promise<Session[]> {
  const { rows } = await (await db()).execute(
    readingId
      ? { sql: `SELECT ${SESSION_COLS} FROM sessions WHERE user_id = ? AND reading_id = ? ORDER BY ended_at DESC`, args: [userId, readingId] }
      : { sql: `SELECT ${SESSION_COLS} FROM sessions WHERE user_id = ? ORDER BY ended_at DESC`, args: [userId] },
  );
  return rows.map((r) => toSession(r));
}

export async function sessionsForReading(readingId: string): Promise<Session[]> {
  const { rows } = await (await db()).execute({ sql: `SELECT ${SESSION_COLS} FROM sessions WHERE reading_id = ? ORDER BY ended_at DESC`, args: [readingId] });
  return rows.map((r) => toSession(r));
}

export async function sessionsForReadings(readingIds: string[]): Promise<Session[]> {
  if (!readingIds.length) return [];
  const { rows } = await (await db()).execute({
    sql: `SELECT ${SESSION_COLS} FROM sessions WHERE reading_id IN (${readingIds.map(() => "?").join(",")}) ORDER BY ended_at DESC`,
    args: readingIds,
  });
  return rows.map((r) => toSession(r));
}

/**
 * Sessions on course readings by students enrolled in that course. Class numbers use these, so
 * the professor trying a reading themselves (or anyone not in the class) never counts as a student.
 */
export async function studentSessionsForReadings(readingIds: string[]): Promise<Session[]> {
  if (!readingIds.length) return [];
  const cols = SESSION_COLS.split(", ").map((c) => `s.${c}`).join(", ");
  const { rows } = await (await db()).execute({
    sql: `SELECT ${cols} FROM sessions s
          JOIN readings r ON r.id = s.reading_id
          JOIN enrollments e ON e.course_id = r.course_id AND e.user_id = s.user_id
          WHERE s.reading_id IN (${readingIds.map(() => "?").join(",")}) ORDER BY s.ended_at DESC`,
    args: readingIds,
  });
  return rows.map((r) => toSession(r));
}

export async function studentSessionsForReading(readingId: string): Promise<Session[]> {
  return studentSessionsForReadings([readingId]);
}

// ---------- AI rate limit ----------
/** Gemini calls each user may start per window (session summaries, PDF clean-up, class AI…). */
const AI_CALLS_PER_WINDOW = 20;
const AI_WINDOW_MS = 10 * 60 * 1000;

/**
 * Records one Gemini call for this user if they're under the limit, and says whether it may
 * go ahead. Over the limit, callers use their basic (non-AI) version instead.
 */
export async function takeAiCall(userId: string): Promise<boolean> {
  const c = await db();
  const now = Date.now();
  const since = new Date(now - AI_WINDOW_MS).toISOString();
  const { rows } = await c.execute({ sql: "SELECT COUNT(*) AS n FROM ai_calls WHERE user_id = ? AND at > ?", args: [userId, since] });
  if (Number(rows[0].n) >= AI_CALLS_PER_WINDOW) return false;
  await c.batch(
    [
      { sql: "INSERT INTO ai_calls (user_id, at) VALUES (?, ?)", args: [userId, new Date(now).toISOString()] },
      { sql: "DELETE FROM ai_calls WHERE at < ?", args: [new Date(now - 24 * 3600 * 1000).toISOString()] },
    ],
    "write",
  );
  return true;
}

// ---------- Class digests and lesson plans (professor AI) ----------
export async function getDigest(readingId: string): Promise<ClassDigest | null> {
  const { rows } = await (await db()).execute({ sql: "SELECT * FROM digests WHERE reading_id = ?", args: [readingId] });
  const r = rows[0];
  return r ? { readingId, text: String(r.text), generatedBy: r.generated_by as ClassDigest["generatedBy"], createdAt: String(r.created_at) } : null;
}

export async function saveDigest(d: ClassDigest) {
  await (await db()).execute({
    sql: "INSERT OR REPLACE INTO digests (reading_id,text,generated_by,created_at) VALUES (?,?,?,?)",
    args: [d.readingId, d.text, d.generatedBy, d.createdAt],
  });
}

export async function getLessonPlan(readingId: string): Promise<LessonPlan | null> {
  const { rows } = await (await db()).execute({ sql: "SELECT * FROM lesson_plans WHERE reading_id = ?", args: [readingId] });
  const r = rows[0];
  return r
    ? { readingId, text: String(r.text), generatedBy: r.generated_by as LessonPlan["generatedBy"], createdAt: String(r.created_at), basedOnSessions: Number(r.based_on_sessions) }
    : null;
}

export async function saveLessonPlan(p: LessonPlan) {
  await (await db()).execute({
    sql: "INSERT OR REPLACE INTO lesson_plans (reading_id,text,generated_by,created_at,based_on_sessions) VALUES (?,?,?,?,?)",
    args: [p.readingId, p.text, p.generatedBy, p.createdAt, p.basedOnSessions],
  });
}

/** "Start over" on a reading: any older paused session is closed as it stands. */
export async function closePausedSessions(userId: string, readingId: string) {
  await (await db()).execute({
    sql: "UPDATE sessions SET status = 'done', resume = NULL WHERE user_id = ? AND reading_id = ? AND status = 'paused'",
    args: [userId, readingId],
  });
}

// ---------- articles imported from the browser extension ----------
// The table is also created here (not only at start-up) so a running server picks it up
// without a restart.
let webTableReady: Promise<unknown> | null = null;
async function webDb(): Promise<Client> {
  const c = await db();
  webTableReady ??= c.execute(WEB_READINGS_SCHEMA).catch((e) => {
    webTableReady = null;
    throw e;
  });
  await webTableReady;
  return c;
}

function toWebReading(r: Row): WebReading {
  const raw = json<unknown>(r.data, {});
  const d = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<WebReading>;
  return {
    id: String(r.id), userId: String(r.user_id), url: String(r.url), title: String(r.title), site: String(r.site),
    firstSeen: String(r.first_seen), lastSeen: String(r.last_seen), importedAt: String(r.imported_at),
    coveragePct: Number(r.coverage_pct), activeSec: Number(r.active_sec),
    totalWords: d.totalWords ?? 0, eyeSec: d.eyeSec ?? 0, wordsRead: d.wordsRead ?? 0, wordsSkimmed: d.wordsSkimmed ?? 0,
    wordsSkipped: d.wordsSkipped ?? 0,
    paragraphs: (Array.isArray(d.paragraphs) ? d.paragraphs : []).filter(
      (p): p is WebReading["paragraphs"][number] => typeof p === "object" && p !== null && typeof p.text === "string",
    ),
  };
}

export async function webReadingsFor(userId: string): Promise<WebReading[]> {
  const { rows } = await (await webDb()).execute({ sql: "SELECT * FROM web_readings WHERE user_id = ? ORDER BY last_seen DESC", args: [userId] });
  return rows.map(toWebReading);
}

export async function getWebReading(id: string): Promise<WebReading | null> {
  const { rows } = await (await webDb()).execute({ sql: "SELECT * FROM web_readings WHERE id = ?", args: [id] });
  return rows[0] ? toWebReading(rows[0]) : null;
}

/** Insert or update (by user + URL). An older copy never overwrites a newer one. Returns how many changed. */
export async function upsertWebReadings(userId: string, items: Omit<WebReading, "id" | "userId" | "importedAt">[]): Promise<number> {
  if (!items.length) return 0;
  const c = await webDb();
  const now = new Date().toISOString();
  const res = await c.batch(
    items.map((w) => ({
      sql: `INSERT INTO web_readings (id,user_id,url,title,site,first_seen,last_seen,imported_at,coverage_pct,active_sec,data)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT (user_id, url) DO UPDATE SET title=excluded.title, site=excluded.site, first_seen=excluded.first_seen,
              last_seen=excluded.last_seen, imported_at=excluded.imported_at, coverage_pct=excluded.coverage_pct,
              active_sec=excluded.active_sec, data=excluded.data
            WHERE excluded.last_seen > web_readings.last_seen`,
      args: [
        newId("web"), userId, w.url, w.title, w.site, w.firstSeen, w.lastSeen, now, w.coveragePct, w.activeSec,
        JSON.stringify({ totalWords: w.totalWords, eyeSec: w.eyeSec, wordsRead: w.wordsRead, wordsSkimmed: w.wordsSkimmed, wordsSkipped: w.wordsSkipped, paragraphs: w.paragraphs }),
      ],
    })),
    "write",
  );
  return res.reduce((t, r) => t + r.rowsAffected, 0);
}

export async function deleteWebReading(id: string, userId: string): Promise<boolean> {
  const r = await (await webDb()).execute({ sql: "DELETE FROM web_readings WHERE id = ? AND user_id = ?", args: [id, userId] });
  return r.rowsAffected > 0;
}

// ---------- saved eye-tracking calibrations ----------
let calibrationTableReady: Promise<unknown> | null = null;
// Databases created before this table existed get it on first use.
async function calibrationDb(): Promise<Client> {
  const c = await db();
  calibrationTableReady ??= c.execute(CALIBRATIONS_SCHEMA).catch((e) => {
    calibrationTableReady = null;
    throw e;
  });
  await calibrationTableReady;
  return c;
}

/** The student's saved calibration, as stored (check it with parseSavedCalibration), or null. */
export async function getCalibration(userId: string): Promise<unknown> {
  const { rows } = await (await calibrationDb()).execute({ sql: "SELECT data FROM calibrations WHERE user_id = ?", args: [userId] });
  return rows[0] ? json<unknown>(rows[0].data, null) : null;
}

/** Save (or replace) the student's calibration. */
export async function saveCalibration(userId: string, data: unknown) {
  await (await calibrationDb()).execute({
    sql: `INSERT INTO calibrations (user_id, data, updated_at) VALUES (?, ?, ?)
          ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    args: [userId, JSON.stringify(data), new Date().toISOString()],
  });
}
