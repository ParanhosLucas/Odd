import test from "node:test";
import assert from "node:assert/strict";
import { createHistoryBackup, createMemoryBackupTarget, createPgBackupTarget, createNoBackup } from "./history-backup.js";
import { createMemoryStore } from "./users-store.js";
import { csvRow, csvHeader } from "./history-export.js";

const quiet = { log() {}, warn() {}, error() {} };
const ev = (n, over = {}) => ({ userId: 1, username: "bia", slipId: "slip-0000001", action: "changed", registration: null, summary: `e${n}`, detail: { n }, clientAt: null, createdAt: new Date(Date.UTC(2026, 9, 9, 12, 0, n)), ...over });
const timers = () => { const q = []; return { q, setTimer: (fn, ms) => { const h = { fn, ms, unref() {} }; q.push(h); return h; }, clearTimer() {}, run: async () => { for (const h of q.splice(0)) { h.fn(); } await new Promise((r) => setImmediate(r)); } }; };
const settle = () => new Promise((r) => setImmediate(r));

test("cada gravação é copiada para o backup, sem duplicar", async () => {
  const source = createMemoryStore(), target = createMemoryBackupTarget();
  const b = createHistoryBackup({ source, target, ...quiet });
  await b.start();
  b.push(await source.addEvents([ev(1), ev(2)]));
  await settle();
  b.push(await source.addEvents([ev(3)]));
  await settle();
  assert.equal(await target.count(), 3);
  const again = await source.listEventsAfter({ afterId: 0 });
  b.push(again); await settle(); // reenvio do mesmo: idempotente
  assert.equal(await target.count(), 3);
  const s = await b.status();
  assert.deepEqual([s.enabled, s.ready, s.pending, s.backedUp, s.lastError], [true, true, 0, 3, null]);
  assert.ok(s.lastOkAt);
});

test("ao iniciar, copia o que faltava (reinício do servidor, queda no meio)", async () => {
  const source = createMemoryStore(), target = createMemoryBackupTarget();
  await source.addEvents([ev(1), ev(2), ev(3)]);
  await target.upsertEvents(await source.listEventsAfter({ afterId: 0, limit: 1 }));
  await source.addEvents([ev(4)]);
  const b = createHistoryBackup({ source, target, ...quiet });
  await b.start();
  assert.equal(await target.count(), 4);
});

test("banco de backup fora do ar: fila + nova tentativa; nada se perde e push nunca lança", async () => {
  const source = createMemoryStore(), real = createMemoryBackupTarget();
  let down = false;
  const target = { ...real, upsertEvents: async (e) => { if (down) throw new Error("Connection terminated"); return real.upsertEvents(e); } };
  const t = timers();
  const b = createHistoryBackup({ source, target, setTimer: t.setTimer, clearTimer: t.clearTimer, ...quiet });
  await b.start();
  down = true;
  assert.doesNotThrow(() => b.push([{ id: 1, ...ev(1), createdAt: ev(1).createdAt.toISOString() }]));
  await settle();
  let s = await b.status();
  assert.equal(s.pending, 1);
  assert.match(s.lastError, /Connection terminated/);
  assert.equal(t.q.length, 1, "uma nova tentativa agendada");
  down = false;
  await t.run();
  s = await b.status();
  assert.equal(s.pending, 0); assert.equal(s.lastError, null);
  assert.equal(await real.count(), 1);
});

test("espera entre tentativas cresce (2 s, 4 s, …) e tem teto", async () => {
  const t = timers();
  const target = { async init() {}, async maxSourceId() { return 0; }, async count() { return 0; }, async upsertEvents() { throw new Error("fora"); } };
  const b = createHistoryBackup({ source: createMemoryStore(), target, setTimer: t.setTimer, clearTimer: t.clearTimer, ...quiet });
  await b.start();
  const waits = [];
  b.push([{ id: 1, ...ev(1) }]); await settle(); waits.push(t.q.at(-1).ms);
  for (let i = 0; i < 12; i++) { await t.run(); waits.push(t.q.at(-1)?.ms); }
  assert.equal(waits[0], 2000); assert.equal(waits[1], 4000);
  assert.ok(Math.max(...waits) <= 300_000);
});

test("sem BACKUP_DATABASE_URL: desligado e inofensivo", async () => {
  const b = createNoBackup();
  b.push([{ id: 1 }]);
  assert.deepEqual(await b.status(), { enabled: false });
});

