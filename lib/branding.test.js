import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMessage } from "../public/share.js";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const pub = (f) => readFileSync(join(root, "public", f), "utf8");
const PAGES = ["index.html", "login.html", "admin.html"];

test("todas as páginas usam o nome MCZ Bet no título e a logo como ícone da aba", () => {
  for (const page of PAGES) {
    const html = pub(page);
    assert.match(html, /<title>[^<]*MCZ Bet<\/title>/, `${page}: título`);
    assert.match(html, /<link rel="icon" href="\/logo\.svg" type="image\/svg\+xml">/, `${page}: ícone da aba`);
    assert.match(html, /<img src="\/logo\.svg" alt=""/, `${page}: logo na página`);
    assert.match(html, /MCZ <b>Bet<\/b>/, `${page}: nome ao lado da logo`);
  }
});

test("o nome antigo (e a grafia \"Mcz\") não aparece em lugar nenhum do site, da documentação nem do código", () => {
  const velho = /Odds · Futebol|Odds Futebol|Odds de Futebol|# Odd\b|Odd em http|Mcz/; // "Mcz" (só a primeira maiúscula) também é nome antigo: a grafia certa é MCZ
  const arquivos = [];
  const varrer = (dir) => {
    for (const nome of readdirSync(dir)) {
      if (["node_modules", ".git"].includes(nome)) continue;
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) { varrer(caminho); continue; }
      if (/\.(js|html|css|md|yaml|json|svg)$/.test(nome) && nome !== "package-lock.json" && nome !== "branding.test.js") arquivos.push(caminho);
    }
  };
  varrer(root);
  assert.ok(arquivos.length > 20);
  for (const f of arquivos) assert.doesNotMatch(readFileSync(f, "utf8"), velho, f.replace(root, ""));
});

test("a logo é um SVG válido, escalável e sem scripts nem endereços externos", () => {
  const svg = pub("logo.svg");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64"/);
  assert.match(svg, /aria-label="MCZ Bet"/);
  assert.match(svg, /<\/svg>\s*$/);
  assert.doesNotMatch(svg, /<script|onload|onclick|href=|xlink|https?:\/\/(?!www\.w3\.org)/i);
  assert.ok(svg.length < 2000, "logo leve, carrega na hora");
});

test("a mensagem do WhatsApp começa com o nome novo", () => {
  const items = [{ league: "L", match: { id: "1", home: "A", away: "B", startTime: "2026-10-07T01:30:00Z", odds: { home: 2, draw: 3, away: 4 } } }];
  assert.match(buildMessage(items), /^⚡ \*MCZ Bet\*\n/);
  assert.match(buildMessage(items, { emojis: false }), /^\*MCZ Bet\*\n/);
});

