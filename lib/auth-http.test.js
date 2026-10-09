import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { createMemoryStore } from "./users-store.js";
import { createHistoryBackup, createMemoryBackupTarget } from "./history-backup.js";

const publicDir = join(fileURLToPath(new URL("..", import.meta.url)), "public");
const LEAGUES = [{ name: "L", matches: [] }];
const JSON_H = { "content-type": "application/json" };
const servers = [];
after(() => { for (const sv of servers) sv.closeAllConnections(), sv.close(); });

async function start({ env = {}, store = createMemoryStore(), clock = { t: 1_000_000 }, backup } = {}) {
  const config = loadConfig({ NODE_ENV: "production", ...env });
  const auth = createAuth({ store, config, now: () => clock.t });
  await auth.createUser({ username: "admin", password: "senha-admin-1", role: "admin" });
  await auth.createUser({ username: "bia", password: "senha-da-bia-1", role: "user" });
  const server = http.createServer(createApp({ config, store, fetchLeagues: async () => LEAGUES, publicDir, now: () => clock.t, backup }));
  servers.push(server);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const s = { base, clock, store, config };
  s.req = (path, { method = "GET", cookie, body, headers = {}, raw } = {}) =>
    fetch(base + path, {
      method, redirect: "manual",
      headers: { ...(body !== undefined || raw !== undefined ? JSON_H : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  s.login = async (username, password) => {
    const r = await s.req("/api/login", { method: "POST", body: { username, password } });
    return { res: r, cookie: r.headers.get("set-cookie")?.split(";")[0] };
  };
  s.adminCookie = (await s.login("admin", "senha-admin-1")).cookie;
  s.biaCookie = (await s.login("bia", "senha-da-bia-1")).cookie;
  return s;
}

test("login correto: 200, dados do usuário e cookie de sessão com flags de segurança", async () => {
  const s = await start();
  const { res } = await s.login("Admin", "senha-admin-1"); // nome sem diferenciar maiúsculas
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { username: "admin", role: "admin" });
  const c = res.headers.get("set-cookie");
  assert.match(c, /^odd_session=[A-Za-z0-9_-]{40,}/);
  for (const flag of [/HttpOnly/, /SameSite=Lax/, /Path=\//, /Max-Age=604800/, /Secure/]) assert.match(c, flag);
});

test("login errado: mesma resposta para usuário inexistente e senha errada (não revela quem tem conta)", async () => {
  const s = await start();
  const a = await s.login("admin", "senha-errada-9"), b = await s.login("fantasma", "senha-errada-9");
  assert.equal(a.res.status, 401);
  assert.equal(b.res.status, 401);
  assert.deepEqual(await a.res.json(), await b.res.json());
  assert.equal(a.res.headers.get("set-cookie"), null);
  for (const body of [{}, { username: "admin" }, { username: 5, password: 7 }, { username: "admin", password: "x".repeat(300) }]) {
    assert.equal((await s.req("/api/login", { method: "POST", body })).status, 401, JSON.stringify(body).slice(0, 40));
  }
});

test("sem login não há acesso: API 401, páginas protegidas redirecionam, estáticos públicos abrem", async () => {
  const s = await start();
  for (const p of ["/api/odds", "/api/me", "/api/admin/users"]) assert.equal((await s.req(p)).status, 401, p);
  assert.equal((await s.req("/api/odds", { cookie: "odd_session=lixo" })).status, 401);
  assert.equal((await s.req("/api/odds", { cookie: "outro=" + s.biaCookie.split("=")[1] })).status, 401); // nome de cookie errado
  for (const p of ["/", "/index.html", "/admin.html"]) {
    const r = await s.req(p);
    assert.equal(r.status, 302, p);
    assert.equal(r.headers.get("location"), "/login.html");
  }
  for (const p of ["/login.html", "/style.css", "/healthz", "/logo.svg", "/login.js", "/theme.js"]) assert.equal((await s.req(p)).status, 200, p);
  const logo = await s.req("/logo.svg"); // a tela de login precisa da logo antes de qualquer login
  assert.equal(logo.headers.get("content-type"), "image/svg+xml");
  assert.match(await logo.text(), /^<svg /);
  assert.equal((await s.req("/api/odds", { cookie: s.biaCookie })).status, 200);
  assert.deepEqual(await (await s.req("/api/me", { cookie: s.biaCookie })).json(), { username: "bia", role: "user" });
});

test("página de administração: só para administrador", async () => {
  const s = await start();
  const user = await s.req("/admin.html", { cookie: s.biaCookie });
  assert.equal(user.status, 302);
  assert.equal(user.headers.get("location"), "/");
  assert.equal((await s.req("/admin.html", { cookie: s.adminCookie })).status, 200);
  assert.equal((await s.req("/", { cookie: s.biaCookie })).headers.get("cache-control"), "no-store"); // não fica em cache após sair
});

test("logout invalida a sessão no servidor (copiar o cookie não adianta)", async () => {
  const s = await start();
  const out = await s.req("/api/logout", { method: "POST", cookie: s.biaCookie, body: {} });
  assert.equal(out.status, 200);
  assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await s.req("/api/me", { cookie: s.biaCookie })).status, 401);
});

test("a sessão expira depois de 7 dias", async () => {
  const s = await start();
  s.clock.t += 6 * 86_400_000;
  assert.equal((await s.req("/api/me", { cookie: s.biaCookie })).status, 200);
  s.clock.t += 2 * 86_400_000;
  assert.equal((await s.req("/api/me", { cookie: s.biaCookie })).status, 401);
});

test("administrador cria usuário: nome em minúsculas, entra com a senha, hash nunca aparece", async () => {
  const s = await start();
  const r = await s.req("/api/admin/users", { method: "POST", cookie: s.adminCookie, body: { username: "  Carlos.Silva ", password: "senha-do-carlos", role: "user" } });
  assert.equal(r.status, 201);
  const { user } = await r.json();
  assert.equal(user.username, "carlos.silva");
  assert.equal(user.role, "user");
  assert.equal(JSON.stringify(user).includes("hash"), false);
  assert.equal((await s.login("carlos.silva", "senha-do-carlos")).res.status, 200);
  const list = await (await s.req("/api/admin/users", { cookie: s.adminCookie })).json();
  assert.deepEqual(list.users.map((u) => u.username), ["admin", "bia", "carlos.silva"]);
  assert.equal(JSON.stringify(list).match(/hash|scrypt/i), null);
});

test("validação ao criar: nome, senha, perfil e duplicidade (sem diferenciar maiúsculas)", async () => {
  const s = await start();
  const post = (body) => s.req("/api/admin/users", { method: "POST", cookie: s.adminCookie, body });
  const cases = [
    [{ username: "ab", password: "senha-longa-1" }, 400],            // nome curto
    [{ username: "com espaço", password: "senha-longa-1" }, 400],
    [{ username: "-comeca-com-hifen", password: "senha-longa-1" }, 400],
    [{ username: "a".repeat(33), password: "senha-longa-1" }, 400],
    [{ username: "novo1", password: "curta" }, 400],                  // senha < 8
    [{ username: "novo1", password: "x".repeat(129) }, 400],          // senha > 128
    [{ username: "novo1", password: 12345678 }, 400],                 // não é texto
    [{ username: "novo1", password: "senha-longa-1", role: "root" }, 400],
    [{ password: "senha-longa-1" }, 400],
    [{ username: "BIA", password: "senha-longa-1" }, 409],            // já existe "bia"
  ];
  for (const [body, status] of cases) assert.equal((await post(body)).status, status, JSON.stringify(body).slice(0, 60));
  assert.equal((await post({ username: "novo1", password: "senha-longa-1" })).status, 201);
  const err = await (await post({ username: "novo1", password: "senha-longa-1" })).json();
  assert.match(err.error, /Já existe/);
});

test("usuário comum não administra; sem login também não", async () => {
  const s = await start();
  const id = (await s.store.findByUsername("bia")).id;
  for (const [method, path, body] of [["GET", "/api/admin/users"], ["POST", "/api/admin/users", { username: "xx1", password: "senha-longa-1" }], ["DELETE", `/api/admin/users/${id}`, {}]]) {
    assert.equal((await s.req(path, { method, cookie: s.biaCookie, body })).status, 403, `${method} ${path}`);
    assert.equal((await s.req(path, { method, body })).status, 401, `${method} ${path} sem login`);
  }
  assert.ok(await s.store.findByUsername("bia")); // nada foi alterado
});

test("excluir usuário: some, a sessão dele cai na hora e ele não consegue entrar de novo", async () => {
  const s = await start();
  const id = (await s.store.findByUsername("bia")).id;
  assert.equal((await s.req("/api/me", { cookie: s.biaCookie })).status, 200);
  const del = await s.req(`/api/admin/users/${id}`, { method: "DELETE", cookie: s.adminCookie, body: {} });
  assert.equal(del.status, 200);
  assert.equal((await s.req("/api/me", { cookie: s.biaCookie })).status, 401);          // sessão derrubada
  assert.equal((await s.login("bia", "senha-da-bia-1")).res.status, 401);               // não entra mais
  assert.deepEqual((await (await s.req("/api/admin/users", { cookie: s.adminCookie })).json()).users.map((u) => u.username), ["admin"]);
  assert.equal((await s.req(`/api/admin/users/${id}`, { method: "DELETE", cookie: s.adminCookie, body: {} })).status, 404); // já excluído
  assert.equal((await s.req("/api/admin/users/abc", { method: "DELETE", cookie: s.adminCookie, body: {} })).status, 404);   // id inválido
});

test("administrador não exclui a si mesmo; com outro admin, um pode excluir o outro", async () => {
  const s = await start();
  const adminId = (await s.store.findByUsername("admin")).id;
  const self = await s.req(`/api/admin/users/${adminId}`, { method: "DELETE", cookie: s.adminCookie, body: {} });
  assert.equal(self.status, 409);
  assert.match((await self.json()).error, /própria conta/);
  assert.equal((await s.req("/api/admin/users", { method: "POST", cookie: s.adminCookie, body: { username: "chefe2", password: "senha-chefe-2", role: "admin" } })).status, 201);
  const chefe = (await s.login("chefe2", "senha-chefe-2")).cookie;
  assert.equal((await s.req(`/api/admin/users/${adminId}`, { method: "DELETE", cookie: chefe, body: {} })).status, 200);
  assert.equal((await s.req("/api/me", { cookie: s.adminCookie })).status, 401);
});

test("proteção contra CSRF: origem estranha, tipo de conteúdo errado, JSON inválido e corpo grande", async () => {
  const s = await start();
  const host = new URL(s.base).host;
  const evil = await s.req("/api/admin/users", { method: "POST", cookie: s.adminCookie, headers: { origin: "https://site-malicioso.example" }, body: { username: "invasor", password: "senha-longa-1" } });
  assert.equal(evil.status, 403);
  assert.equal(await s.store.findByUsername("invasor"), null);
  assert.equal((await s.req("/api/login", { method: "POST", headers: { origin: "https://site-malicioso.example" }, body: { username: "admin", password: "senha-admin-1" } })).status, 403);
  const same = await s.req("/api/admin/users", { method: "POST", cookie: s.adminCookie, headers: { origin: `http://${host}` }, body: { username: "legitimo", password: "senha-longa-1" } });
  assert.equal(same.status, 201); // a própria origem é aceita
  const form = await fetch(`${s.base}/api/admin/users`, { method: "POST", redirect: "manual", headers: { cookie: s.adminCookie, "content-type": "application/x-www-form-urlencoded" }, body: "username=form&password=senha-longa-1" });
  assert.equal(form.status, 415); // formulário HTML de outro site não consegue criar usuário
  assert.equal((await s.req("/api/login", { method: "POST", raw: "{nao-json" })).status, 400);
  assert.equal((await s.req("/api/login", { method: "POST", raw: "[1,2]" })).status, 400);
  assert.equal((await s.req("/api/login", { method: "POST", raw: JSON.stringify({ username: "a".repeat(10_000) }) })).status, 413);
});

test("limite de tentativas de login: 10 FALHAS por usuário em 15 minutos, depois 429", async () => {
  const s = await start(); // o start() já fez um login correto de cada um: acertos não contam
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await s.login("admin", `errada-${i}-xxxx`)).res.status);
  assert.deepEqual(codes, [...Array(10).fill(401), 429, 429]);
  const blocked = await s.login("admin", "senha-admin-1"); // até a senha certa fica bloqueada durante a janela
  assert.equal(blocked.res.status, 429);
  assert.ok(Number(blocked.res.headers.get("retry-after")) > 0);
  assert.equal((await s.login("bia", "senha-da-bia-1")).res.status, 200); // outro usuário não é afetado
  s.clock.t += 16 * 60_000;
  assert.equal((await s.login("admin", "senha-admin-1")).res.status, 200); // a janela passou
});

test("logins corretos nunca bloqueiam; um acerto zera as falhas anteriores daquele usuário", async () => {
  const s = await start();
  for (let i = 0; i < 25; i++) assert.equal((await s.login("bia", "senha-da-bia-1")).res.status, 200, `acerto ${i}`);
  for (let i = 0; i < 9; i++) await s.login("admin", `errada-${i}-xxxx`);          // 9 falhas
  assert.equal((await s.login("admin", "senha-admin-1")).res.status, 200);          // acerta: zera
  for (let i = 0; i < 9; i++) assert.equal((await s.login("admin", `outra-${i}-xxxx`)).res.status, 401);
});

test("limite por IP: muitas falhas com nomes diferentes também bloqueiam (30 em 15 minutos)", async () => {
  const s = await start();
  const codes = [];
  for (let i = 0; i < 32; i++) codes.push((await s.login(`alvo${i}`, "senha-errada-9")).res.status);
  assert.deepEqual(codes, [...Array(30).fill(401), 429, 429]);
  assert.equal((await s.login("bia", "senha-da-bia-1")).res.status, 429); // o IP inteiro fica em espera
});

test("falha do banco vira 503 (e não erro genérico nem acesso liberado)", async () => {
  const s = await start();
  const original = s.store.findSession;
  s.store.findSession = async () => { throw new Error("banco fora do ar"); };
  const api = await s.req("/api/odds", { cookie: s.biaCookie });
  assert.equal(api.status, 503);
  const page = await s.req("/", { cookie: s.biaCookie });
  assert.equal(page.status, 503);
  s.store.findSession = original;
  assert.equal((await s.req("/api/odds", { cookie: s.biaCookie })).status, 200);
});

test("métodos não permitidos e rotas desconhecidas", async () => {
  const s = await start();
  assert.equal((await s.req("/api/odds", { method: "OPTIONS", cookie: s.biaCookie })).status, 405);
  assert.equal((await s.req("/api/login")).status, 405);
  assert.equal((await s.req("/api/logout")).status, 405);
  assert.equal((await s.req("/api/nao-existe", { cookie: s.biaCookie })).status, 404);
  assert.equal((await s.req("/api/nao-existe")).status, 401);
});

test("administrador inicial: criado só se não houver nenhum, nunca sobrescreve", async () => {
  const quiet = { log() {}, warn() {}, error() {} };
  const mk = (env, store = createMemoryStore()) => ({ store, auth: createAuth({ store, config: loadConfig({ NODE_ENV: "production", ...env }), log: quiet }) });
  const a = mk({ ADMIN_USER: "Dono", ADMIN_PASSWORD: "senha-do-dono-1" });
  assert.equal(await a.auth.ensureAdmin(), "created");
  assert.equal((await a.store.findByUsername("dono")).role, "admin");
  assert.equal(await a.auth.ensureAdmin(), "exists"); // segunda vez não duplica
  const b = mk({ ADMIN_USER: "dono", ADMIN_PASSWORD: "outra-senha-qualquer" }, a.store);
  assert.equal(await b.auth.ensureAdmin(), "exists");
  assert.equal((await b.auth.login("dono", "senha-do-dono-1")).user.username, "dono"); // senha antiga continua valendo
  assert.equal(await b.auth.login("dono", "outra-senha-qualquer"), null);
  assert.equal(await mk({}).auth.ensureAdmin(), "missing-env");
  assert.equal(await mk({ ADMIN_USER: "dono", ADMIN_PASSWORD: "curta" }).auth.ensureAdmin(), "invalid");
  assert.equal(await mk({ ADMIN_USER: "x", ADMIN_PASSWORD: "senha-do-dono-1" }).auth.ensureAdmin(), "invalid");
});

test("sessão em memória: só a primeira requisição vai ao banco; encerrar sessão e excluir usuário valem na hora", async () => {
  const s = await start();
  let consultas = 0;
  const original = s.store.findSession.bind(s.store);
  s.store.findSession = async (...args) => { consultas++; return original(...args); };
  for (let i = 0; i < 10; i++) assert.equal((await s.req("/api/me", { cookie: s.biaCookie })).status, 200);
  assert.equal(consultas, 1, "10 requisições, 1 consulta ao banco");

  // logout derruba o cache junto com a sessão
  const out = await s.req("/api/logout", { method: "POST", cookie: s.biaCookie, body: {} });
  assert.equal(out.status, 200);
  assert.equal((await s.req("/api/me", { cookie: s.biaCookie })).status, 401);

  // excluir o usuário derruba a sessão que estava em memória
  const bia2 = (await s.login("bia", "senha-da-bia-1")).cookie;
  assert.equal((await s.req("/api/me", { cookie: bia2 })).status, 200); // entra no cache
  const id = (await s.store.findByUsername("bia")).id;
  assert.equal((await s.req(`/api/admin/users/${id}`, { method: "DELETE", cookie: s.adminCookie, body: {} })).status, 200);
  assert.equal((await s.req("/api/me", { cookie: bia2 })).status, 401);
});

test("sessão em memória: depois de 30 s volta a conferir no banco (pega expiração e remoção feitas direto no banco)", async () => {
  const s = await start();
  let consultas = 0;
  const original = s.store.findSession.bind(s.store);
  s.store.findSession = async (...args) => { consultas++; return original(...args); };
  await s.req("/api/me", { cookie: s.biaCookie });
  s.clock.t += 29_000;
  await s.req("/api/me", { cookie: s.biaCookie });
  assert.equal(consultas, 1);
  s.clock.t += 2_000;
  await s.req("/api/me", { cookie: s.biaCookie });
  assert.equal(consultas, 2);
  // sessão inexistente não fica em cache: cada tentativa confere de novo
  await s.req("/api/me", { cookie: "odd_session=lixo" });
  await s.req("/api/me", { cookie: "odd_session=lixo" });
  assert.equal(consultas, 4);
});

// ================= Histórico de apostas =================
const evento = (over = {}) => ({ action: "changed", slipId: "slip-teste-0001", summary: "Adicionou jogo A × B", detail: { n: 1 }, ...over });
const enviar = (s, cookie, events, extra = {}) => s.req("/api/history", { method: "POST", cookie, body: { events }, ...extra });
const listar = async (s, cookie, qs = "") => (await s.req(`/api/history${qs}`, { cookie })).json();
const listarAdmin = async (s, qs = "") => (await s.req(`/api/admin/history${qs}`, { cookie: s.adminCookie })).json();

test("histórico: o horário é o do SERVIDOR (o do aparelho vai à parte) e quem grava é o usuário da sessão", async () => {
  const s = await start({ clock: { t: Date.parse("2026-10-09T15:30:12Z") } });
  const r = await enviar(s, s.biaCookie, [evento({ clientAt: "2020-01-01T00:00:00.000Z" })]);
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { saved: 1 });
  const { events } = await listar(s, s.biaCookie);
  assert.equal(events.length, 1);
  assert.equal(events[0].createdAt, "2026-10-09T15:30:12.000Z", "horário do servidor, não o do aparelho");
  assert.equal(events[0].clientAt, "2020-01-01T00:00:00.000Z");
  assert.equal(events[0].username, "bia");
  assert.equal(events[0].summary, "Adicionou jogo A × B");
  assert.deepEqual(events[0].detail, { n: 1 });
});

