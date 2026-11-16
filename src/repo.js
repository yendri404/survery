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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    responseCount: row.response_count ?? undefined,
  };
}

function hydrateResponse(row) {
  return {
    id: row.id,
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

    // Sessions
    createSession({ id, userId, csrfToken, expiresAt }) {
      q('INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').run(id, userId, csrfToken, expiresAt);
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
    createSurvey({ ownerId, publicToken, title, description, fields }) {
      const r = q('INSERT INTO surveys (owner_id, public_token, title, description, fields_json) VALUES (?, ?, ?, ?, ?)')
        .run(ownerId, publicToken, title, description, JSON.stringify(fields));
      return Number(r.lastInsertRowid);
    },
    getOwnedSurvey(id, ownerId) {
      return hydrateSurvey(q(`
        SELECT s.*, (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id) AS response_count
        FROM surveys s WHERE s.id = ? AND s.owner_id = ?
      `).get(id, ownerId));
    },
    getSurveyByToken(token) {
      return hydrateSurvey(q('SELECT * FROM surveys WHERE public_token = ?').get(token));
    },
    updateSurvey(id, ownerId, { title, description, fields }) {
      q(`UPDATE surveys SET title = ?, description = ?, fields_json = ?, updated_at = datetime('now')
         WHERE id = ? AND owner_id = ?`).run(title, description, JSON.stringify(fields), id, ownerId);
    },
    setSurveyOpen(id, ownerId, isOpen) {
      q(`UPDATE surveys SET is_open = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?`)
        .run(isOpen ? 1 : 0, id, ownerId);
    },
    deleteSurvey(id, ownerId) {
      q('DELETE FROM surveys WHERE id = ? AND owner_id = ?').run(id, ownerId);
    },

    // Responses
    addResponse(surveyId, answers, respondentName = null) {
      const r = q('INSERT INTO responses (survey_id, answers_json, respondent_name) VALUES (?, ?, ?)')
        .run(surveyId, JSON.stringify(answers), respondentName || null);
      return Number(r.lastInsertRowid);
    },
    listResponses(surveyId) {
      return q('SELECT * FROM responses WHERE survey_id = ? ORDER BY id DESC').all(surveyId).map(hydrateResponse);
    },
    deleteResponse(surveyId, responseId) {
      q('DELETE FROM responses WHERE id = ? AND survey_id = ?').run(responseId, surveyId);
    },
  };
}