test("exportação CSV: horário de Brasília e fórmulas de planilha neutralizadas", () => {
  assert.equal(csvHeader(), "id,data_hora_brasilia,data_hora_utc,usuario,aposta,acao,registro,resumo");
  const row = csvRow({ id: 7, createdAt: "2026-10-09T15:30:12.000Z", username: "bia", slipId: "slip-0000001", action: "sent", registration: "091026-0001", summary: 'Enviou "x", ok' });
  assert.equal(row, '7,09/10/2026 12:30:12,2026-10-09T15:30:12.000Z,bia,slip-0000001,Enviou no WhatsApp,091026-0001,"Enviou ""x"", ok"');
  assert.match(csvRow({ id: 1, createdAt: "2026-10-09T15:30:12.000Z", username: "u", slipId: "s", action: "changed", registration: null, summary: '=HYPERLINK("http://x","y")' }), /,"'=HYPERLINK\(""http:\/\/x"",""y""\)"$/);
});

// contrato do destino Postgres (roda com pg-mem ou Postgres real, como os testes do users-store)
const { newDb } = await import("pg-mem").catch(() => ({}));
test("destino Postgres: idempotente, chave (id, data), maxSourceId e count", { skip: !newDb && "pg-mem indisponível" }, async () => {
  const mem = newDb(); const { Pool } = mem.adapters.createPg();
  const pool = new Pool(); const target = createPgBackupTarget(pool);
  await target.init(); // pg-mem não aceita repetir CREATE ... IF NOT EXISTS
  const e = (id, t) => ({ id, userId: null, username: "bia", slipId: "slip-0000001", action: "sent", registration: "091026-0001", summary: "ç ã 🙂", detail: { message: "olá" }, clientAt: null, createdAt: t });
  await target.upsertEvents([e(1, "2026-10-09T12:00:00.000Z"), e(2, "2026-10-09T12:00:01.000Z")]);
  await target.upsertEvents([e(2, "2026-10-09T12:00:01.000Z")]);
  assert.equal(await target.count(), 2);
  assert.equal(await target.maxSourceId(), 2);
  await target.upsertEvents([e(1, "2027-01-01T00:00:00.000Z")]); // mesmo id, outro banco recriado: é outro evento
  assert.equal(await target.count(), 3);
  await pool.end();
});

// Postgres de verdade (TEST_DATABASE_URL): dois esquemas = dois "bancos"; o principal é recriado do zero no fim.
const REAL = process.env.TEST_DATABASE_URL;
test("Postgres real: principal -> backup, init repetido, reinício e banco principal recriado", { skip: !REAL && "TEST_DATABASE_URL não definida" }, async () => {
  const { default: pg } = await import("pg");
  const { isolatedDb } = await import("./db-for-tests.js");
  const { createPgStore } = await import("./users-store.js");
  const dbA = await isolatedDb(REAL), dbB = await isolatedDb(REAL);
  const poolA = new pg.Pool({ connectionString: dbA.url }), poolB = new pg.Pool({ connectionString: dbB.url });
  try {
    const source = createPgStore(poolA); await source.init();
    const target = createPgBackupTarget(poolB);
    const mk = () => createHistoryBackup({ source, target, ...quiet });
    let b = mk(); await b.start(); await target.init(); // init repetido é seguro
    b.push(await source.addEvents([ev(1, { userId: null }), ev(2, { userId: null, detail: { message: "olá 🙂 ç" } })]));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await target.count(), 2);
    // servidor "reiniciado" com um evento gravado enquanto o backup estava fora
    await source.addEvents([ev(3, { userId: null })]);
    b = mk(); await b.start();
    assert.equal(await target.count(), 3);
    const { rows } = await poolB.query("SELECT detail FROM bet_events_backup WHERE source_id = 2");
    assert.equal(JSON.parse(rows[0].detail).message, "olá 🙂 ç");
    // banco principal apagado e recriado: os ids recomeçam e o evento novo NÃO é confundido com um antigo
    await poolA.query("DROP TABLE bet_events"); await source.init();
    b = mk(); await b.start();
    b.push(await source.addEvents([ev(9, { userId: null, createdAt: new Date(Date.UTC(2027, 0, 1)) })]));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await target.count(), 4, "backup antigo preservado + evento novo");
  } finally { await poolA.end(); await poolB.end(); await dbA.drop(); await dbB.drop(); }
});