test("histórico: não dá para gravar em nome de outro usuário nem usar ações de administração", async () => {
  const s = await start();
  const r = await enviar(s, s.biaCookie, [evento({ username: "admin", userId: 1, createdAt: "2001-01-01T00:00:00Z", user_id: 1 })]);
  assert.equal(r.status, 201);
  const meu = await listar(s, s.biaCookie);
  assert.equal(meu.events[0].username, "bia", "o nome vem da sessão, nunca do corpo");
  assert.notEqual(meu.events[0].createdAt, "2001-01-01T00:00:00.000Z");
  assert.equal((await listar(s, s.adminCookie)).events.length, 0, "nada foi parar no histórico do admin");
  for (const action of ["user_created", "user_deleted"]) {
    const bad = await enviar(s, s.biaCookie, [evento({ action })]);
    assert.equal(bad.status, 400, action);
    assert.match((await bad.json()).error, /ação inválida/);
  }
});

test("histórico: cada usuário vê só o próprio; o administrador vê o de todos e filtra por nome", async () => {
  const s = await start();
  await enviar(s, s.biaCookie, [evento({ summary: "da bia 1" }), evento({ summary: "da bia 2", slipId: "slip-bia-0002" })]);
  await enviar(s, s.adminCookie, [evento({ summary: "do admin", slipId: "slip-adm-0001" })]);
  assert.deepEqual((await listar(s, s.biaCookie)).events.map((e) => e.summary), ["da bia 2", "da bia 1"]);
  assert.deepEqual((await listar(s, s.adminCookie)).events.map((e) => e.summary), ["do admin"]);
  const todos = await listarAdmin(s);
  assert.deepEqual(todos.events.map((e) => `${e.username}:${e.summary}`), ["admin:do admin", "bia:da bia 2", "bia:da bia 1"]);
  assert.deepEqual(todos.usernames, ["admin", "bia"]);
  assert.deepEqual((await listarAdmin(s, "?username=bia")).events.map((e) => e.summary), ["da bia 2", "da bia 1"]);
  assert.deepEqual((await listarAdmin(s, "?username=ninguem")).events, []);
});

