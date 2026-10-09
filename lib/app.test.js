import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createAuth } from "./auth.js";
import { createMemoryStore } from "./users-store.js";

const publicDir = join(fileURLToPath(new URL("..", import.meta.url)), "public");
const LEAGUES = [{ name: "L", matches: [{ id: "1", home: "A", away: "B", startTime: null, odds: { home: 2, draw: 3, away: 4, prev: null } }] }];

const servers = [];
after(() => { for (const sv of servers) sv.closeAllConnections(), sv.close(); });

// Estes testes são sobre cache, validação, limites e estáticos: o servidor já sobe com um usuário logado.
// (O login em si é testado em auth-http.test.js.)
let COOKIE = "";
const authed = (init = {}) => ({ ...init, headers: { ...init.headers, cookie: COOKIE } });

async function start({ env = {}, fetchLeagues, fetchFallback, clock = { t: 1_000_000 } } = {}) {
  const config = loadConfig({ NODE_ENV: "production", ...env });
  const store = createMemoryStore();
  await createAuth({ store, config, now: () => clock.t }).createUser({ username: "tester", password: "senha-de-teste-1", role: "user" });
  const app = createApp({ config, store, fetchLeagues, fetchFallback, publicDir, now: () => clock.t });
  const server = http.createServer(app);
  servers.push(server);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "tester", password: "senha-de-teste-1" }) });
  COOKIE = login.headers.get("set-cookie").split(";")[0];
  return { base, clock, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}
const getJson = async (url) => { const r = await fetch(url, authed()); return { status: r.status, body: await r.json(), headers: r.headers }; };

test("cache: duas requisições dentro do TTL fazem uma única busca", async () => {
  let calls = 0;
  const s = await start({ fetchLeagues: async () => (calls++, LEAGUES) });
  const a = await getJson(`${s.base}/api/odds`);
  await getJson(`${s.base}/api/odds`);
  assert.equal(calls, 1);
  assert.equal(a.body.source, "flashscore");
  assert.equal(a.body.stale, false);
  await s.close();
});

test("requisições simultâneas compartilham a mesma busca", async () => {
  let calls = 0;
  const s = await start({ fetchLeagues: async () => { calls++; await new Promise((r) => setTimeout(r, 50)); return LEAGUES; } });
  await Promise.all([1, 2, 3, 4].map(() => getJson(`${s.base}/api/odds?day=1`)));
  assert.equal(calls, 1);
  await s.close();
});

test("após o TTL responde na hora com o dado anterior; se a atualização falhar, a resposta seguinte avisa (stale)", async () => {
  let fail = false;
  const s = await start({ fetchLeagues: async () => { if (fail) throw new Error("fora do ar"); return LEAGUES; } });
  await getJson(`${s.base}/api/odds`);
  fail = true;
  s.clock.t += 31_000;
  const first = await getJson(`${s.base}/api/odds`); // não espera a busca: devolve o que já tem
  assert.equal(first.status, 200);
  assert.equal(first.body.leagues.length, 1);
  await new Promise((r) => setTimeout(r, 30)); // a atualização em segundo plano falha
  const r = await getJson(`${s.base}/api/odds`);
  assert.equal(r.status, 200);
  assert.equal(r.body.stale, true);
  assert.equal(r.body.error, "fora do ar");
  assert.equal(r.body.leagues.length, 1);
  await s.close();
});

test("dado stale mais velho que STALE_MAX_SECONDS não é servido: 502 em produção", async () => {
  let fail = false;
  const s = await start({ fetchLeagues: async () => { if (fail) throw new Error("fora do ar"); return LEAGUES; } });
  await getJson(`${s.base}/api/odds`);
  fail = true;
  s.clock.t += 601_000;
  const r = await getJson(`${s.base}/api/odds`);
  assert.equal(r.status, 502);
  assert.match(r.body.detail, /fora do ar/);
  await s.close();
});

test("demo como reserva só quando habilitada", async () => {
  const fetchFallback = async () => LEAGUES;
  const off = await start({ fetchLeagues: async () => { throw new Error("x"); }, fetchFallback });
  assert.equal((await getJson(`${off.base}/api/odds`)).status, 502);
  await off.close();
  const on = await start({ env: { DEMO_FALLBACK: "1" }, fetchLeagues: async () => { throw new Error("x"); }, fetchFallback });
  const r = await getJson(`${on.base}/api/odds`);
  assert.equal(r.body.source, "demo");
  await on.close();
});

test("valida o parâmetro day", async () => {
  const s = await start({ fetchLeagues: async () => LEAGUES });
  for (const bad of ["-1", "8", "abc", "1.5", ""]) assert.equal((await getJson(`${s.base}/api/odds?day=${bad}`)).status, 400, bad);
  assert.equal((await getJson(`${s.base}/api/odds?day=7`)).status, 200);
  await s.close();
});

test("rate limit devolve 429 com Retry-After", async () => {
  const s = await start({ env: { RATE_LIMIT_PER_MINUTE: "3" }, fetchLeagues: async () => LEAGUES });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await getJson(`${s.base}/api/odds`)).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  assert.ok((await fetch(`${s.base}/api/odds`, authed())).headers.get("retry-after"));
  await s.close();
});

test("/healthz e métodos não permitidos", async () => {
  const s = await start({ fetchLeagues: async () => LEAGUES });
  assert.equal((await getJson(`${s.base}/healthz`)).body.ok, true);
  assert.equal((await fetch(`${s.base}/api/odds`, authed({ method: "POST" }))).status, 405);
  await s.close();
});

test("estáticos: serve index, bloqueia path traversal, envia cabeçalhos de segurança", async () => {
  const s = await start({ fetchLeagues: async () => LEAGUES });
  const idx = await fetch(`${s.base}/`, authed());
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal((await fetch(`${s.base}/..%2fpackage.json`, authed())).status, 404);
  assert.equal((await fetch(`${s.base}/%2e%2e/package.json`, authed())).status, 404);
  assert.equal((await fetch(`${s.base}/nao-existe.js`, authed())).status, 404);
  await s.close();
});
