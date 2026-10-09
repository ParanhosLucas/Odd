import test from "node:test";
import assert from "node:assert/strict";
import { scopedStorage } from "../public/scoped-storage.js";
import { USERNAME_RE } from "./auth.js";

const memory = () => ({ data: {}, getItem(k) { return k in this.data ? this.data[k] : null; }, setItem(k, v) { this.data[k] = v; }, removeItem(k) { delete this.data[k]; } });

test("cada usuário tem o seu espaço; um não enxerga o do outro", () => {
  const raw = memory(), ana = scopedStorage(raw, "ana"), bia = scopedStorage(raw, "Bia");
  ana.setItem("odd.selected", "[1]");
  bia.setItem("odd.selected", "[2]");
  assert.equal(ana.getItem("odd.selected"), "[1]");
  assert.equal(bia.getItem("odd.selected"), "[2]");
  assert.equal(scopedStorage(raw, "carlos").getItem("odd.selected"), null);
  assert.equal(scopedStorage(raw, "BIA").getItem("odd.selected"), "[2]"); // nome sem diferenciar maiúsculas
  ana.removeItem("odd.selected");
  assert.equal(ana.getItem("odd.selected"), null);
  assert.equal(bia.getItem("odd.selected"), "[2]");
  assert.deepEqual(Object.keys(raw.data), ["u:bia:odd.selected"]);
});

test("o prefixo não pode colidir: nomes de usuário não aceitam ':' (que separa o prefixo da chave)", () => {
  for (const ruim of ["a:b", "a:", ":a"]) assert.equal(USERNAME_RE.test(ruim), false, ruim);
  assert.equal(USERNAME_RE.test("ana.silva-2_x"), true);
});