test("histórico: sem login 401; usuário comum não acessa a visão do administrador (403)", async () => {
  const s = await start();
  assert.equal((await s.req("/api/history")).status, 401);
  assert.equal((await s.req("/api/history", { method: "POST", body: { events: [evento()] } })).status, 401);
  assert.equal((await s.req("/api/admin/history")).status, 401);
  assert.equal((await s.req("/api/admin/history", { cookie: s.biaCookie })).status, 403);
  assert.equal((await s.req("/api/history", { method: "DELETE", cookie: s.biaCookie, body: {} })).status, 405, "não existe apagar histórico");
  assert.equal((await s.req("/api/admin/history", { method: "POST", cookie: s.adminCookie, body: { events: [evento()] } })).status, 405);
});

test("histórico: validação devolve 400 com o motivo; nada é gravado quando um evento é ruim", async () => {
  const s = await start();
  const casos = [
    [{ events: [] }, /pelo menos 1/],
    [{ events: [evento({ slipId: "x" })] }, /slipId/],
    [{ events: [evento({ summary: "" })] }, /resumo/],
    [{ events: [evento({ action: "sent" })] }, /registro/],
    [{ events: [evento(), evento({ action: "hack" })] }, /Evento 2/],
    [{ events: Array.from({ length: 21 }, () => evento()) }, /No máximo 20/],
    [{ nada: true }, /events/],
  ];
  for (const [body, motivo] of casos) {
    const r = await s.req("/api/history", { method: "POST", cookie: s.biaCookie, body });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 50));
    assert.match((await r.json()).error, motivo);
  }
  assert.equal((await listar(s, s.biaCookie)).events.length, 0);
});

