import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openDatabase } from '../src/db.js';

// Schema of the first released version (before any migration).
const V1_SCHEMA = `
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE surveys (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_token TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', fields_json TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE responses (id INTEGER PRIMARY KEY AUTOINCREMENT, survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  answers_json TEXT NOT NULL, submitted_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO users (email, name, password_hash) VALUES ('old@corp.local', 'Old', 'x');
INSERT INTO surveys (owner_id, public_token, title, fields_json, created_at) VALUES (1, 'tok', 'Old survey', '[]', '2026-11-01 08:00:00');
INSERT INTO responses (survey_id, answers_json) VALUES (1, '{"a":"1"}');
`;

function withOldDatabase(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sharevy-db-'));
  const path = join(dir, 'old.db');
  const old = new DatabaseSync(path);
  old.exec(V1_SCHEMA);
  old.close();
  try {
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

test('openDatabase adds the respondent name column to existing databases, keeping data', () => {
  withOldDatabase((path) => {
    const db = openDatabase(path);
    assert.ok(columns(db, 'responses').includes('respondent_name'));
    const row = db.prepare('SELECT * FROM responses').get();
    assert.equal(row.respondent_name, null);
    assert.equal(row.answers_json, '{"a":"1"}');
    db.close();
    openDatabase(path).close(); // running migrations twice is safe
  });
});
