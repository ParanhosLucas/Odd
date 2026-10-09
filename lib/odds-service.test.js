import test from "node:test";
import assert from "node:assert/strict";
import { createOddsService } from "./odds-service.js";

const quiet = { log() {}, warn() {}, error() {} };
const tick = () => new Promise((r) => setImmediate(r));

// Fonte controlável: cada busca devolve uma versão nova e pode ser segurada/falhada pelo teste.
function source() {
  const s = { calls: [], version: 0, failWith: null, hold: null };
  s.fetch = async (day) => {
    s.calls.push(day);
    if (s.hold) await s.hold;
    if (s.failWith) throw new Error(s.failWith);
    return [{ name: `v${++s.version}`, matches: [] }];
  };
  return s;
}
const make = (src, clock, extra = {}) =>
  createOddsService({ fetchLeagues: src.fetch, ttlMs: 30_000, staleMaxMs: 600_000, maxDay: 7, now: () => clock.t, log: quiet, ...extra });
const name = (body) => body.leagues[0].name;

test("dado fresco: não busca de novo dentro do TTL", async () => {
  const src = source(), clock = { t: 0 }, svc = make(src, clock);
  await svc.get(0);
  clock.t += 29_000;
  assert.equal(name(await svc.get(0)), "v1");
  assert.equal(src.calls.length, 1);
});

test("TTL cresce com a distância: hoje 30 s, amanhã 60 s, depois 5 min", async () => {
  const src = source(), clock = { t: 0 }, svc = make(src, clock);
  for (const d of [0, 1, 2]) await svc.get(d);
  clock.t += 45_000; // passou do TTL de hoje, não do de amanhã nem dos dias seguintes
  for (const d of [0, 1, 2]) await svc.get(d);
  await tick();
  assert.deepEqual(src.calls.sort(), [0, 0, 1, 2]); // só o dia 0 foi atualizado
  clock.t += 20_000; // 65 s: agora amanhã também; dia 2 (5 min) ainda não
  for (const d of [1, 2]) await svc.get(d);
  await tick();
  assert.deepEqual(src.calls.sort(), [0, 0, 1, 1, 2]);
  clock.t += 250_000; // 315 s: o dia 2 passa dos 5 min
  await svc.get(2); await tick();
  assert.deepEqual(src.calls.filter((d) => d === 2).length, 2);
});

test("stale-while-revalidate: depois do TTL responde NA HORA com o dado velho e atualiza por trás", async () => {
  const src = source(), clock = { t: 0 }, svc = make(src, clock);
  await svc.get(0);
  clock.t += 40_000;
  let release; src.hold = new Promise((r) => { release = r; }); // a busca nova fica pendurada
  const resposta = await Promise.race([svc.get(0), new Promise((r) => setTimeout(() => r("TRAVOU"), 50))]);
  assert.notEqual(resposta, "TRAVOU", "não pode esperar a busca");
  assert.equal(name(resposta), "v1");
  assert.equal(resposta.stale, false);
  assert.equal(src.calls.length, 2); // a atualização começou
  release(); src.hold = null; await tick(); await tick();
  assert.equal(name(await svc.get(0)), "v2"); // a próxima já vem atualizada
  assert.equal(src.calls.length, 2);
});

test("várias requisições durante a atualização em segundo plano disparam uma única busca", async () => {
  const src = source(), clock = { t: 0 }, svc = make(src, clock);
  await svc.get(0);
  clock.t += 40_000;
  let release; src.hold = new Promise((r) => { release = r; });
  await Promise.all([1, 2, 3, 4, 5].map(() => svc.get(0)));
  assert.equal(src.calls.length, 2);
  release(); await tick();
});

test("sem dado nenhum: espera a busca, e requisições simultâneas compartilham uma só", async () => {
  const src = source(), clock = { t: 0 }, svc = make(src, clock);
  let release; src.hold = new Promise((r) => { release = r; });
  const todas = Promise.all([svc.get(3), svc.get(3), svc.get(3)]);
  await tick();
  assert.equal(src.calls.length, 1);
  release();
  const bodies = await todas;
  assert.ok(bodies.every((b) => name(b) === "v1"));
});

test("dado velho demais (além de staleMax) não é servido: espera a busca nova", async () => {
  const src = source(), clock = { t: 0 }, svc = make(src, clock);
  await svc.get(0);
  clock.t += 601_000;
  let release; src.hold = new Promise((r) => { release = r; });
  const p = svc.get(0);
  assert.equal(await Promise.race([p, new Promise((r) => setTimeout(() => r("ESPERANDO"), 40))]), "ESPERANDO");
  release();
  assert.equal(name(await p), "v2");
});

test("falha em segundo plano: mantém o dado, avisa stale + erro e NÃO martela a fonte (espera 10 s)", async () => {
  const src = source(), clock = { t: 0 }, svc = make(src, clock);
  await svc.get(0);
  clock.t += 40_000;
  src.failWith = "fonte caiu";
  assert.equal(name(await svc.get(0)), "v1"); // responde na hora
  await tick(); await tick();
  const r = await svc.get(0);
  assert.equal(r.stale, true);
  assert.equal(r.error, "fonte caiu");
  assert.equal(name(r), "v1");
  assert.equal(src.calls.length, 2);
  for (let i = 0; i < 20; i++) await svc.get(0);  // rajada de requisições
  await tick();
  assert.equal(src.calls.length, 2, "dentro da espera de 10 s não tenta de novo");
  clock.t += 11_000;
  src.failWith = null;
  await svc.get(0); await tick(); await tick();
  assert.equal(src.calls.length, 3, "passada a espera, tenta de novo");
  const ok = await svc.get(0);
  assert.equal(ok.stale, false);
  assert.equal(ok.error, null);
  assert.equal(name(ok), "v2");
});

test("sem dado e com falha: usa a reserva se houver; senão propaga o erro", async () => {
  const src = source(), clock = { t: 0 };
  src.failWith = "sem rede";
  await assert.rejects(make(src, clock).get(0), /sem rede/);
  const demo = make(src, clock, { fetchFallback: async () => [{ name: "demo", matches: [] }] });
  const r = await demo.get(0);
  assert.equal(r.source, "demo");
  assert.equal(r.error, "sem rede");
});

test("aquecimento: busca os dias em ordem, sem derrubar nada se um falhar", async () => {
  const src = source(), clock = { t: 0 }, svc = make(src, clock);
  const real = src.fetch;
  const fetch = async (d) => { if (d === 1) throw new Error("dia 1 falhou"); return real(d); };
  const aquecido = createOddsService({ fetchLeagues: fetch, ttlMs: 30_000, staleMaxMs: 600_000, maxDay: 7, now: () => clock.t, log: quiet });
  await assert.doesNotReject(aquecido.warm([0, 1, 2, 3]));
  assert.deepEqual(src.calls, [0, 2, 3]);
  const antes = src.calls.length;
  await aquecido.get(2); await aquecido.get(3);
  assert.equal(src.calls.length, antes, "dias aquecidos já estão em cache");
  assert.ok(aquecido.lastSuccessAt() !== null);
  void svc;
});

test("o mesmo objeto é devolvido enquanto tudo está bem (permite reaproveitar a serialização)", async () => {
  const src = source(), clock = { t: 0 }, svc = make(src, clock);
  const a = await svc.get(0), b = await svc.get(0);
  assert.equal(a, b);
});