test("histórico: envio e cópia com registro, dentro do tamanho permitido (mensagem do WhatsApp grande)", async () => {
  const s = await start();
  const message = "linha da mensagem com acentos ção ✓\n".repeat(250); // ~9 mil caracteres
  const r = await enviar(s, s.biaCookie, [evento({ action: "sent", registration: "091026-0001", summary: "Enviada pelo WhatsApp", detail: { message, stakeCents: 1000 } })]);
  assert.equal(r.status, 201);
  const { events } = await listar(s, s.biaCookie);
  assert.equal(events[0].registration, "091026-0001");
  assert.equal(events[0].detail.message, message, "a mensagem enviada fica guardada inteira e sem alteração");
});

test("histórico: proteção contra CSRF e abuso (origem estranha, tipo errado, corpo gigante)", async () => {
  const s = await start();
  const host = new URL(s.base).host;
  assert.equal((await enviar(s, s.biaCookie, [evento()], { headers: { origin: "https://site-malicioso.example" } })).status, 403);
  assert.equal((await enviar(s, s.biaCookie, [evento()], { headers: { origin: `http://${host}` } })).status, 201);
  const form = await fetch(`${s.base}/api/history`, { method: "POST", redirect: "manual", headers: { cookie: s.biaCookie, "content-type": "application/x-www-form-urlencoded" }, body: "events=1" });
  assert.equal(form.status, 415);
  const gigante = await s.req("/api/history", { method: "POST", cookie: s.biaCookie, raw: JSON.stringify({ events: [evento({ detail: { x: "y".repeat(70_000) } })] }) });
  assert.equal(gigante.status, 413);
  const grande = await s.req("/api/history", { method: "POST", cookie: s.biaCookie, raw: JSON.stringify({ events: [evento({ detail: { x: "y".repeat(40_000) } })] }) });
  assert.equal(grande.status, 400, "cabe no corpo mas passa do limite do detalhe");
  assert.equal((await listar(s, s.biaCookie)).events.length, 1, "só o evento legítimo foi gravado");
});

