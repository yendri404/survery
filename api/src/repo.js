function hydrateSurvey(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    ownerId: row.owner_id,
    publicToken: row.public_token,
    title: row.title,
    description: row.description,
    fields: JSON.parse(row.fields_json),
    isOpen: row.is_open === 1,
    closesOn: row.closes_on,
    requireName: row.require_name === 1,
    resultsToken: row.results_token ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    responseCount: row.response_count ?? undefined,
  };
}

function hydrateResponse(row) {
  return {
    id: row.id,
    number: row.number,
    answers: JSON.parse(row.answers_json),
    respondentName: row.respondent_name ?? null,
    submittedAt: row.submitted_at,
  };
}

export function createRepo(db) {
  const q = (sql) => db.prepare(sql);

  return {
    // Users
    createUser({ email, name, passwordHash }) {
      const r = q('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(email, name, passwordHash);
      return Number(r.lastInsertRowid);
    },
    findUserByEmail(email) {
      return q('SELECT * FROM users WHERE email = ?').get(email);
    },
    findUserById(id) {
      return q('SELECT * FROM users WHERE id = ?').get(id);
    },
    /** Every user (admin panel), newest first, with how many surveys each one has. */
    listUsers() {
      return q(`
        SELECT u.id, u.name, u.email, u.created_at, (SELECT COUNT(*) FROM surveys s WHERE s.owner_id = u.id) AS survey_count
        FROM users u ORDER BY u.created_at DESC, u.id DESC
      `).all();
    },
    /** New name and email (both given; the caller keeps the current one for a field left out). */
    updateUser(id, { name, email }) {
      q('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name, email, id);
    },
    /** Sets a new password and ends every session of that user. */
    setUserPassword(id, passwordHash) {
      q('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
      q('DELETE FROM sessions WHERE user_id = ?').run(id);
    },
    /** Deletes a user; their sessions, surveys and answers go with them (ON DELETE CASCADE). */
    deleteUser(id) {
      q('DELETE FROM sessions WHERE user_id = ?').run(id);
      q('DELETE FROM users WHERE id = ?').run(id);
    },

    // Admin (master password, single row)
    getAdmin() {
      return q('SELECT * FROM admin WHERE id = 1').get();
    },
    /** Creates the admin row. False when one already exists (only the first of concurrent setups wins). */
    createAdmin({ passwordHash, sessionKey }) {
      return q('INSERT INTO admin (id, password_hash, session_key) VALUES (1, ?, ?) ON CONFLICT(id) DO NOTHING').run(passwordHash, sessionKey).changes === 1;
    },
    createAdminSession({ id, sessionKey, expiresAt }) {
      q('INSERT INTO admin_sessions (id, session_key, expires_at) VALUES (?, ?, ?)').run(id, sessionKey, expiresAt);
    },
    /** An unexpired admin session that belongs to the current admin row; undefined otherwise. */
    getAdminSession(id) {
      return q(`SELECT s.* FROM admin_sessions s JOIN admin a ON a.id = 1 AND a.session_key = s.session_key
                WHERE s.id = ? AND s.expires_at > ?`).get(id, Date.now());
    },
    deleteAdminSession(id) {
      q('DELETE FROM admin_sessions WHERE id = ?').run(id);
    },
    /** Expired sessions and sessions of an admin row that no longer exists. */
    deleteStaleAdminSessions() {
      q(`DELETE FROM admin_sessions WHERE expires_at <= ? OR session_key NOT IN (SELECT session_key FROM admin)`).run(Date.now());
    },

    // Sessions
    /** `id` is the hash of the Bearer token. csrf_token is a legacy column (cookie sessions): always ''. */
    createSession({ id, userId, expiresAt }) {
      q("INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES (?, ?, '', ?)").run(id, userId, expiresAt);
    },
    getSession(id) {
      return q('SELECT * FROM sessions WHERE id = ? AND expires_at > ?').get(id, Date.now());
    },
    deleteSession(id) {
      q('DELETE FROM sessions WHERE id = ?').run(id);
    },
    deleteExpiredSessions() {
      q('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    },

    // Surveys
    listSurveys(ownerId) {
      return q(`
        SELECT s.*, (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id) AS response_count
        FROM surveys s WHERE s.owner_id = ?
        ORDER BY s.created_at DESC, s.id DESC
      `).all(ownerId).map(hydrateSurvey);
    },
    createSurvey({ ownerId, publicToken, title, description, closesOn, requireName = false, fields }) {
      const r = q('INSERT INTO surveys (owner_id, public_token, title, description, closes_on, require_name, fields_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(ownerId, publicToken, title, description, closesOn, requireName ? 1 : 0, JSON.stringify(fields));
      return Number(r.lastInsertRowid);
    },
    getOwnedSurvey(id, ownerId) {
      return hydrateSurvey(q(`
        SELECT s.*, (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id) AS response_count
        FROM surveys s WHERE s.id = ? AND s.owner_id = ?
      `).get(id, ownerId));
    },
    /** Any survey by id, whoever owns it (admin panel). */
    getSurvey(id) {
      return hydrateSurvey(q(`
        SELECT s.*, (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id) AS response_count
        FROM surveys s WHERE s.id = ?
      `).get(id));
    },
    getSurveyByToken(token) {
      return hydrateSurvey(q('SELECT * FROM surveys WHERE public_token = ?').get(token));
    },
    /** The survey whose results are public under this results token; undefined when private or unknown. */
    getSurveyByResultsToken(token) {
      return hydrateSurvey(q('SELECT * FROM surveys WHERE results_token = ?').get(token));
    },
    updateSurvey(id, ownerId, { title, description, closesOn, requireName = false, fields }) {
      q(`UPDATE surveys SET title = ?, description = ?, closes_on = ?, require_name = ?, fields_json = ?, updated_at = datetime('now')
         WHERE id = ? AND owner_id = ?`).run(title, description, closesOn, requireName ? 1 : 0, JSON.stringify(fields), id, ownerId);
    },
    setSurveyOpen(id, ownerId, isOpen) {
      q(`UPDATE surveys SET is_open = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?`)
        .run(isOpen ? 1 : 0, id, ownerId);
    },
    /** Public results link: a token makes the results public, null makes them private again. */
    setResultsToken(id, ownerId, token) {
      q(`UPDATE surveys SET results_token = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?`).run(token, id, ownerId);
    },
    deleteSurvey(id, ownerId) {
      q('DELETE FROM surveys WHERE id = ? AND owner_id = ?').run(id, ownerId);
    },

    // Responses
    /**
     * Stores a response with the survey's next response number. Returns { id, number }, or
     * { error: 'alreadyAnswered' } when this device already answered the survey (enforced by a unique
     * index, so concurrent submissions cannot both succeed), or { error: 'surveyMissing' } when the
     * survey was deleted meanwhile. The counter and the insert share one transaction, so a rejected
     * insert rolls back and uses up no number.
     */
    addResponse(surveyId, answers, respondentName = null, deviceHash = null) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const counter = q('UPDATE surveys SET response_seq = response_seq + 1 WHERE id = ? RETURNING response_seq').get(surveyId);
        if (!counter) {
          db.exec('ROLLBACK');
          return { error: 'surveyMissing' };
        }
        const number = counter.response_seq;
        const r = q('INSERT INTO responses (survey_id, number, answers_json, respondent_name, device_hash) VALUES (?, ?, ?, ?, ?)')
          .run(surveyId, number, JSON.stringify(answers), respondentName || null, deviceHash);
        db.exec('COMMIT');
        return { id: Number(r.lastInsertRowid), number };
      } catch (err) {
        db.exec('ROLLBACK');
        if (deviceHash && /UNIQUE constraint failed: responses\.survey_id, responses\.device_hash/.test(err.message)) return { error: 'alreadyAnswered' };
        throw err;
      }
    },
    hasDeviceResponse(surveyId, deviceHash) {
      return Boolean(q('SELECT 1 FROM responses WHERE survey_id = ? AND device_hash = ?').get(surveyId, deviceHash));
    },
    listResponses(surveyId) {
      return q('SELECT * FROM responses WHERE survey_id = ? ORDER BY id DESC').all(surveyId).map(hydrateResponse);
    },
    deleteResponse(surveyId, responseId) {
      q('DELETE FROM responses WHERE id = ? AND survey_id = ?').run(responseId, surveyId);
    },
  };
}
