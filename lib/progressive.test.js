import test from "node:test";
import assert from "node:assert/strict";
import { createProgressiveRenderer } from "../public/progressive.js";

// "Página" de mentira que guarda o HTML como texto e uma fila de fatias agendadas.
function setup(opts = {}) {
  const target = { html: "", writes: 0, set innerHTML(v) { this.html = v; this.writes++; }, get innerHTML() { return this.html; }, insertAdjacentHTML(_pos, v) { this.html += v; this.writes++; } };
  const queue = [];
  const render = createProgressiveRenderer({ target, firstCount: 3, chunkSize: 2, schedule: (fn) => queue.push(fn), ...opts });
  const flush = () => { while (queue.length) queue.shift()(); };
  return { target, queue, render, flush };
}
const items = (n, tag = "i") => Array.from({ length: n }, (_, k) => () => `<${tag}>${k}</${tag}>`);
const joined = (n, tag = "i") => Array.from({ length: n }, (_, k) => `<${tag}>${k}</${tag}>`).join("");

test("só os primeiros itens vão na primeira escrita; o resto vem em fatias, na ordem", () => {
  const { target, queue, render, flush } = setup();
  render(items(8));
  assert.equal(target.html, joined(3), "primeira pintura: só 3 itens");
  assert.equal(queue.length, 1);
  queue.shift()(); // 1ª fatia: itens 3 e 4
  assert.equal(target.html, joined(5));
  flush();
  assert.equal(target.html, joined(8), "no fim, a lista completa e na mesma ordem");
});

test("limites: lista menor que a primeira parte, igual a ela e uma a mais", () => {
  for (const [n, fatias] of [[2, 0], [3, 0], [4, 1], [5, 1], [6, 2]]) {
    const { target, queue, render, flush } = setup();
    render(items(n));
    assert.equal(queue.length, fatias === 0 ? 0 : 1, `n=${n}: fatia agendada`);
    flush();
    assert.equal(target.html, joined(n), `n=${n}: conteúdo final`);
    assert.equal(target.writes, 1 + fatias, `n=${n}: número de escritas`);
  }
});

test("lista vazia mostra o texto de vazio e não agenda nada", () => {
  const { target, queue, render } = setup();
  render([], "<p>Nenhum jogo</p>");
  assert.equal(target.html, "<p>Nenhum jogo</p>");
  assert.equal(queue.length, 0);
});

test("desenhar de novo cancela as fatias pendentes da anterior (nada velho aparece depois)", () => {
  const { target, queue, render, flush } = setup();
  render(items(10, "a"));
  assert.equal(queue.length, 1);
  render(items(5, "b")); // a nova assume antes de a fatia da antiga rodar
  flush();
  assert.equal(target.html, joined(5, "b"));
  assert.ok(!target.html.includes("<a>"));
});

test("cada item é calculado só na hora de escrever (reflete mudanças feitas entre as fatias)", () => {
  const { target, render, flush } = setup();
  let estado = "antes";
  const lista = Array.from({ length: 6 }, (_, k) => () => `<i>${k}:${estado}</i>`);
  render(lista);
  estado = "depois";
  flush();
  assert.equal(target.html, "<i>0:antes</i><i>1:antes</i><i>2:antes</i><i>3:depois</i><i>4:depois</i><i>5:depois</i>");
});

test("valores padrão: 60 na primeira pintura e fatias de 150", () => {
  const target = { html: "", set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; }, insertAdjacentHTML(_p, v) { this.html += v; } };
  const queue = [];
  const render = createProgressiveRenderer({ target, schedule: (fn) => queue.push(fn) });
  render(items(500));
  assert.equal((target.html.match(/<i>/g) || []).length, 60);
  queue.shift()();
  assert.equal((target.html.match(/<i>/g) || []).length, 210);
  while (queue.length) queue.shift()();
  assert.equal((target.html.match(/<i>/g) || []).length, 500);
});
