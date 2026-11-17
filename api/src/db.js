import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  answers_json TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_surveys_owner ON surveys(owner_id);
CREATE INDEX IF NOT EXISTS idx_responses_survey ON responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

const hasColumn = (db, table, column) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

/**
 * Additive, idempotent migrations for databases created by older versions.
 * Each step checks the current shape first, so running them on every boot is safe.
 */
const MIGRATIONS = [
  (db) => {
    if (!hasColumn(db, 'responses', 'respondent_name')) {
      db.exec('ALTER TABLE responses ADD COLUMN respondent_name TEXT');
    }
  },
  // Every survey has a closing date (YYYY-MM-DD). Existing surveys get creation date + 10 days,
  // only once, when the column is added, so later boots never overwrite a date chosen by a creator.
  (db) => {
    if (!hasColumn(db, 'surveys', 'closes_on')) {
      db.exec('ALTER TABLE surveys ADD COLUMN closes_on TEXT');
      db.exec("UPDATE surveys SET closes_on = date(created_at, '+10 days') WHERE closes_on IS NULL");
    }
  },
  // One response per device and survey. Rows without a device (older responses) are not restricted.
  (db) => {
    if (!hasColumn(db, 'responses', 'device_hash')) {
      db.exec('ALTER TABLE responses ADD COLUMN device_hash TEXT');
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_survey_device
             ON responses(survey_id, device_hash) WHERE device_hash IS NOT NULL`);
  },
];

function migrate(db) {
  db.exec('BEGIN');
  try {
    for (const step of MIGRATIONS) step(db);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
