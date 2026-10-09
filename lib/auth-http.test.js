import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { createMemoryStore } from "./users-store.js";

const publicDir = join(fileURLToPath(new URL("..", import.meta.url)), "public");
const LEAGUES = [{ name: "L", matches: [] }];
const JSON_H = { "content-type": "application/json" };
const servers = [];
after(() => { for (const sv of servers) sv.closeAllConnections(), sv.close(); });

async function start({ env = {}, store = createMemoryStore(), clock = { t: 1_000_000 } } = {}) {
  const config = loadConfig({ NODE_ENV: "production", ...env });
  const auth = createAuth({ store, config, now: () => clock.t });
  await auth.createUser({ username: "admin", password: "senha-admin-1", role: "admin" });
  await auth.createUser({ username: "bia", password: "senha-da-bia-1", role: "user" });
  const server = http.createServer(createApp({ config, store, fetchLeagues: async () => LEAGUES, publicDir, now: () => clock.t }));
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
  for (const p of ["/login.html", "/style.css", "/healthz"]) assert.equal((await s.req(p)).status, 200, p);
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
