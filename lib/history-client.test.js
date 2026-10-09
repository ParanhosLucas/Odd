import test from "node:test";
import assert from "node:assert/strict";
import { createTracker, snapshotOf, diffSnapshots } from "../public/history-tracker.js";
import { groupHistory, formatDateTime } from "../public/history-view.js";
import { validateEvents } from "./history.js";

const game = (id, home, away, picks = [], odds = { home: 2.1, draw: 3.25, away: 3.1 }) => ({ league: "BRASIL: Série A", match: { id, home, away, startTime: "2026-10-10T20:00:00Z", odds }, picks });
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), raw: m }; };
function setup(over = {}) {
  const storage = over.storage ?? memStorage();
  const sent = [];
  let n = 0, t = 0;
  const timers = [];
  const tracker = createTracker({
    storage,
    send: over.send ?? (async (events) => { sent.push(...events); return { ok: true, status: 201 }; }),
    newId: () => `slip-test-${++n}`.padEnd(12, "0"),
    nowIso: () => new Date(Date.UTC(2026, 9, 9, 12, 0, t++)).toISOString(),
    setTimer: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h; },
    clearTimer: (h) => { h.cancelled = true; },
  });
  const runTimers = () => { for (const h of timers.splice(0)) if (!h.cancelled) h.fn(); };
  return { tracker, sent, storage, timers, runTimers };
}
const settleQueue = () => new Promise((r) => setImmediate(r));

test("diff: lista jogos, odds escolhidas e valor; ignora variação de odd do mercado", () => {
  const a = snapshotOf([game("g1", "Sport", "Bahia", ["home"])], null);
  const b = snapshotOf([game("g1", "Sport", "Bahia", ["home", "draw"], { home: 1.9, draw: 3.4, away: 3.3 }), game("g2", "Vasco", "Santos")], 5000);
  const d = diffSnapshots(a, b);
  assert.deepEqual(d, [
    "Sport × Bahia: escolheu Empate (3.40)",
    "Adicionou o jogo Vasco × Santos",
    "Definiu o valor da aposta: R$ 50,00",
  ]);
  assert.deepEqual(diffSnapshots(a, snapshotOf([game("g1", "Sport", "Bahia", ["home"], { home: 1.5, draw: 3, away: 4 })], null)), [], "só a odd mudou");
  assert.deepEqual(diffSnapshots(b, a), ["Sport × Bahia: tirou Empate", "Removeu o jogo Vasco × Santos", "Removeu o valor da aposta"]);
  assert.ok(diffSnapshots(snapshotOf([game("g1", "A", "B")], 1000), snapshotOf([game("g1", "A", "B")], 2000)).includes("Alterou o valor da aposta: R$ 10,00 → R$ 20,00"));
});

test("ciclo: cria, altera, envia, copia, muda depois do envio (aposta nova) e limpa", async () => {
  const { tracker, sent } = setup();
  const g1 = game("g1", "Sport", "Bahia", ["home"]), g2 = game("g2", "Vasco", "Santos", ["away"]);
  tracker.commit([g1], null);
  tracker.commit([g1, g2], null);
  tracker.commit([g1, g2], 2000);
  tracker.commit([g1, g2], 2000); // nada mudou: sem evento
  tracker.recordShare("sent", [g1, g2], 2000, "071026-0001", "*MCZ Bet*\n...");
  tracker.recordShare("copied", [g1, g2], 2000, "071026-0001", "⚡ *MCZ Bet*");
  tracker.commit([g1], 2000); // mudou depois de enviada: nova aposta
  tracker.commit([], 2000);
  await settleQueue();
  assert.deepEqual(sent.map((e) => e.action), ["created", "changed", "changed", "sent", "copied", "created", "cleared"]);
  const [c1, ch1, ch2, s, cp, c2, cl] = sent;
  assert.equal(c1.slipId, ch1.slipId); assert.equal(c1.slipId, s.slipId);
  assert.notEqual(c2.slipId, s.slipId, "alterar depois de enviar abre outra aposta");
  assert.equal(cl.slipId, c2.slipId);
  assert.match(c1.summary, /Criou a aposta com 1 jogo: Sport × Bahia \(Casa \(2\.10\)\)/);
  assert.match(ch1.summary, /Adicionou o jogo Vasco × Santos/);
  assert.match(s.summary, /Enviou no WhatsApp a aposta 071026-0001 \(2 jogos\)/);
  assert.equal(s.registration, "071026-0001");
  assert.equal(s.detail.message, "*MCZ Bet*\n...");
  assert.match(c2.summary, /nova aposta a partir da anterior/);
  assert.ok(sent.every((e) => typeof e.clientAt === "string"));
  // O que o tracker produz é aceito pela validação do servidor.
  assert.equal(validateEvents({ events: sent.slice(0, 20) }).ok, true);
});

