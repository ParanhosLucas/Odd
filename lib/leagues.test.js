import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PINNED, shortName, toPinned, loadPinned, savePinned, togglePinned } from "../public/leagues.js";

const memory = (init = {}) => ({ data: { ...init }, getItem(k) { return k in this.data ? this.data[k] : null; }, setItem(k, v) { this.data[k] = v; } });

test("shortName tira o prefixo do país", () => {
  assert.equal(shortName("BRASIL: Brasileirão Série A"), "Brasileirão Série A");
  assert.equal(shortName("AMÉRICA DO NORTE E CENTRAL: Liga das Nações: Liga B"), "Liga das Nações: Liga B");
  assert.equal(shortName("Sem prefixo"), "Sem prefixo");
});

test("padrão: Brasileirão A/B, Copa do Brasil e as copas sul-americanas; vazio salvo é respeitado", () => {
  assert.deepEqual(loadPinned(memory()).map((p) => p.title), ["Brasileirão Série A", "Brasileirão Série B", "Copa do Brasil", "Copa América", "Copa Libertadores", "Copa Sul-Americana"]);
  assert.deepEqual(loadPinned(memory({ "odd.pinned": "[]" })), []);
});

test("dados corrompidos no storage voltam ao padrão sem quebrar", () => {
  assert.equal(loadPinned(memory({ "odd.pinned": "{nao-json" })).length, DEFAULT_PINNED.length);
  assert.deepEqual(loadPinned(memory({ "odd.pinned": '[{"id":1},null,{"id":"/x/","title":"X"}]' })), [{ id: "/x/", title: "X" }]);
});

test("fixar, desafixar e persistir", () => {
  const league = { id: "/futebol/inglaterra/premier-league/", name: "INGLATERRA: Premier League", country: "Inglaterra" };
  const pin = toPinned(league);
  assert.deepEqual(pin, { id: "/futebol/inglaterra/premier-league/", title: "Premier League", country: "Inglaterra" });
  const store = memory();
  let list = togglePinned(loadPinned(store), pin);
  assert.equal(list.at(-1).title, "Premier League");
  savePinned(store, list);
  assert.equal(loadPinned(store).length, DEFAULT_PINNED.length + 1);
  list = togglePinned(list, pin);
  assert.equal(list.length, DEFAULT_PINNED.length);
  assert.equal(togglePinned(list, DEFAULT_PINNED[0]).length, DEFAULT_PINNED.length - 1); // desafixa uma padrão
});

test("liga sem id usa o nome como identificador", () => {
  assert.equal(toPinned({ name: "X: Y" }).id, "X: Y");
});
