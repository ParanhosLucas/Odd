import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMessage } from "../public/share.js";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const pub = (f) => readFileSync(join(root, "public", f), "utf8");
const PAGES = ["index.html", "login.html", "admin.html"];

test("todas as páginas usam o nome Mcz Bet no título e a logo como ícone da aba", () => {
  for (const page of PAGES) {
    const html = pub(page);
    assert.match(html, /<title>[^<]*Mcz Bet<\/title>/, `${page}: título`);
    assert.match(html, /<link rel="icon" href="\/logo\.svg" type="image\/svg\+xml">/, `${page}: ícone da aba`);
    assert.match(html, /<img src="\/logo\.svg" alt=""/, `${page}: logo na página`);
    assert.match(html, /Mcz <b>Bet<\/b>/, `${page}: nome ao lado da logo`);
  }
});

test("o nome antigo não aparece em lugar nenhum do site, da documentação nem do código", () => {
  const velho = /Odds · Futebol|Odds Futebol|Odds de Futebol|# Odd\b|Odd em http/;
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
  assert.match(svg, /aria-label="Mcz Bet"/);
  assert.match(svg, /<\/svg>\s*$/);
  assert.doesNotMatch(svg, /<script|onload|onclick|href=|xlink|https?:\/\/(?!www\.w3\.org)/i);
  assert.ok(svg.length < 2000, "logo leve, carrega na hora");
});

test("a mensagem do WhatsApp começa com o nome novo", () => {
  const items = [{ league: "L", match: { id: "1", home: "A", away: "B", startTime: "2026-10-07T01:30:00Z", odds: { home: 2, draw: 3, away: 4 } } }];
  assert.match(buildMessage(items), /^⚡ \*Mcz Bet\*\n/);
  assert.match(buildMessage(items, { emojis: false }), /^\*Mcz Bet\*\n/);
});