test("histórico: limite de 120 envios por minuto por usuário; outro usuário não é afetado", async () => {
  const s = await start();
  const codes = [];
  for (let i = 0; i < 122; i++) codes.push((await enviar(s, s.biaCookie, [evento({ summary: `e${i}` })])).status);
  assert.equal(codes.filter((c) => c === 201).length, 120);
  assert.deepEqual(codes.slice(120), [429, 429]);
  assert.equal((await enviar(s, s.adminCookie, [evento()])).status, 201);
  s.clock.t += 61_000;
  assert.equal((await enviar(s, s.biaCookie, [evento()])).status, 201, "a janela passou");
});

test("histórico: paginação por cursor e validação de limit/before", async () => {
  const s = await start();
  for (let i = 1; i <= 5; i++) await enviar(s, s.biaCookie, [evento({ summary: `e${i}` })]);
  const p1 = await listar(s, s.biaCookie, "?limit=2");
  assert.deepEqual(p1.events.map((e) => e.summary), ["e5", "e4"]);
  assert.equal(p1.hasMore, true);
  const p2 = await listar(s, s.biaCookie, `?limit=2&before=${p1.events.at(-1).id}`);
  assert.deepEqual(p2.events.map((e) => e.summary), ["e3", "e2"]);
  const p3 = await listar(s, s.biaCookie, `?limit=2&before=${p2.events.at(-1).id}`);
  assert.deepEqual(p3.events.map((e) => e.summary), ["e1"]);
  assert.equal(p3.hasMore, false);
  for (const qs of ["?limit=0", "?limit=abc", "?limit=-1", "?before=abc", "?before=-3", "?limit=1.5"]) assert.equal((await s.req(`/api/history${qs}`, { cookie: s.biaCookie })).status, 400, qs);
  for (const qs of ["?username=A B", "?username=../etc", "?username=x'--", `?username=${"a".repeat(40)}`, "?limit=0"]) assert.equal((await s.req(`/api/admin/history${qs}`, { cookie: s.adminCookie })).status, 400, qs);
});

