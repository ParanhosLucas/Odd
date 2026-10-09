import test, { after } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createMemoryStore, createPgStore, DuplicateUserError, LastAdminError } from "./users-store.js";
import { hashPassword, verifyPassword } from "./passwords.js";

// pg-mem não entende "CREATE TABLE IF NOT EXISTS" repetido, então aqui o init roda uma vez.
const makePgMem = async () => {
  const { Pool } = newDb().adapters.createPg();
  const store = createPgStore(new Pool());
  await store.init();
  return store;
};

// Postgres de verdade, se TEST_DATABASE_URL estiver definida (ex.: postgres://odd@127.0.0.1:54329/odd_test).
const REAL = process.env.TEST_DATABASE_URL;
const pools = [];
const makeReal = async () => {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: REAL });
  pools.push(pool);
  await pool.query("DROP TABLE IF EXISTS sessions, users");
  const store = createPgStore(pool);
  await store.init();
  await store.init(); // idempotente: roda em todo início do servidor
  return store;
};
after(() => Promise.all(pools.map((p) => p.end())));

// O mesmo conjunto de verificações vale para as duas implementações.
const IMPLEMENTATIONS = [["memória", async () => createMemoryStore(), false], ["pg-mem", makePgMem, false], ["Postgres real", makeReal, !REAL]];
for (const [name, make, skip] of IMPLEMENTATIONS) {
  test(`[${name}] cria, lista e busca usuários; nome repetido é recusado`, { skip }, async () => {
    const s = await make();
    const a = await s.createUser({ username: "ana", passwordHash: "h1", role: "admin" });
    await s.createUser({ username: "bia", passwordHash: "h2", role: "user" });
    assert.equal(a.username, "ana");
    assert.equal("passwordHash" in a || "password_hash" in a, false); // a resposta pública nunca traz o hash
    assert.deepEqual((await s.listUsers()).map((u) => [u.username, u.role]), [["ana", "admin"], ["bia", "user"]]);
    assert.equal((await s.findByUsername("bia")).passwordHash, "h2");
    assert.equal(await s.findByUsername("nao-existe"), null);
    await assert.rejects(s.createUser({ username: "ana", passwordHash: "x", role: "user" }), DuplicateUserError);
    assert.equal(await s.countAdmins(), 1);
  });

  test(`[${name}] sessões: válida, expirada, removida; excluir usuário derruba as sessões dele`, { skip }, async () => {
    const s = await make();
    const u = await s.createUser({ username: "ana", passwordHash: "h", role: "admin" });
    const v = await s.createUser({ username: "bia", passwordHash: "h", role: "user" });
    const now = new Date("2026-10-09T12:00:00Z");
    await s.createSession("tok-ok", v.id, new Date(now.getTime() + 3600e3));
    await s.createSession("tok-velho", v.id, new Date(now.getTime() - 1000));
    await s.createSession("tok-ana", u.id, new Date(now.getTime() + 3600e3));
    assert.equal((await s.findSession("tok-ok", now)).username, "bia");
    assert.equal(await s.findSession("tok-velho", now), null);   // expirada
    assert.equal(await s.findSession("inexistente", now), null);
    await s.deleteSession("tok-ok");
    assert.equal(await s.findSession("tok-ok", now), null);
    await s.createSession("tok-2", v.id, new Date(now.getTime() + 3600e3));
    assert.equal(await s.deleteUser(v.id), true);
    assert.equal(await s.findSession("tok-2", now), null);       // sessão do excluído caiu junto
    assert.equal((await s.findSession("tok-ana", now)).username, "ana"); // a dos outros continua
    await s.purgeExpired(now);
  });

  test(`[${name}] nunca exclui o último administrador; id inexistente devolve false`, { skip }, async () => {
    const s = await make();
    const a = await s.createUser({ username: "ana", passwordHash: "h", role: "admin" });
    const u = await s.createUser({ username: "bia", passwordHash: "h", role: "user" });
    await assert.rejects(s.deleteUser(a.id), LastAdminError);
    assert.equal(await s.deleteUser(9999), false);
    const b = await s.createUser({ username: "cris", passwordHash: "h", role: "admin" });
    assert.equal(await s.deleteUser(a.id), true);                // agora há outro admin
    await assert.rejects(s.deleteUser(b.id), LastAdminError);    // e este virou o último
    assert.equal(await s.deleteUser(u.id), true);                // usuário comum sempre pode
    assert.equal(await s.countAdmins(), 1);
  });
}

test("senhas: hash scrypt verifica, rejeita senha errada e hash malformado, sal diferente a cada vez", async () => {
  const h1 = await hashPassword("segredo-123"), h2 = await hashPassword("segredo-123");
  assert.match(h1, /^scrypt\$32768\$8\$1\$/);
  assert.notEqual(h1, h2);
  assert.equal(h1.includes("segredo-123"), false);
  assert.equal(await verifyPassword("segredo-123", h1), true);
  assert.equal(await verifyPassword("segredo-124", h1), false);
  assert.equal(await verifyPassword("", h1), false);
  for (const bad of ["", "texto", "scrypt$x$y$z$a$b", "bcrypt$1$2$3$a$b", "scrypt$9999999999$8$1$YQ==$YQ=="]) assert.equal(await verifyPassword("x", bad), false, bad);
  // parâmetros guardados no hash: um hash antigo, mais fraco, continua válido
  const fraco = await hashPassword("outra", { N: 1024, r: 8, p: 1 });
  assert.equal(await verifyPassword("outra", fraco), true);
});
