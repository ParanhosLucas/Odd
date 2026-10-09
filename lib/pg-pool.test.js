import test, { after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createPgPool, isRetryable, normalizeDatabaseUrl } from "./pg-pool.js";
import { createPgStore } from "./users-store.js";
import { isolatedDb } from "./db-for-tests.js";

const quiet = { error() {}, warn() {}, log() {} };

// Pool de mentira: cada chamada a query() consome o próximo comportamento da lista.
const fakePool = (script) => {
  class Fake extends EventEmitter {
    constructor(options) { super(); Fake.options = options; Fake.calls = 0; }
    async query() { Fake.calls++; const step = script.shift(); if (step instanceof Error) throw step; return step; }
    async end() {}
  }
  return Fake;
};
const err = (message, code) => Object.assign(new Error(message), code ? { code } : {});

test("normalizeDatabaseUrl: sslmode=require vira verify-full; o resto fica igual", () => {
  const base = "postgresql://u:p@ep-x-pooler.sa-east-1.aws.neon.tech/neondb";
  assert.equal(normalizeDatabaseUrl(`${base}?sslmode=require&channel_binding=require`), `${base}?sslmode=verify-full&channel_binding=require`);
  assert.equal(normalizeDatabaseUrl(`${base}?channel_binding=require&sslmode=require`), `${base}?channel_binding=require&sslmode=verify-full`);
  assert.equal(normalizeDatabaseUrl(`${base}?sslmode=require`), `${base}?sslmode=verify-full`);
  for (const igual of [base, `${base}?sslmode=verify-full`, `${base}?sslmode=disable`, `${base}?sslmode=required-not`, "postgres://u:p@dpg-abc-a/db"]) {
    assert.equal(normalizeDatabaseUrl(igual), igual);
  }
});

test("configuração do pool: ociosas fecham em 3 min (antes de o Neon dormir), espera 15 s, keep-alive, máximo 5", () => {
  const Fake = fakePool([]);
  createPgPool({ connectionString: "postgresql://u:p@h/d?sslmode=require" }, { PoolClass: Fake, log: quiet });
  assert.deepEqual(
    { ...Fake.options, connectionString: undefined },
    { connectionString: undefined, ssl: undefined, max: 5, idleTimeoutMillis: 180_000, connectionTimeoutMillis: 15_000, keepAlive: true },
  );
  assert.match(Fake.options.connectionString, /sslmode=verify-full/);
  createPgPool({ connectionString: "postgresql://u:p@h/d", ssl: true }, { PoolClass: Fake, log: quiet });
  assert.deepEqual(Fake.options.ssl, { rejectUnauthorized: false });
});

test("isRetryable: reconhece conexão derrubada e banco acordando, ignora erros de SQL", () => {
  for (const e of [err("Connection terminated unexpectedly"), err("read ECONNRESET"), err("connect ECONNREFUSED 1.2.3.4:5432"), err("timeout exceeded when trying to connect"), err("terminating connection due to administrator command", "57P01"), err("the database system is starting up", "57P03")]) {
    assert.equal(isRetryable(e), true, e.message);
  }
  for (const e of [err("duplicate key value violates unique constraint", "23505"), err('relation "users" does not exist', "42P01"), err("syntax error", "42601"), null, undefined]) {
    assert.equal(isRetryable(e), false, String(e?.message));
  }
});

test("consulta que falha por conexão derrubada é repetida uma vez e dá certo", async () => {
  const Fake = fakePool([err("Connection terminated unexpectedly"), { rows: [{ n: 1 }] }]);
  const pool = createPgPool({ connectionString: "postgresql://u:p@h/d" }, { PoolClass: Fake, retryDelayMs: 1, log: quiet });
  assert.deepEqual((await pool.query("select 1")).rows, [{ n: 1 }]);
  assert.equal(Fake.calls, 2);
});

test("só repete UMA vez; erro de SQL nunca é repetido", async () => {
  const twice = fakePool([err("Connection terminated unexpectedly"), err("read ECONNRESET"), { rows: [] }]);
  const a = createPgPool({ connectionString: "postgresql://u:p@h/d" }, { PoolClass: twice, retryDelayMs: 1, log: quiet });
  await assert.rejects(a.query("select 1"), /ECONNRESET/);
  assert.equal(twice.calls, 2);
  const sql = fakePool([err("duplicate key", "23505"), { rows: [] }]);
  const b = createPgPool({ connectionString: "postgresql://u:p@h/d" }, { PoolClass: sql, retryDelayMs: 1, log: quiet });
  await assert.rejects(b.query("insert"), /duplicate key/);
  assert.equal(sql.calls, 1);
});

// ---- Postgres de verdade: derrubar as conexões (como o Neon faz ao suspender) e continuar funcionando ----
const REAL = process.env.TEST_DATABASE_URL;
const ended = [];
after(() => Promise.all(ended.map((p) => p.end())));

test("Postgres real: conexões derrubadas pelo servidor não derrubam o app", { skip: !REAL }, async () => {
  const { default: pg } = await import("pg");
  const db = await isolatedDb(REAL); // esquema próprio: não atrapalha (nem é atrapalhado por) outros testes
  const admin = new pg.Pool({ connectionString: REAL, max: 1 });
  ended.push(admin, { end: () => db.drop() });
  const pool = createPgPool({ connectionString: db.url }, { retryDelayMs: 20, log: quiet });
  ended.push(pool);
  const store = createPgStore(pool);
  await store.init();
  await store.createUser({ username: "ana", passwordHash: "h", role: "admin" });
  // derruba SÓ as conexões deste teste (identificadas pelo application_name), como o Neon faz ao suspender
  const kill = () => admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1", [db.schema]);
  for (const espera of [0, 0, 150, 0]) { // corre contra o aviso de conexão caída e também com o aviso já recebido
    await kill();
    if (espera) await new Promise((r) => setTimeout(r, espera));
    assert.equal((await store.findByUsername("ana")).username, "ana", `espera ${espera} ms`);
  }
  await kill();
  assert.equal(await store.countAdmins(), 1);
});