test("histórico: criar e excluir usuário ficam registrados na administração, e o histórico do excluído permanece", async () => {
  const s = await start({ clock: { t: Date.parse("2026-10-09T10:00:00Z") } });
  await enviar(s, s.biaCookie, [evento({ summary: "aposta da bia" })]);
  const nova = await s.req("/api/admin/users", { method: "POST", cookie: s.adminCookie, body: { username: "carlos", password: "senha-do-carlos-1", role: "user" } });
  assert.equal(nova.status, 201);
  s.clock.t = Date.parse("2026-10-09T11:00:00Z");
  const biaId = (await s.store.findByUsername("bia")).id;
  assert.equal((await s.req(`/api/admin/users/${biaId}`, { method: "DELETE", cookie: s.adminCookie, body: {} })).status, 200);
  const { events } = await listarAdmin(s);
  const admin = events.filter((e) => e.slipId === "administracao");
  assert.deepEqual(admin.map((e) => [e.action, e.username, e.summary]), [
    ["user_deleted", "admin", 'Excluiu o usuário "bia" (Vendedor)'],
    ["user_created", "admin", 'Criou o usuário "carlos" (Vendedor)'],
  ]);
  assert.equal(admin[0].createdAt, "2026-10-09T11:00:00.000Z");
  assert.deepEqual(admin[1].detail, { target: "carlos", role: "user" });
  const daBia = await listarAdmin(s, "?username=bia");
  assert.deepEqual(daBia.events.map((e) => e.summary), ["aposta da bia"], "o histórico da bia continua, mesmo ela tendo sido excluída");
  assert.equal(daBia.events[0].userId, null);
  assert.ok((await listarAdmin(s)).usernames.includes("bia"));
});

