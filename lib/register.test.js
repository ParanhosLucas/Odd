import test from "node:test";
import assert from "node:assert/strict";
import { slipKey, brtDate, formatNumber, register, currentRegistration } from "../public/register.js";

const memory = () => ({ data: {}, getItem(k) { return k in this.data ? this.data[k] : null; }, setItem(k, v) { this.data[k] = v; } });
const it = (id, picks) => ({ match: { id }, picks });
const at = (iso) => new Date(iso);

test("formato DDMMAA-NNNN com data de Brasília (UTC-3)", () => {
  assert.equal(formatNumber("071026", 1), "071026-0001");
  assert.equal(formatNumber("071026", 12345), "071026-12345"); // passa de 4 dígitos sem cortar
  assert.equal(brtDate(at("2026-10-07T15:00:00Z")), "071026");
  assert.equal(brtDate(at("2026-10-07T02:30:00Z")), "061026"); // 23:30 do dia 06 em Brasília
  assert.equal(brtDate(at("2026-10-07T03:00:00Z")), "071026"); // meia-noite em Brasília
});

test("slipKey não depende da ordem e muda com jogos, odds ou valor", () => {
  const a = [it("m1", ["home", "away"]), it("m2", [])];
  const b = [it("m2", []), it("m1", ["away", "home"])];
  assert.equal(slipKey(a, 5000), slipKey(b, 5000));
  assert.notEqual(slipKey(a, 5000), slipKey(a, 6000));
  assert.notEqual(slipKey(a, 5000), slipKey([it("m1", ["home"]), it("m2", [])], 5000));
  assert.notEqual(slipKey(a, 5000), slipKey([it("m1", ["home", "away"])], 5000));
  assert.equal(slipKey(a, null), slipKey(a, 0)); // sem valor = 0
});

test("números sequenciais no dia; o mesmo cupom reaproveita o número", () => {
  const s = memory(), now = at("2026-10-07T15:00:00Z");
  const k1 = slipKey([it("m1", ["home"])], 1000), k2 = slipKey([it("m2", ["draw"])], 1000);
  assert.equal(register(s, k1, now), "071026-0001");
  assert.equal(register(s, k1, now), "071026-0001"); // enviar e copiar o mesmo cupom
  assert.equal(currentRegistration(s, k1), "071026-0001");
  assert.equal(register(s, k2, now), "071026-0002"); // cupom diferente
  assert.equal(currentRegistration(s, k1), null);     // o anterior deixou de ser o atual
  assert.equal(register(s, k1, now), "071026-0003");  // voltar ao cupom antigo é um registro novo
});

test("contador reinicia a cada dia (de Brasília) e sobrevive a recarregar", () => {
  const s = memory();
  assert.equal(register(s, "a", at("2026-10-07T15:00:00Z")), "071026-0001");
  assert.equal(register(s, "b", at("2026-10-07T20:00:00Z")), "071026-0002");
  assert.equal(register(s, "c", at("2026-10-08T15:00:00Z")), "081026-0001"); // novo dia
  assert.equal(register(s, "d", at("2026-10-08T02:00:00Z")), "071026-0001"); // 23h do dia 07 em Brasília: contador do dia 08 não vale
});

test("armazenamento corrompido ou indisponível não quebra", () => {
  const bad = { getItem: () => "{nao-json", setItem() {} };
  assert.equal(register(bad, "x", at("2026-10-07T15:00:00Z")), "071026-0001");
  const throws = { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); } };
  assert.equal(register(throws, "x", at("2026-10-07T15:00:00Z")), "071026-0001");
  const weird = memory(); weird.data["odd.regSeq"] = JSON.stringify({ date: "071026", n: -5 });
  assert.equal(register(weird, "x", at("2026-10-07T15:00:00Z")), "071026-0001");
});