test("o valor digitado é agrupado (debounce): vários toques viram um evento", async () => {
  const { tracker, sent, timers, runTimers } = setup();
  const g = [game("g1", "A", "B", ["home"]), game("g2", "C", "D")];
  tracker.commit(g, null);
  for (const v of [1000, 1500, 2000]) tracker.track(g, v);
  assert.equal(timers.filter((h) => !h.cancelled).length, 1);
  runTimers();
  await settleQueue();
  assert.deepEqual(sent.map((e) => e.action), ["created", "changed"]);
  assert.match(sent[1].summary, /Definiu o valor da aposta: R\$ 20,00/);
});

test("settle grava a mudança pendente antes de sair da página", async () => {
  const { tracker, sent } = setup();
  const g = [game("g1", "A", "B"), game("g2", "C", "D")];
  tracker.commit(g, null);
  tracker.track(g, 3000);
  tracker.settle();
  await settleQueue();
  assert.equal(sent.at(-1).action, "changed");
});

test("fila: falha de rede mantém os eventos (também após recarregar) e reenvia depois", async () => {
  const storage = memStorage();
  let online = false; const got = [];
  const send = async (events) => { if (!online) return { ok: false, status: 0 }; got.push(...events); return { ok: true, status: 201 }; };
  const a = setup({ storage, send });
  a.tracker.commit([game("g1", "A", "B"), game("g2", "C", "D")], null);
  await settleQueue();
  assert.equal(a.tracker.queueLength, 1);
  assert.equal(got.length, 0);
  online = true;
  const b = setup({ storage, send }); // "recarregou a página": a fila vem do armazenamento
  assert.equal(b.tracker.queueLength, 1);
  b.tracker.commit([game("g1", "A", "B"), game("g2", "C", "D")], null); // mesma aposta: não duplica o "created"
  await b.tracker.flush();
  assert.deepEqual(got.map((e) => e.action), ["created"]);
  assert.equal(b.tracker.queueLength, 0);
});

test("fila: 401 mantém para o próximo login; 400 descarta o lote; lotes de no máximo 20", async () => {
  let status = 401; const sizes = [];
  const send = async (events) => { sizes.push(events.length); return { ok: status === 201, status }; };
  const { tracker } = setup({ send });
  const g = [game("g1", "A", "B", ["home"]), game("g2", "C", "D")];
  tracker.commit(g, null);
  await settleQueue();
  assert.equal(tracker.queueLength, 1, "sessão expirada: não perde");
  const s2 = setup({ send: async (events) => { sizes.push(events.length); return { ok: false, status: 400 }; } });
  s2.tracker.commit(g, null);
  await settleQueue();
  assert.equal(s2.tracker.queueLength, 0, "lote inválido não trava a fila");
  status = 201; sizes.length = 0;
  const s3 = setup({ send });
  for (let i = 0; i < 45; i++) s3.tracker.commit(i % 2 ? g : [g[0]], null);
  await settleQueue(); await settleQueue();
  assert.ok(sizes.every((n) => n <= 20));
});

test("visualização: agrupa por aposta e usuário, status e horário de Brasília", () => {
  const ev = (id, username, slipId, action, createdAt, extra = {}) => ({ id, username, slipId, action, createdAt, summary: "x", registration: null, ...extra });
  const events = [ // mais novo primeiro, como a API devolve
    ev(9, "bia", "slip-bbbb-2", "cleared", "2026-10-09T15:00:00.000Z"),
    ev(8, "admin", "administracao", "user_created", "2026-10-09T14:00:00.000Z"),
    ev(7, "carlos", "slip-aaaa-1", "sent", "2026-10-09T13:00:00.000Z", { registration: "091026-0003" }),
    ev(6, "bia", "slip-bbbb-2", "created", "2026-10-09T12:00:00.000Z"),
    ev(5, "bia", "slip-aaaa-1", "copied", "2026-10-09T11:30:00.000Z", { registration: "091026-0001" }),
    ev(4, "bia", "slip-aaaa-1", "created", "2026-10-09T11:00:00.000Z"),
  ];
  const { slips, admin } = groupHistory(events);
  assert.equal(admin.length, 1);
  assert.equal(slips.length, 3, "mesmo slipId em usuários diferentes não se mistura");
  assert.deepEqual(slips.map((s) => [s.username, s.status]), [["bia", "cleared"], ["carlos", "sent"], ["bia", "copied"]]);
  const copied = slips[2];
  assert.deepEqual(copied.events.map((e) => e.id), [4, 5]);
  assert.deepEqual(copied.registrations, ["091026-0001"]);
  assert.equal(copied.startedAt, "2026-10-09T11:00:00.000Z");
  assert.equal(formatDateTime("2026-10-09T15:30:12.000Z"), "09/10/2026 12:30:12");
  assert.equal(formatDateTime("2026-01-01T02:05:00Z"), "31/12/2025 23:05:00");
  assert.equal(formatDateTime("lixo"), "—");
});
