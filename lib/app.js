import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { createOddsService } from "./odds-service.js";
import { createRateLimiter } from "./rate-limit.js";
import { createAuth, normalizeUsername } from "./auth.js";
import { LastAdminError } from "./users-store.js";
import { validateEvents, clampLimit, parseCursor, HISTORY_BODY_LIMIT } from "./history.js";
import { roleLabel } from "../public/roles.js";

const gz = promisify(gzip);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const SECURITY = {
  "content-security-policy": "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
const COOKIE = "odd_session";
const MAX_BODY = 4096;
const PROTECTED_PAGES = { "/": "user", "/index.html": "user", "/history.html": "user", "/admin.html": "admin" }; // o resto de /public é público (código e imagens)

export function createApp({ config, store, fetchLeagues, fetchFallback, publicDir, now = Date.now }) {
  const odds = createOddsService({
    fetchLeagues, fetchFallback: config.demoFallback ? fetchFallback : null,
    ttlMs: config.ttlMs, staleMaxMs: config.staleMaxMs, maxDay: config.maxDay, now,
  });
  const auth = createAuth({ store, config, now });
  const limit = createRateLimiter({ ...config.rateLimit, now });
  const loginByUser = createRateLimiter({ windowMs: config.loginLimit.windowMs, max: config.loginLimit.maxPerUser, now });
  const historyLimit = createRateLimiter({ windowMs: 60_000, max: 120, now }); // eventos de histórico por usuário/min
  const loginByIp = createRateLimiter({ windowMs: config.loginLimit.windowMs, max: config.loginLimit.maxPerIp, now });

  const clientIp = (req) =>
    (config.trustProxy && req.headers["x-forwarded-for"]?.split(",")[0].trim()) || req.socket.remoteAddress || "?";

  const tokenOf = (req) => {
    for (const part of (req.headers.cookie || "").split(";")) {
      const i = part.indexOf("=");
      if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
    }
    return null;
  };
  const cookie = (value, maxAgeSec) =>
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${config.secureCookies ? "; Secure" : ""}`;

  // O mesmo objeto de odds é servido a muitas requisições: serializa e comprime uma vez só.
  const encoded = new WeakMap(); // objeto -> { raw, gz? }
  async function sendJson(req, res, status, obj, extra = {}) {
    let e = encoded.get(obj);
    if (!e) { e = { raw: Buffer.from(JSON.stringify(obj)) }; encoded.set(obj, e); }
    let body = e.raw;
    const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY, ...extra };
    if (/\bgzip\b/.test(req.headers["accept-encoding"] || "") && body.length > 1024) {
      body = e.gz ??= await gz(body);
      headers["content-encoding"] = "gzip";
      headers.vary = "Accept-Encoding";
    }
    res.writeHead(status, headers);
    res.end(body);
  }

  const redirect = (res, to) => { res.writeHead(302, { location: to, "cache-control": "no-store", ...SECURITY }); res.end(); };
  const notFound = (res) => { res.writeHead(404, { "content-type": "text/plain; charset=utf-8", ...SECURITY }); res.end("Not found"); };

  async function sendStatic(res, pathname, { noStore = false } = {}) {
    const rel = normalize(pathname === "/" ? "/index.html" : pathname);
    const file = join(publicDir, rel);
    if (!file.startsWith(publicDir + sep)) return notFound(res);
    try {
      const data = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": noStore ? "no-store" : "public, max-age=300", ...SECURITY });
      res.end(data);
    } catch {
      notFound(res);
    }
  }

  // Corpo JSON pequeno. Exige application/json: um formulário de outro site não consegue enviar esse tipo
  // sem passar por CORS (que não liberamos), o que, junto com SameSite=Lax e a checagem de Origin, barra CSRF.
  async function readJson(req, res, maxBody = MAX_BODY) {
    const origin = req.headers.origin;
    if (origin) {
      let host = null;
      try { host = new URL(origin).host; } catch {}
      if (host !== req.headers.host) { await sendJson(req, res, 403, { error: "Origem não permitida" }); return undefined; }
    }
    if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) {
      await sendJson(req, res, 415, { error: "Use application/json" });
      return undefined;
    }
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > maxBody) { await sendJson(req, res, 413, { error: "Corpo muito grande" }); return undefined; }
      chunks.push(c);
    }
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (body && typeof body === "object" && !Array.isArray(body)) return body;
    } catch {}
    await sendJson(req, res, 400, { error: "JSON inválido" });
    return undefined;
  }

  // Auditoria das ações de administração. Falha ao registrar não desfaz a ação (só vai para o log).
  async function logAdminAction(admin, action, summary, detail) {
    try {
      await store.addEvents([{ userId: admin.id, username: admin.username, slipId: "administracao", action, registration: null, summary, detail, clientAt: null, createdAt: new Date(now()) }]);
    } catch (e) { console.error("Falha ao registrar ação de administração:", e.message); }
  }

  async function handleApi(req, res, pathname, searchParams, user) {
    // ---- login / logout / eu ----
    if (pathname === "/api/login") {
      if (req.method !== "POST") return sendJson(req, res, 405, { error: "Use POST" }, { allow: "POST" });
      const body = await readJson(req, res);
      if (!body) return;
      const ip = clientIp(req), name = normalizeUsername(body.username);
      const userKey = `${ip}|${name}`;
      // Só as FALHAS contam: quem acerta a senha nunca se bloqueia sozinho.
      const a = loginByIp.peek(ip), b = loginByUser.peek(userKey);
      if (!a.allowed || !b.allowed) {
        return sendJson(req, res, 429, { error: "Muitas tentativas. Aguarde alguns minutos." }, { "retry-after": String(Math.max(a.retryAfter, b.retryAfter)) });
      }
      const session = await auth.login(body.username, body.password);
      if (!session) {
        loginByIp(ip);
        loginByUser(userKey);
        return sendJson(req, res, 401, { error: "Usuário ou senha inválidos." });
      }
      loginByUser.reset(userKey);
      return sendJson(req, res, 200, { username: session.user.username, role: session.user.role }, { "set-cookie": cookie(session.token, Math.floor(config.sessionTtlMs / 1000)) });
    }
    if (pathname === "/api/logout") {
      if (req.method !== "POST") return sendJson(req, res, 405, { error: "Use POST" }, { allow: "POST" });
      if (!(await readJson(req, res))) return;
      await auth.logout(tokenOf(req));
      return sendJson(req, res, 200, { ok: true }, { "set-cookie": cookie("", 0) });
    }
    if (pathname === "/api/me") {
      if (!user) return sendJson(req, res, 401, { error: "Não autenticado" });
      return sendJson(req, res, 200, { username: user.username, role: user.role });
    }

    // Tudo abaixo exige login.
    if (!user) return sendJson(req, res, 401, { error: "Não autenticado" });

    // ---- odds ----
    if (pathname === "/api/odds") {
      if (req.method !== "GET" && req.method !== "HEAD") return sendJson(req, res, 405, { error: "Use GET" }, { allow: "GET, HEAD" });
      const rl = limit(clientIp(req));
      if (!rl.allowed) return sendJson(req, res, 429, { error: "Muitas requisições" }, { "retry-after": String(rl.retryAfter) });
      const raw = searchParams.get("day");
      const day = raw == null ? 0 : /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isInteger(day) || day < 0 || day > config.maxDay) {
        return sendJson(req, res, 400, { error: `day deve ser um inteiro entre 0 e ${config.maxDay}` });
      }
      try {
        return sendJson(req, res, 200, await odds.get(day));
      } catch (e) {
        console.error("Falha ao obter odds:", e.message);
        return sendJson(req, res, 502, { error: "Fonte de odds indisponível", detail: e.message });
      }
    }

    // ---- histórico de apostas ----
    if (pathname === "/api/history") {
      if (req.method === "POST") {
        const rl = historyLimit(`u${user.id}`);
        if (!rl.allowed) return sendJson(req, res, 429, { error: "Muitos eventos de histórico" }, { "retry-after": String(rl.retryAfter) });
        const body = await readJson(req, res, HISTORY_BODY_LIMIT);
        if (!body) return;
        const v = validateEvents(body);
        if (!v.ok) return sendJson(req, res, 400, { error: v.error });
        const at = new Date(now()); // o horário do evento é do SERVIDOR; o do aparelho vai só como clientAt
        await store.addEvents(v.events.map((e) => ({ ...e, userId: user.id, username: user.username, createdAt: at })));
        return sendJson(req, res, 201, { saved: v.events.length });
      }
      if (req.method === "GET") {
        const limit = clampLimit(searchParams.get("limit")), cursor = parseCursor(searchParams.get("before"));
        if (limit == null || !cursor.ok) return sendJson(req, res, 400, { error: "limit ou before inválido" });
        const { events, hasMore } = await store.listEvents({ userId: user.id, beforeId: cursor.value, limit }); // cada um vê só o próprio histórico
        return sendJson(req, res, 200, { events, hasMore });
      }
      return sendJson(req, res, 405, { error: "Método não permitido" }, { allow: "GET, POST" });
    }

    if (pathname === "/api/admin/history") {
      if (user.role !== "admin") return sendJson(req, res, 403, { error: "Apenas administradores" });
      if (req.method !== "GET") return sendJson(req, res, 405, { error: "Use GET" }, { allow: "GET" });
      const limit = clampLimit(searchParams.get("limit")), cursor = parseCursor(searchParams.get("before"));
      const username = searchParams.get("username");
      if (limit == null || !cursor.ok || (username != null && !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(username))) return sendJson(req, res, 400, { error: "limit, before ou username inválido" });
      const { events, hasMore } = await store.listEvents({ username, beforeId: cursor.value, limit });
      return sendJson(req, res, 200, { events, hasMore, usernames: await store.listEventUsernames() });
    }

    // ---- administração de usuários ----
    if (pathname === "/api/admin/users" || pathname.startsWith("/api/admin/users/")) {
      if (user.role !== "admin") return sendJson(req, res, 403, { error: "Apenas administradores" });

      if (pathname === "/api/admin/users") {
        if (req.method === "GET") return sendJson(req, res, 200, { users: await store.listUsers() });
        if (req.method === "POST") {
          const body = await readJson(req, res);
          if (!body) return;
          const r = await auth.createUser({ username: body.username, password: body.password, role: body.role ?? "user" });
          if (!r.ok) return sendJson(req, res, r.duplicate ? 409 : 400, { error: r.error });
          await logAdminAction(user, "user_created", `Criou o usuário "${r.user.username}" (${roleLabel(r.user.role)})`, { target: r.user.username, role: r.user.role });
          return sendJson(req, res, 201, { user: r.user });
        }
        return sendJson(req, res, 405, { error: "Método não permitido" }, { allow: "GET, POST" });
      }

      const m = pathname.match(/^\/api\/admin\/users\/(\d{1,9})$/);
      if (!m) return notFound(res);
      if (req.method !== "DELETE") return sendJson(req, res, 405, { error: "Use DELETE" }, { allow: "DELETE" });
      if (!(await readJson(req, res))) return;
      const id = Number(m[1]);
      if (id === user.id) return sendJson(req, res, 409, { error: "Você não pode excluir a sua própria conta." });
      try {
        const alvo = (await store.listUsers()).find((u) => u.id === id); // guarda quem era, para o histórico
        if (!(await store.deleteUser(id))) return sendJson(req, res, 404, { error: "Usuário não encontrado." });
        await logAdminAction(user, "user_deleted", `Excluiu o usuário "${alvo?.username ?? `#${id}`}" (${alvo ? roleLabel(alvo.role) : "?"})`, { target: alvo?.username ?? null, role: alvo?.role ?? null });
        auth.forgetUser(id); // a sessão dele em memória cai agora, não daqui a 30 s
        return sendJson(req, res, 200, { ok: true });
      } catch (e) {
        if (e instanceof LastAdminError) return sendJson(req, res, 409, { error: "Não é possível excluir o último administrador." });
        throw e;
      }
    }

    return notFound(res);
  }

  async function handler(req, res) {
    try {
      if (!["GET", "HEAD", "POST", "DELETE"].includes(req.method)) {
        res.writeHead(405, { allow: "GET, HEAD, POST, DELETE" });
        return res.end();
      }
      const { pathname, searchParams } = new URL(req.url, "http://x");

      if (pathname === "/healthz") {
        const t = odds.lastSuccessAt();
        return sendJson(req, res, 200, { ok: true, lastSuccessAt: t && new Date(t).toISOString() });
      }

      let user = null;
      try {
        user = await auth.userFromToken(tokenOf(req));
      } catch (e) {
        console.error("Falha ao consultar a sessão:", e.message);
        if (pathname.startsWith("/api/")) return sendJson(req, res, 503, { error: "Serviço de login indisponível. Tente novamente." });
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8", ...SECURITY });
        return res.end("Serviço de login indisponível. Tente novamente em instantes.");
      }

      if (pathname.startsWith("/api/")) {
        try {
          return await handleApi(req, res, pathname, searchParams, user);
        } catch (e) {
          console.error("Erro na API:", e.message);
          return sendJson(req, res, 500, { error: "Erro interno" });
        }
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" });
        return res.end();
      }

      const need = PROTECTED_PAGES[pathname];
      if (need === "user" && !user) return redirect(res, "/login.html");
      if (need === "admin" && !user) return redirect(res, "/login.html");
      if (need === "admin" && user.role !== "admin") return redirect(res, "/");
      return sendStatic(res, pathname, { noStore: Boolean(need) });
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  }
  handler.warm = (days, options) => odds.warm(days, options);
  return handler;
}
