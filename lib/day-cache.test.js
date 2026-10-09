import test from "node:test";
import assert from "node:assert/strict";
import { createDayCache } from "../public/day-cache.js";

const tick = () => new Promise((r) => setImmediate(r));

// Busca controlável: registra as chamadas e deixa o teste decidir quando cada uma termina.
function fakeFetch() {
  const f = { calls: [], pending: new Map(), fail: new Set() };
  f.fetchDay = (d) => new Promise((resolve, reject) => {
    f.calls.push(d);
    f.pending.set(d, () => (f.fail.has(d) ? reject(new Error(`dia ${d} falhou`)) : resolve({ day: d, v: f.calls.length })));
  });
  f.finish = (d) => { f.pending.get(d)(); f.pending.delete(d); return tick(); };
  return f;
}

test("dia nunca visto: open() devolve cached nulo e uma atualização; depois fica guardado", async () => {
  const f = fakeFetch(), cache = createDayCache({ fetchDay: f.fetchDay });
  const { cached, refresh } = cache.open(1);
  assert.equal(cached, null);
  assert.ok(refresh instanceof Promise);
  await f.finish(1);
  assert.deepEqual((await refresh).day, 1);
  assert.equal(cache.peek(1).data.day, 1);
});

test("dia fresco: devolve na hora e NÃO busca de novo", async () => {
  const f = fakeFetch(), clock = { t: 0 }, cache = createDayCache({ fetchDay: f.fetchDay, now: () => clock.t });
  cache.open(2); await f.finish(2);
  clock.t += 19_000;
  const { cached, refresh } = cache.open(2);
  assert.equal(cached.day, 2);
  assert.equal(refresh, null);
  assert.equal(f.calls.length, 1);
});

test("dia velho: devolve o que tem NA HORA e atualiza por trás", async () => {
  const f = fakeFetch(), clock = { t: 0 }, cache = createDayCache({ fetchDay: f.fetchDay, now: () => clock.t });
  cache.open(2); await f.finish(2);
  clock.t += 21_000;
  const { cached, refresh } = cache.open(2);
  assert.equal(cached.day, 2, "mostra o antigo sem esperar");
  assert.ok(refresh instanceof Promise);
  assert.equal(f.calls.length, 2);
  await f.finish(2);
  assert.equal((await refresh).v, 2);
  assert.equal(cache.peek(2).data.v, 2);
});

test("buscas simultâneas do mesmo dia compartilham uma só", async () => {
  const f = fakeFetch(), cache = createDayCache({ fetchDay: f.fetchDay });
  const a = cache.open(3).refresh, b = cache.open(3).refresh, c = cache.load(3);
  assert.equal(f.calls.length, 1);
  await f.finish(3);
  assert.equal(await a, await b);
  assert.equal(await b, await c);
});

test("prefetch: só dias válidos (0 a 7), sem repetir os frescos nem os já em busca", async () => {
  const f = fakeFetch(), cache = createDayCache({ fetchDay: f.fetchDay });
  cache.prefetch([-1, 8, 1.5, NaN, "2", 0, 1]);
  assert.deepEqual(f.calls, [0, 1]);
  cache.prefetch([0, 1]);                       // já em busca
  assert.deepEqual(f.calls, [0, 1]);
  await f.finish(0); await f.finish(1);
  cache.prefetch([0, 1, 2]);                    // 0 e 1 frescos; só o 2 é novo
  assert.deepEqual(f.calls, [0, 1, 2]);
});

test("falha: a promessa rejeita, a busca é liberada e a próxima tentativa funciona", async () => {
  const f = fakeFetch(), cache = createDayCache({ fetchDay: f.fetchDay });
  f.fail.add(4);
  const { refresh } = cache.open(4);
  const rejeitou = assert.rejects(refresh, /dia 4 falhou/);
  await f.finish(4);
  await rejeitou;
  assert.equal(cache.peek(4), null, "não guarda nada de uma busca que falhou");
  f.fail.delete(4);
  const again = cache.open(4);
  assert.equal(f.calls.length, 2, "tentou de novo");
  await f.finish(4);
  assert.equal((await again.refresh).day, 4);
});

test("prefetch que falha é engolido (sem erro solto) e não estraga o dia", async () => {
  const f = fakeFetch(), cache = createDayCache({ fetchDay: f.fetchDay });
  f.fail.add(5);
  let solto = null; const onRej = (e) => { solto = e; }; process.once("unhandledRejection", onRej);
  cache.prefetch([5]);
  await f.finish(5); await tick(); await tick();
  process.removeListener("unhandledRejection", onRej);
  assert.equal(solto, null);
  assert.equal(cache.peek(5), null);
  f.fail.delete(5);
  cache.prefetch([5]);
  await f.finish(5);
  assert.equal(cache.peek(5).data.day, 5);
});