test("histórico: a página /history.html só abre para quem está logado", async () => {
  const s = await start();
  const sem = await s.req("/history.html");
  assert.equal(sem.status, 302);
  assert.equal(sem.headers.get("location"), "/login.html");
});

// ================= Backup e exportação do histórico =================
const settleIO = () => new Promise((r) => setTimeout(r, 20));
async function startComBackup(opts = {}) {
  const store = createMemoryStore(), target = createMemoryBackupTarget();
  const backup = createHistoryBackup({ source: store, target, log: { log() {}, warn() {}, error() {} } });
  await backup.start();
  const s = await start({ store, backup, ...opts });
  return { s, target, backup };
}

test("backup: cada gravação do histórico (e cada ação de administração) é copiada na hora", async () => {
  const { s, target } = await startComBackup();
  assert.equal((await enviar(s, s.biaCookie, [evento({ summary: "um" }), evento({ summary: "dois" })])).status, 201);
  await settleIO();
  assert.equal(await target.count(), 2);
  await s.req("/api/admin/users", { method: "POST", cookie: s.adminCookie, body: { username: "carlos", password: "senha-do-carlos-1", role: "user" } });
  await settleIO();
  assert.equal(await target.count(), 3);
  const copiados = [...target.rows.values()].map((e) => e.summary);
  assert.ok(copiados.includes("um") && copiados.some((x) => /Criou o usuário "carlos"/.test(x)));
  // o histórico copiado sobrevive à exclusão do usuário no banco principal
  const biaId = (await s.store.findByUsername("bia")).id;
  await s.req(`/api/admin/users/${biaId}`, { method: "DELETE", cookie: s.adminCookie, body: {} });
  await settleIO();
  assert.ok([...target.rows.values()].some((e) => e.summary === "um" && e.username === "bia"));
});