// ---- cores da marca: azul-turquesa (e não laranja) ----
const hexes = (text) => [...text.matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => `#${m[1].toLowerCase()}`);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hue = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// lê "--nome:#abc" ou "--nome:#aabbcc" de um bloco de CSS e devolve sempre 6 dígitos
const cssVar = (bloco, nome) => {
  const m = bloco.match(new RegExp(`--${nome}:#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b`));
  if (!m) return undefined;
  return `#${(m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1]).toLowerCase()}`;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("logo: o 'M' é o mesmo, a bola de futebol substituiu o detalhe de cima e as cores são turquesa", () => {
  const svg = pub("logo.svg");
  assert.ok(svg.includes('d="M14 52V27l18 17 18-17v25"'), "o desenho do M não mudou");
  assert.match(svg, /<path d="M14 52V27l18 17 18-17v25" fill="none" stroke="#fff"/);
  assert.match(svg, /<clipPath id="b"><circle /);           // a bola (círculo branco com remendos recortados)
  assert.match(svg, /<circle cx="32" cy="19\.5" r="10\.5" fill="#fff"\/>/);
  const cores = hexes(svg).filter((c) => c !== "#ffffff");
  assert.ok(cores.length >= 3);
  for (const c of cores) assert.ok(hue(c) >= 165 && hue(c) <= 205, `${c} (matiz ${hue(c).toFixed(0)}°) fora da faixa turquesa`);
  for (const laranja of ["#ff6b00", "#f05400", "#ff8f24"]) assert.ok(!svg.toLowerCase().includes(laranja), laranja);
});

test("site: a cor da marca é turquesa nos dois temas; o laranja só marca a odd que não mudou", () => {
  const css = pub("style.css");
  const claro = css.match(/:root\[data-theme="light"\]\{([^}]*)\}/)[1];
  const escuro = css.match(/^:root\{([^}]*)\}/m)[1];
  const v = cssVar;
  for (const [tema, bloco] of [["claro", claro], ["escuro", escuro]]) {
    for (const nome of ["brand", "on-brand"]) assert.ok(v(bloco, nome), `--${nome} definido no tema ${tema}`);
    assert.ok(hue(v(bloco, "brand")) >= 165 && hue(v(bloco, "brand")) <= 205, `tema ${tema}: --brand é turquesa`);
  }
  // laranja/âmbar que sobra no CSS: só a odd "sem mudança" (verde = subiu, vermelho = caiu)
  // e a faixa de aviso (âmbar = atenção), que é semântica e não cor de marca
  const faixaDeAviso = css.match(/#banner\{[^}]*\}/)[0];
  const alaranjadas = (texto) => hexes(texto).filter((c) => hue(c) >= 15 && hue(c) <= 45);
  assert.deepEqual(alaranjadas(faixaDeAviso), ["#5a3a00", "#ffd9a0"]);
  const semAvisos = css.replace(faixaDeAviso, "").replace(/--warn:#[0-9a-fA-F]{6}/g, ""); // --warn = âmbar de atenção (aviso do mínimo de jogos)
  assert.deepEqual(alaranjadas(semAvisos), ["#ff6b00"]);
  assert.match(css, /--odd-flat:#ff6b00/);
  assert.match(css, /\.o b\{color:var\(--odd-flat\)/);
  assert.doesNotMatch(css, /var\(--acc\)|rgba\(240,\s*84/);
});

test("acessibilidade: botão e texto de marca têm contraste mínimo de 4,5:1 nos dois temas", () => {
  const css = pub("style.css");
  const claro = css.match(/:root\[data-theme="light"\]\{([^}]*)\}/)[1];
  const escuro = css.match(/^:root\{([^}]*)\}/m)[1];
  const v = cssVar;
  const temas = [["claro", claro, "#ffffff"], ["escuro", escuro, v(escuro, "card")]];
  for (const [tema, bloco, card] of temas) {
    const brand = v(bloco, "brand"), sobre = v(bloco, "on-brand");
    assert.ok(contrast(sobre, brand) >= 4.5, `${tema}: texto do botão ${contrast(sobre, brand).toFixed(2)}`);
    assert.ok(contrast(brand, card) >= 4.5, `${tema}: nome/links sobre o card ${contrast(brand, card).toFixed(2)}`);
  }
  assert.match(css, /button\.primary\{[^}]*background:var\(--brand\);color:var\(--on-brand\)/);
  for (const [tema, bloco, card] of temas) { // aviso âmbar do mínimo de jogos
    const warn = v(bloco, "warn");
    assert.ok(warn, `${tema}: --warn definido`);
    assert.ok(contrast(warn, card) >= 4.5, `${tema}: aviso sobre o card ${contrast(warn, card).toFixed(2)}`);
  }
});

test("celular: sem content-visibility (cartão ficava vazio no Safari), campos de 16 px (sem zoom no iPhone) e alvos de 44 px", () => {
  const css = pub("style.css");
  const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(semComentarios, /content-visibility|contain-intrinsic-size/);
  assert.match(css, /@media \(pointer:coarse\)\{input,select,textarea\{font-size:16px\}\}/);
  const toque = css.match(/\/\* Telas de toque: todo alvo tocável com pelo menos 44 px \*\/\s*@media \(pointer:coarse\)\{([\s\S]*?)\n\}/)[1];
  for (const regra of ["#days button{width:44px;height:44px}", "min-width:44px;min-height:44px", "#q{min-height:44px}", "#account a,#logout{display:inline-flex;align-items:center;min-height:44px"]) assert.ok(toque.includes(regra), regra);
});

test("celular: as três páginas usam viewport-fit=cover e a barra reserva a altura real no fim da lista", () => {
  for (const page of ["index.html", "login.html", "admin.html"]) {
    assert.match(pub(page), /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/, page);
    assert.doesNotMatch(pub(page), /maximum-scale|user-scalable=no/, `${page}: não pode travar o zoom (acessibilidade)`);
  }
  assert.match(pub("style.css"), /main\{padding-bottom:calc\(var\(--bar-h,0px\) \+ 16px\)\}/);
  assert.match(pub("app.js"), /new ResizeObserver\(\(\) => document\.documentElement\.style\.setProperty\("--bar-h"/);
});

test("celular: cabeçalho em duas linhas (marca + tema; depois usuário e links) e barra de baixo em três linhas", () => {
  const css = pub("style.css");
  const cab = css.match(/@media \(max-width:560px\)\{\s*\.top\{flex-wrap:wrap[\s\S]*?\n\}/)[0];
  assert.match(cab, /h1\.brand\{[^}]*white-space:nowrap/);   // a marca nunca quebra em duas linhas
  assert.match(cab, /#account\{display:contents\}/);
  assert.match(cab, /#who\{[^}]*text-overflow:ellipsis/);       // usuário comprido é cortado, não empurra o layout
  const barra = css.match(/@media \(max-width:560px\)\{\s*#bar\{flex-direction:column[\s\S]*?\n\}/)[0];
  assert.match(barra, /#barActions\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.25fr\)/); // Copiar e Enviar lado a lado, sem estourar
  assert.match(barra, /#barStake\{display:flex/);
  const html = pub("index.html");
  assert.ok(html.indexOf('id="barInfo"') < html.indexOf('id="barStake"') && html.indexOf('id="barStake"') < html.indexOf('id="barActions"'));
  assert.match(html.match(/<div id="barStake">[\s\S]*?<\/div>/)[0], /id="clear"/); // Limpar fica na linha do valor
  assert.match(html.match(/<div id="barActions">[\s\S]*?<\/div>/)[0], /id="copy"[\s\S]*id="send"/);
});
