import test from "node:test";
import assert from "node:assert/strict";
import { buildMessage, whatsappUrl, MAX_SELECTED } from "../public/share.js";

const m = (home, away, start, extra = {}) => ({ home, away, startTime: start, live: false, odds: { home: 1.66, draw: 3.7, away: 5 }, ...extra });

test("agrupa por campeonato, ordena por horário e formata as odds", () => {
  const text = buildMessage([
    { league: "BRASIL: Série B", match: m("Ponte Preta", "Juventude", "2026-10-07T03:35:00Z") },
    { league: "CHILE: Copa", match: m("Colo Colo", "D. Puerto Montt", "2026-10-07T02:00:00Z", { live: true }) },
    { league: "BRASIL: Série B", match: m("Sport", "São Bernardo", "2026-10-07T01:30:00Z") },
  ]);
  const lines = text.split("\n");
  assert.equal(lines[0].startsWith("⚽ *Odds Futebol*"), true);
  assert.ok(text.indexOf("*BRASIL: Série B*") < text.indexOf("*CHILE: Copa*"), "campeonato do jogo mais cedo vem primeiro");
  assert.ok(text.indexOf("Sport × São Bernardo") < text.indexOf("Ponte Preta × Juventude"), "jogos do mesmo campeonato por horário");
  assert.equal(text.match(/\*BRASIL: Série B\*/g).length, 1);
  assert.match(text, /Colo Colo × D\. Puerto Montt 🔴 AO VIVO/);
  assert.match(text, /1: 1\.66 \| X: 3\.70 \| 2: 5\.00/);
});

test("usa fuso de Brasília na mensagem", () => {
  const text = buildMessage([{ league: "L", match: m("A", "B", "2026-10-07T01:30:00Z") }]);
  assert.match(text, /22:30/); // 01:30 UTC = 22:30 em São Paulo (UTC-3)
});

test("odds ausentes viram traço", () => {
  const text = buildMessage([{ league: "L", match: m("A", "B", null, { odds: null }) }]);
  assert.match(text, /1: — \| X: — \| 2: —/);
});

test("whatsappUrl codifica o texto e há um teto de seleção", () => {
  const url = whatsappUrl("A × B\n1: 2.00 & ?");
  assert.ok(url.startsWith("https://wa.me/?text="));
  assert.equal(decodeURIComponent(url.split("text=")[1]), "A × B\n1: 2.00 & ?");
  const long = buildMessage(Array.from({ length: MAX_SELECTED }, (_, i) => ({ league: "Campeonato Longo Nome " + (i % 5), match: m("Time Mandante " + i, "Time Visitante " + i, "2026-10-07T01:30:00Z") })));
  assert.ok(whatsappUrl(long).length < 8000, `link com ${MAX_SELECTED} jogos tem ${whatsappUrl(long).length} caracteres`);
});
