import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const code = readFileSync(join(root, "public", "theme.js"), "utf8");

// Roda o theme.js num "navegador" de mentira e devolve controles para o teste.
function browser({ saved, systemLight = false, storageThrows = false, withButton = true, mediaListener = true } = {}) {
  const store = saved === undefined ? {} : { "odd.theme": saved };
  const docListeners = {}, btnListeners = {};
  const mql = { matches: systemLight, fns: [] };
  if (mediaListener) mql.addEventListener = (_ev, fn) => mql.fns.push(fn);
  const btn = { dataset: {}, attrs: {}, title: "", addEventListener: (ev, fn) => { btnListeners[ev] = fn; }, setAttribute(k, v) { this.attrs[k] = v; } };
  const html = { dataset: {} };
  const ctx = {
    document: { documentElement: html, addEventListener: (ev, fn) => { docListeners[ev] = fn; }, getElementById: (id) => (id === "themeToggle" && withButton ? btn : null) },
    localStorage: storageThrows
      ? { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); } }
      : { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    matchMedia: () => mql,
  };
  vm.runInNewContext(code, ctx);
  return { html, btn, store, mql, ready: () => docListeners.DOMContentLoaded(), click: () => btnListeners.click() };
}

test("escolha salva é aplicada na hora (antes de a página carregar), para não piscar", () => {
  assert.equal(browser({ saved: "light" }).html.dataset.theme, "light");
  assert.equal(browser({ saved: "dark", systemLight: true }).html.dataset.theme, "dark"); // a escolha vence o sistema
});

test("valor salvo inválido é ignorado e o site segue o sistema", () => {
  for (const ruim of ["blue", "", "LIGHT", "null", "1"]) assert.equal(browser({ saved: ruim }).html.dataset.theme, undefined, JSON.stringify(ruim));
});

test("sem escolha, o botão reflete o tema do sistema e não grava nada", () => {
  const claro = browser({ systemLight: true }); claro.ready();
  assert.equal(claro.btn.dataset.mode, "light");
  assert.equal(claro.btn.attrs["aria-label"], "Mudar para o tema escuro");
  assert.equal(claro.html.dataset.theme, undefined);
  assert.deepEqual(claro.store, {});
  const escuro = browser({ systemLight: false }); escuro.ready();
  assert.equal(escuro.btn.dataset.mode, "dark");
  assert.equal(escuro.btn.attrs["aria-label"], "Mudar para o tema claro");
  assert.equal(escuro.btn.title, "Mudar para o tema claro");
});

test("clicar alterna entre escuro e claro e guarda a escolha", () => {
  const b = browser({ systemLight: false }); b.ready();
  b.click();
  assert.equal(b.html.dataset.theme, "light");
  assert.equal(b.store["odd.theme"], "light");
  assert.equal(b.btn.dataset.mode, "light");
  assert.equal(b.btn.attrs["aria-label"], "Mudar para o tema escuro");
  b.click();
  assert.equal(b.html.dataset.theme, "dark");
  assert.equal(b.store["odd.theme"], "dark");
  assert.equal(b.btn.dataset.mode, "dark");
  b.click(); b.click(); b.click();
  assert.equal(b.html.dataset.theme, "light"); // 5 cliques no total: termina no claro
});

test("o primeiro clique parte do tema que está na tela, mesmo vindo do sistema claro", () => {
  const b = browser({ systemLight: true }); b.ready();
  b.click();
  assert.equal(b.html.dataset.theme, "dark");
  assert.equal(b.store["odd.theme"], "dark");
});

test("a escolha salva volta ao reabrir a página, com o botão no estado certo", () => {
  const primeira = browser({ systemLight: false }); primeira.ready(); primeira.click();
  const segunda = browser({ saved: primeira.store["odd.theme"], systemLight: false }); segunda.ready();
  assert.equal(segunda.html.dataset.theme, "light");
  assert.equal(segunda.btn.dataset.mode, "light");
});

test("armazenamento bloqueado (modo privado) não quebra: o tema ainda alterna na sessão", () => {
  const b = browser({ storageThrows: true }); b.ready();
  assert.doesNotThrow(() => b.click());
  assert.equal(b.html.dataset.theme, "light");
  b.click();
  assert.equal(b.html.dataset.theme, "dark");
});

test("página sem o botão (login) só aplica o tema, sem erro", () => {
  const b = browser({ saved: "light", withButton: false });
  assert.doesNotThrow(() => b.ready());
  assert.equal(b.html.dataset.theme, "light");
});

test("sem escolha, acompanha mudanças do sistema; com escolha salva, não", () => {
  const livre = browser({ systemLight: false }); livre.ready();
  livre.mql.matches = true; livre.mql.fns.forEach((fn) => fn());
  assert.equal(livre.btn.dataset.mode, "light");
  const fixo = browser({ saved: "dark", systemLight: false }); fixo.ready();
  fixo.mql.matches = true; fixo.mql.fns.forEach((fn) => fn());
  assert.equal(fixo.btn.dataset.mode, "dark");
  assert.equal(fixo.html.dataset.theme, "dark");
});

test("navegador antigo sem matchMedia.addEventListener não quebra", () => {
  const b = browser({ mediaListener: false });
  assert.doesNotThrow(() => b.ready());
  assert.equal(b.btn.dataset.mode, "dark");
});

test("HTML: o script de tema é o primeiro do <head> (bloqueante, antes do CSS) nas três páginas; o botão está no site", () => {
  for (const page of ["index.html", "login.html", "admin.html"]) {
    const html = readFileSync(join(root, "public", page), "utf8");
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    assert.ok(head.includes('<script src="/theme.js"></script>'), `${page}: sem defer/async/module`);
    assert.ok(head.indexOf('<script src="/theme.js"></script>') < head.indexOf('<link rel="stylesheet"'), `${page}: antes do CSS`);
    assert.equal((head.match(/<script/g) || []).length, 1, `${page}: só o script de tema no head`);
  }
  const index = readFileSync(join(root, "public", "index.html"), "utf8");
  const botao = index.match(/<button id="themeToggle"[\s\S]*?<\/button>/)[0];
  assert.match(botao, /type="button"/);
  assert.match(botao, /aria-label="[^"]+"/);
  assert.match(botao, /class="ico-moon"/);
  assert.match(botao, /class="ico-sun"/);
  assert.ok(index.indexOf('id="themeToggle"') < index.indexOf('id="who"'), "o botão fica ao lado do nome do usuário, antes dele");
});

test("CSS: o claro explícito e o claro 'do sistema' têm as mesmas cores; o escuro é o padrão", () => {
  const css = readFileSync(join(root, "public", "style.css"), "utf8");
  const explicito = css.match(/:root\[data-theme="light"\]\{([^}]*)\}/)[1];
  const doSistema = css.match(/@media \(prefers-color-scheme:light\)\{:root:not\(\[data-theme\]\)\{([^}]*)\}\}/)[1];
  assert.equal(doSistema, explicito, "os dois blocos claros precisam ficar iguais");
  assert.match(explicito, /color-scheme:light/);
  assert.match(css.match(/^:root\{([^}]*)\}/m)[1], /color-scheme:dark/);
  assert.match(css, /#themeToggle\[data-mode="dark"\] \.ico-sun\{display:inline\}/);
  assert.match(css, /#themeToggle\[data-mode="dark"\] \.ico-moon\{display:none\}/);
});