test("backup: se o banco de backup cair, o site continua gravando normalmente", async () => {
  const store = createMemoryStore(), real = createMemoryBackupTarget();
  let down = false;
  const target = { ...real, upsertEvents: async (e) => { if (down) throw new Error("fora do ar"); return real.upsertEvents(e); } };
  const backup = createHistoryBackup({ source: store, target, log: { log() {}, warn() {}, error() {} }, setTimer: () => ({ unref() {} }) });
  await backup.start();
  const s = await start({ store, backup });
  down = true;
  assert.equal((await enviar(s, s.biaCookie, [evento()])).status, 201, "a aposta é gravada mesmo sem backup");
  await settleIO();
  assert.equal((await listar(s, s.biaCookie)).events.length, 1);
  const st = await (await s.req("/api/admin/history/backup", { cookie: s.adminCookie })).json();
  assert.equal(st.pending, 1); assert.match(st.lastError, /fora do ar/);
});

test("backup: status só para administrador; sem backup configurado informa desligado", async () => {
  const s = await start();
  assert.deepEqual(await (await s.req("/api/admin/history/backup", { cookie: s.adminCookie })).json(), { enabled: false });
  assert.equal((await s.req("/api/admin/history/backup", { cookie: s.biaCookie })).status, 403);
  assert.equal((await s.req("/api/admin/history/backup")).status, 401);
  assert.equal((await s.req("/api/admin/history/backup", { method: "POST", cookie: s.adminCookie, body: {} })).status, 405);
  const { s: s2 } = await startComBackup();
  const st = await (await s2.req("/api/admin/history/backup", { cookie: s2.adminCookie })).json();
  assert.deepEqual([st.enabled, st.ready, st.pending, st.backedUp], [true, true, 0, 0]);
});

test("exportação: CSV e JSON só para administrador, completos e com cabeçalho de download", async () => {
  const s = await start({ clock: { t: Date.parse("2026-10-09T15:30:12Z") } });
  await enviar(s, s.biaCookie, [evento({ summary: '=HYPERLINK("http://x")' }), evento({ summary: "normal, com vírgula" })]);
  assert.equal((await s.req("/api/admin/history/export", { cookie: s.biaCookie })).status, 403);
  assert.equal((await s.req("/api/admin/history/export")).status, 401);
  assert.equal((await s.req("/api/admin/history/export?format=xml", { cookie: s.adminCookie })).status, 400);
  const csv = await s.req("/api/admin/history/export?format=csv", { cookie: s.adminCookie });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-disposition"), /attachment; filename="historico-mcz-bet-2026-10-09\.csv"/);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  const text = await csv.text();
  const lines = text.replace(/^\uFEFF/, "").trim().split("\r\n");
  assert.equal(lines[0], "id,data_hora_brasilia,data_hora_utc,usuario,aposta,acao,registro,resumo");
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^1,09\/10\/2026 12:30:12,2026-10-09T15:30:12\.000Z,bia,slip-teste-0001,Alterou,,"'=HYPERLINK/);
  assert.match(lines[2], /"normal, com vírgula"$/);
  const json = await (await s.req("/api/admin/history/export?format=json", { cookie: s.adminCookie })).json();
  assert.deepEqual(json.map((e) => e.summary), ['=HYPERLINK("http://x")', "normal, com vírgula"]);
});

test("exportação: percorre mais de uma página (1000+ eventos)", async () => {
  const s = await start();
  for (let i = 0; i < 2; i++) await s.store.addEvents(Array.from({ length: 600 }, (_, k) => ({ userId: null, username: "bia", slipId: "slip-teste-0001", action: "changed", registration: null, summary: `e${i}-${k}`, detail: {}, clientAt: null, createdAt: new Date(1_000_000 + i * 600 + k) })));
  const json = await (await s.req("/api/admin/history/export?format=json", { cookie: s.adminCookie })).json();
  assert.equal(json.length, 1200);
  assert.deepEqual(json.map((e) => e.id), Array.from({ length: 1200 }, (_, i) => i + 1));
});
