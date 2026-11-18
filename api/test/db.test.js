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

test('openDatabase gives existing surveys a closing date 10 days after creation', () => {
  withOldDatabase((path) => {
    const db = openDatabase(path);
    assert.ok(columns(db, 'surveys').includes('closes_on'));
    const survey = db.prepare('SELECT * FROM surveys').get();
    assert.equal(survey.closes_on, '2026-11-11');
    assert.equal(survey.title, 'Old survey');
    db.prepare("UPDATE surveys SET closes_on = '2027-01-01'").run();
    db.close();
    const again = openDatabase(path); // a later boot must not overwrite a chosen date
    assert.equal(again.prepare('SELECT closes_on FROM surveys').get().closes_on, '2027-01-01');
    again.close();
  });
});

test('openDatabase adds a per-device column with a unique index per survey', () => {
  withOldDatabase((path) => {
    const db = openDatabase(path);
    assert.ok(columns(db, 'responses').includes('device_hash'));
    const insert = db.prepare('INSERT INTO responses (survey_id, answers_json, device_hash) VALUES (1, ?, ?)');
    insert.run('{}', 'device-a');
    assert.throws(() => insert.run('{}', 'device-a'), /UNIQUE/);
    insert.run('{}', null); // old and anonymous rows without a device are not restricted
    insert.run('{}', null);
    db.close();
  });
});

test('openDatabase numbers existing responses per survey in arrival order, once', () => {
  withOldDatabase((path) => {
    const old = new DatabaseSync(path);
    old.exec(`
      INSERT INTO surveys (owner_id, public_token, title, fields_json) VALUES (1, 'tok2', 'Second survey', '[]');
      INSERT INTO responses (survey_id, answers_json) VALUES (2, '{"b":"1"}'), (1, '{"a":"2"}'), (2, '{"b":"2"}'), (1, '{"a":"3"}');
      DELETE FROM responses WHERE answers_json = '{"a":"2"}';
      INSERT INTO responses (survey_id, answers_json) VALUES (1, '{"a":"4"}');
    `);
    const before = old.prepare('SELECT id, survey_id, answers_json, submitted_at FROM responses ORDER BY id').all();
    old.close();

    const db = openDatabase(path);
    assert.ok(columns(db, 'responses').includes('number'));
    assert.ok(columns(db, 'surveys').includes('response_seq'));
    const rows = () => db.prepare('SELECT id, survey_id, answers_json, submitted_at, number FROM responses ORDER BY id').all()
      .map((r) => ({ ...r }));
    assert.deepEqual(rows().map((r) => [r.answers_json, r.number]), [
      ['{"a":"1"}', 1], ['{"b":"1"}', 1], ['{"b":"2"}', 2], ['{"a":"3"}', 2], ['{"a":"4"}', 3],
    ]);
    assert.deepEqual(rows().map(({ number, ...rest }) => rest), before.map((r) => ({ ...r })), 'data otherwise unchanged');
    assert.deepEqual(db.prepare('SELECT id, response_seq FROM surveys ORDER BY id').all().map((r) => [r.id, r.response_seq]), [[1, 3], [2, 2]]);
    assert.throws(() => db.prepare("INSERT INTO responses (survey_id, answers_json, number) VALUES (1, '{}', 3)").run(), /UNIQUE/);

    // A later boot must not renumber, even after a gap left by a deletion.
    db.prepare('DELETE FROM responses WHERE number = 1 AND survey_id = 1').run();
    const kept = rows();
    db.close();
    const again = openDatabase(path);
    assert.deepEqual(again.prepare('SELECT id, survey_id, answers_json, submitted_at, number FROM responses ORDER BY id').all()
      .map((r) => ({ ...r })), kept);
    assert.deepEqual(again.prepare('SELECT response_seq FROM surveys ORDER BY id').all().map((r) => r.response_seq), [3, 2]);
    again.close();
  });
});

test('the default database path is data/surveys.db at the repository root, not the cwd', async () => {
  const { loadConfig, REPO_ROOT } = await import('../src/config.js');
  assert.equal(loadConfig({}).dbPath, join(REPO_ROOT, 'data', 'surveys.db'));
  assert.equal(loadConfig({ DB_PATH: ':memory:' }).dbPath, ':memory:');
});

test('openDatabase adds the name requirement setting; existing surveys keep the name optional', () => {
  withOldDatabase((path) => {
    const db = openDatabase(path);
    assert.ok(columns(db, 'surveys').includes('require_name'));
    const survey = db.prepare('SELECT * FROM surveys').get();
    assert.equal(survey.require_name, 0);
    assert.equal(survey.title, 'Old survey');
    db.prepare('UPDATE surveys SET require_name = 1').run();
    db.close();
    const again = openDatabase(path); // a later boot must not reset a chosen setting
    assert.equal(again.prepare('SELECT require_name FROM surveys').get().require_name, 1);
    again.close();
  });
});

test('openDatabase adds the results link column: existing surveys stay private, links are unique', () => {
  withOldDatabase((path) => {
    const db = openDatabase(path);
    assert.ok(columns(db, 'surveys').includes('results_token'));
    assert.equal(db.prepare('SELECT results_token FROM surveys').get().results_token, null);
    db.prepare("INSERT INTO surveys (owner_id, public_token, title, fields_json) VALUES (1, 'tok2', 'Second', '[]')").run();
    db.prepare("UPDATE surveys SET results_token = 'r1' WHERE id = 1").run();
    assert.throws(() => db.prepare("UPDATE surveys SET results_token = 'r1' WHERE id = 2").run(), /UNIQUE/);
    db.close();
    const again = openDatabase(path); // a later boot keeps the link
    assert.equal(again.prepare('SELECT results_token FROM surveys WHERE id = 1').get().results_token, 'r1');
    again.close();
  });
});
