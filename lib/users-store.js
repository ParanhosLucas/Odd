// Armazenamento de usuários e sessões. Duas implementações com a MESMA interface:
//  - createPgStore(pool): Postgres (produção; no Render, o banco do próprio Blueprint)
//  - createMemoryStore(): só em memória (desenvolvimento/testes; some ao reiniciar)
// Os tokens de sessão NUNCA são guardados: só o hash SHA-256 deles.

export class DuplicateUserError extends Error {}
export class LastAdminError extends Error {}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id SERIAL PRIMARY KEY,
     username TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     role TEXT NOT NULL DEFAULT 'user',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at TIMESTAMPTZ NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`,
  // Histórico de apostas e de alterações. O nome do usuário é copiado para a linha: se o usuário for excluído
  // (user_id vira NULL), o histórico dele continua existindo e identificado.
  `CREATE TABLE IF NOT EXISTS bet_events (
     id SERIAL PRIMARY KEY,
     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     username TEXT NOT NULL,
     slip_id TEXT NOT NULL,
     action TEXT NOT NULL,
     registration TEXT,
     summary TEXT NOT NULL,
     detail TEXT NOT NULL DEFAULT '{}',
     client_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS bet_events_user_idx ON bet_events(user_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS bet_events_name_idx ON bet_events(username, id DESC)`,
];

const parseDetail = (text) => { try { const v = JSON.parse(text); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
const publicEvent = (r) => ({
  id: r.id, userId: r.user_id ?? null, username: r.username, slipId: r.slip_id, action: r.action,
  registration: r.registration ?? null, summary: r.summary, detail: parseDetail(r.detail),
  clientAt: r.client_at ? new Date(r.client_at).toISOString() : null,
  createdAt: new Date(r.created_at).toISOString(),
});

const publicUser = (r) => ({ id: r.id, username: r.username, role: r.role, createdAt: new Date(r.created_at).toISOString() });

export function createPgStore(pool) {
  return {
    async init() { for (const sql of SCHEMA) await pool.query(sql); },

    async createUser({ username, passwordHash, role }) {
      try {
        const { rows } = await pool.query(
          "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at",
          [username, passwordHash, role],
        );
        return publicUser(rows[0]);
      } catch (e) {
        if (e.code === "23505") throw new DuplicateUserError(username);
        throw e;
      }
    },

    async listUsers() {
      const { rows } = await pool.query("SELECT id, username, role, created_at FROM users ORDER BY username");
      return rows.map(publicUser);
    },

    async findByUsername(username) {
      const { rows } = await pool.query("SELECT id, username, role, password_hash FROM users WHERE username = $1", [username]);
      return rows[0] ? { id: rows[0].id, username: rows[0].username, role: rows[0].role, passwordHash: rows[0].password_hash } : null;
    },

    async countAdmins() {
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin'");
      return rows[0].n;
    },

    // Exclui o usuário (e, por CASCADE, as sessões dele). Nunca deixa o sistema sem administrador.
    async deleteUser(id) {
      const { rows } = await pool.query(
        `DELETE FROM users WHERE id = $1
           AND NOT (role = 'admin' AND (SELECT count(*) FROM users WHERE role = 'admin') <= 1)
         RETURNING id`,
        [id],
      );
      if (rows.length) return true;
      const exists = await pool.query("SELECT 1 FROM users WHERE id = $1", [id]);
      if (exists.rows.length) throw new LastAdminError();
      return false;
    },

    async createSession(tokenHash, userId, expiresAt) {
      await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [tokenHash, userId, expiresAt]);
    },

    async findSession(tokenHash, now = new Date()) {
      const { rows } = await pool.query(
        `SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > $2`,
        [tokenHash, now],
      );
      return rows[0] ? { id: rows[0].id, username: rows[0].username, role: rows[0].role } : null;
    },

    async deleteSession(tokenHash) { await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]); },
    async purgeExpired(now = new Date()) { await pool.query("DELETE FROM sessions WHERE expires_at <= $1", [now]); },

    // ---- histórico ----
    // events: [{ userId, username, slipId, action, registration, summary, detail, clientAt, createdAt }]; uma única INSERT (tudo ou nada).
    async addEvents(events) {
      if (!events.length) return [];
      const params = [], rows = events.map((e) => {
        const base = params.length;
        params.push(e.userId ?? null, e.username, e.slipId, e.action, e.registration ?? null, e.summary, JSON.stringify(e.detail ?? {}), e.clientAt ?? null, e.createdAt);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
      });
      const { rows: saved } = await pool.query(`INSERT INTO bet_events (user_id, username, slip_id, action, registration, summary, detail, client_at, created_at) VALUES ${rows.join(", ")} RETURNING id, user_id, username, slip_id, action, registration, summary, detail, client_at, created_at`, params);
      return saved.map(publicEvent); // com o id: é o que o backup copia
    },

    // Em ordem crescente de id (para o backup e a exportação). afterId = cursor.
    async listEventsAfter({ afterId = 0, limit = 500 } = {}) {
      const { rows } = await pool.query(
        "SELECT id, user_id, username, slip_id, action, registration, summary, detail, client_at, created_at FROM bet_events WHERE id > $1 ORDER BY id ASC LIMIT $2",
        [afterId, limit],
      );
      return rows.map(publicEvent);
    },

    // Mais recentes primeiro. Filtros: userId (o próprio usuário) ou username (visão do administrador); beforeId = cursor.
    async listEvents({ userId = null, username = null, beforeId = null, limit = 100 } = {}) {
      const where = [], params = [];
      if (userId != null) { params.push(userId); where.push(`user_id = $${params.length}`); }
      if (username != null) { params.push(username); where.push(`username = $${params.length}`); }
      if (beforeId != null) { params.push(beforeId); where.push(`id < $${params.length}`); }
      params.push(limit + 1);
      const { rows } = await pool.query(
        `SELECT id, user_id, username, slip_id, action, registration, summary, detail, client_at, created_at FROM bet_events
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT $${params.length}`,
        params,
      );
      return { events: rows.slice(0, limit).map(publicEvent), hasMore: rows.length > limit };
    },

    async listEventUsernames() {
      const { rows } = await pool.query("SELECT DISTINCT username FROM bet_events ORDER BY username");
      return rows.map((r) => r.username);
    },
  };
}

export function createMemoryStore() {
  let nextId = 1;
  const users = new Map();    // id -> { id, username, passwordHash, role, createdAt }
  const sessions = new Map(); // tokenHash -> { userId, expiresAt }
  const events = [];
  let nextEventId = 1;
  const strip = ({ passwordHash, ...rest }) => ({ ...rest, createdAt: rest.createdAt.toISOString() });
  return {
    async init() {},
    async createUser({ username, passwordHash, role }) {
      if ([...users.values()].some((u) => u.username === username)) throw new DuplicateUserError(username);
      const u = { id: nextId++, username, passwordHash, role, createdAt: new Date() };
      users.set(u.id, u);
      return strip(u);
    },
    async listUsers() { return [...users.values()].sort((a, b) => a.username.localeCompare(b.username)).map(strip); },
    async findByUsername(username) { return [...users.values()].find((u) => u.username === username) || null; },
    async countAdmins() { return [...users.values()].filter((u) => u.role === "admin").length; },
    async deleteUser(id) {
      const u = users.get(id);
      if (!u) return false;
      if (u.role === "admin" && [...users.values()].filter((x) => x.role === "admin").length <= 1) throw new LastAdminError();
      users.delete(id);
      for (const [h, s] of sessions) if (s.userId === id) sessions.delete(h);
      for (const e of events) if (e.user_id === id) e.user_id = null; // o histórico fica, como no banco (ON DELETE SET NULL)
      return true;
    },
    async createSession(tokenHash, userId, expiresAt) { sessions.set(tokenHash, { userId, expiresAt }); },
    async findSession(tokenHash, now = new Date()) {
      const s = sessions.get(tokenHash);
      const u = s && users.get(s.userId);
      return u && s.expiresAt > now ? { id: u.id, username: u.username, role: u.role } : null;
    },
    async deleteSession(tokenHash) { sessions.delete(tokenHash); },
    async purgeExpired(now = new Date()) { for (const [h, s] of sessions) if (s.expiresAt <= now) sessions.delete(h); },

    async addEvents(list) {
      const saved = [];
      for (const e of list) saved.push({ id: nextEventId++, user_id: e.userId ?? null, username: e.username, slip_id: e.slipId, action: e.action, registration: e.registration ?? null, summary: e.summary, detail: JSON.stringify(e.detail ?? {}), client_at: e.clientAt ?? null, created_at: e.createdAt });
      events.push(...saved);
      return saved.map(publicEvent);
    },
    async listEventsAfter({ afterId = 0, limit = 500 } = {}) {
      return events.filter((e) => e.id > afterId).sort((a, b) => a.id - b.id).slice(0, limit).map(publicEvent);
    },
    async listEvents({ userId = null, username = null, beforeId = null, limit = 100 } = {}) {
      const rows = events.filter((e) => (userId == null || e.user_id === userId) && (username == null || e.username === username) && (beforeId == null || e.id < beforeId)).sort((a, b) => b.id - a.id);
      return { events: rows.slice(0, limit).map(publicEvent), hasMore: rows.length > limit };
    },
    async listEventUsernames() { return [...new Set(events.map((e) => e.username))].sort(); },
  };
}
