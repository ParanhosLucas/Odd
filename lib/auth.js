// Regras de login: validação, sessões e administrador inicial. Sem HTTP aqui (isso fica em app.js).
import { createHash, randomBytes } from "node:crypto";
import { dummyHash, hashPassword, PASSWORD_MAX, PASSWORD_MIN, verifyPassword } from "./passwords.js";
import { DuplicateUserError } from "./users-store.js";

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const ROLES = ["user", "admin"];

export const normalizeUsername = (u) => String(u ?? "").trim().toLowerCase();
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

// Devolve { ok: true, value } ou { ok: false, error } (mensagem em português para mostrar ao admin).
export function validateNewUser({ username, password, role = "user" }) {
  const u = normalizeUsername(username);
  if (!USERNAME_RE.test(u)) return { ok: false, error: "Usuário: 3 a 32 caracteres (letras minúsculas, números, ponto, hífen ou _), começando por letra ou número." };
  if (typeof password !== "string" || password.length < PASSWORD_MIN) return { ok: false, error: `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.` };
  if (password.length > PASSWORD_MAX) return { ok: false, error: `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.` };
  if (!ROLES.includes(role)) return { ok: false, error: "Perfil inválido." };
  return { ok: true, value: { username: u, password, role } };
}

export function createAuth({ store, config, now = Date.now, log = console }) {
  // Sessão validada há pouco fica em memória: sem isto, TODA requisição faz uma ida ao banco (que pode estar
  // em outra região e "dormindo"). Encerrar a sessão ou excluir o usuário limpa o cache na hora; só uma
  // alteração feita direto no banco pode demorar até sessionCacheMs para valer.
  const sessions = new Map(); // hash do token -> { user, until }
  const TTL = config.sessionCacheMs ?? 30_000;

  return {
    // Confere usuário e senha. Devolve { user, token } ou null (sem dizer qual dos dois errou).
    async login(username, password) {
      const found = await store.findByUsername(normalizeUsername(username));
      const passwordOk = typeof password === "string" && password.length <= PASSWORD_MAX
        ? await verifyPassword(password, found ? found.passwordHash : await dummyHash())
        : false; // mesmo custo de tempo com ou sem usuário
      if (!found || !passwordOk) return null;
      const token = randomBytes(32).toString("base64url");
      await store.createSession(hashToken(token), found.id, new Date(now() + config.sessionTtlMs));
      return { user: { id: found.id, username: found.username, role: found.role }, token };
    },

    async userFromToken(token) {
      if (!token) return null;
      const h = hashToken(token), t = now(), hit = sessions.get(h);
      if (hit && hit.until > t) return hit.user;
      const user = await store.findSession(h, new Date(t));
      if (!user) { sessions.delete(h); return null; }
      if (sessions.size > 5000) for (const [k, v] of sessions) if (v.until <= t) sessions.delete(k);
      sessions.set(h, { user, until: t + TTL });
      return user;
    },

    logout(token) {
      if (!token) return undefined;
      sessions.delete(hashToken(token));
      return store.deleteSession(hashToken(token));
    },

    // Chamado quando um usuário é excluído: derruba as sessões dele que estavam em memória.
    forgetUser(id) {
      for (const [h, v] of sessions) if (v.user.id === id) sessions.delete(h);
    },

    async createUser(input) {
      const v = validateNewUser(input);
      if (!v.ok) return v;
      try {
        return { ok: true, user: await store.createUser({ username: v.value.username, passwordHash: await hashPassword(v.value.password), role: v.value.role }) };
      } catch (e) {
        if (e instanceof DuplicateUserError) return { ok: false, duplicate: true, error: "Já existe um usuário com esse nome." };
        throw e;
      }
    },

    // Primeiro administrador: só é criado se NÃO houver nenhum (ex.: banco novo). Nunca sobrescreve senhas.
    async ensureAdmin() {
      if ((await store.countAdmins()) > 0) return "exists";
      if (!config.adminUser || !config.adminPassword) {
        log.warn("Nenhum administrador no banco e ADMIN_USER/ADMIN_PASSWORD não definidos: ninguém conseguirá entrar.");
        return "missing-env";
      }
      const r = await this.createUser({ username: config.adminUser, password: config.adminPassword, role: "admin" });
      if (!r.ok) { log.error("ADMIN_USER/ADMIN_PASSWORD inválidos:", r.error); return "invalid"; }
      log.log(`Administrador inicial "${r.user.username}" criado.`);
      return "created";
    },

    purgeExpired: () => store.purgeExpired(new Date(now())),
  };
}
