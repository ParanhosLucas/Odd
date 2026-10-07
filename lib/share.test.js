import test from "node:test";
import assert from "node:assert/strict";
import { buildMessage, whatsappUrl, parseStake, formatBRL, payoutCents, MAX_SELECTED } from "../public/share.js";

const m = (home, away, start, extra = {}) => ({ home, away, startTime: start, live: false, odds: { home: 1.66, draw: 3.7, away: 5 }, ...extra });

test("agrupa por campeonato, ordena por horário e formata as odds", () => {
  const text = buildMessage([
    { league: "BRASIL: Série B", match: m("Ponte Preta", "Juventude", "2026-10-07T03:35:00Z") },
    { league: "CHILE: Copa", match: m("Colo Colo", "D. Puerto Montt", "2026-10-07T02:00:00Z", { live: true }) },
    { league: "BRASIL: Série B", match: m("Sport", "São Bernardo", "2026-10-07T01:30:00Z") },
  ]);
  const lines = text.split("\n");
  assert.equal(lines[0], "⚡ *Odds Futebol*");
  assert.ok(text.indexOf("*BRASIL: Série B*") < text.indexOf("*CHILE: Copa*"), "campeonato do jogo mais cedo vem primeiro");
  assert.ok(text.indexOf("Sport × São Bernardo") < text.indexOf("Ponte Preta × Juventude"), "jogos do mesmo campeonato por horário");
  assert.equal(text.match(/\*BRASIL: Série B\*/g).length, 1);
  assert.match(text, /Colo Colo × D\. Puerto Montt ⭕ AO VIVO/);
  assert.match(text, /\*Casa\*: 1\.66 \| \*Empate\*: 3\.70 \| \*Fora\*: 5\.00/);
});

test("usa fuso de Brasília na mensagem", () => {
  const text = buildMessage([{ league: "L", match: m("A", "B", "2026-10-07T01:30:00Z") }]);
  assert.match(text, /22:30/); // 01:30 UTC = 22:30 em São Paulo (UTC-3)
});

test("odds ausentes viram traço", () => {
  const text = buildMessage([{ league: "L", match: m("A", "B", null, { odds: null }) }]);
  assert.match(text, /\*Casa\*: — \| \*Empate\*: — \| \*Fora\*: —/);
});

test("whatsappUrl codifica o texto e há um teto de seleção", () => {
  const url = whatsappUrl("A × B\n1: 2.00 & ?");
  assert.ok(url.startsWith("https://wa.me/?text="));
  assert.equal(decodeURIComponent(url.split("text=")[1]), "A × B\n1: 2.00 & ?");
  const long = buildMessage(Array.from({ length: MAX_SELECTED }, (_, i) => ({ league: "Campeonato Longo Nome " + (i % 5), match: m("Time Mandante " + i, "Time Visitante " + i, "2026-10-07T01:30:00Z") })));
  assert.ok(whatsappUrl(long).length < 8000, `link com ${MAX_SELECTED} jogos tem ${whatsappUrl(long).length} caracteres`);
});

test("com picks, a mensagem leva só as odds escolhidas (na ordem Casa, Empate, Fora)", () => {
  const match = m("Guiana Francesa", "Belize", "2026-10-07T02:00:00Z", { odds: { home: 2.1, draw: 3.25, away: 3.1 } });
  const only = (picks) => buildMessage([{ league: "L", match, picks }]).split("\n").find((l) => /\*Casa\*:|\*Empate\*:|\*Fora\*:/.test(l));
  assert.match(only(["away", "home"]), /\*Casa\*: 2\.10 \| \*Fora\*: 3\.10$/);
  assert.match(only(["draw"]), /\*Empate\*: 3\.25$/);
  assert.doesNotMatch(only(["draw"]), /\*Casa\*: |\*Fora\*: /);
  assert.match(only([]), /\*Casa\*: 2\.10 \| \*Empate\*: 3\.25 \| \*Fora\*: 3\.10$/); // vazio = as três
  assert.match(only(undefined), /\*Casa\*: 2\.10 \| \*Empate\*: 3\.25 \| \*Fora\*: 3\.10$/);
});

test("sem referência à fonte, sem frase antiga e sem caractere de substituição U+FFFD", () => {
  const text = buildMessage([
    { league: "L", match: m("A", "B", "2026-10-07T01:30:00Z", { live: true }) },
    { league: "M", match: m("C", "D", "2026-10-07T02:30:00Z") },
  ]);
  assert.equal(text.includes("\uFFFD"), false);
  assert.equal(text.includes("Odds mudam"), false); // frase antiga removida
  assert.equal(text.includes("bet365"), false);
  // o link carrega os emojis como UTF-8 válido (ida e volta sem perda)
  assert.equal(decodeURIComponent(whatsappUrl(text).split("text=")[1]), text);
});

test("com emojis (padrão, usado ao copiar): ⚡ no título e ⭕ nos jogos ao vivo", () => {
  const text = buildMessage([{ league: "L", match: m("A", "B", "2026-10-07T01:30:00Z", { live: true }) }]);
  assert.deepEqual([...text].filter((c) => /\p{Extended_Pictographic}/u.test(c)), ["⚡", "⭕"]);
  assert.match(text, /^⚡ \*Odds Futebol\*/);
  assert.match(text, /A × B ⭕ AO VIVO/);
});

test("sem emojis (usado no link do WhatsApp): nada de pictogramas, mesmo conteúdo", () => {
  const items = [{ league: "L", match: m("A", "B", "2026-10-07T01:30:00Z", { live: true }) }];
  const plain = buildMessage(items, { emojis: false });
  assert.doesNotMatch(plain, /\p{Extended_Pictographic}/u);
  assert.match(plain, /^\*Odds Futebol\*/);
  assert.match(plain, /A × B \(AO VIVO\)/);
  assert.match(plain, /\*Casa\*: 1\.66 \| \*Empate\*: 3\.70 \| \*Fora\*: 5\.00/);
  assert.doesNotMatch(plain, /Valor da aposta/); // sem valor informado, sem rodapé
  // o link só carrega texto sem emojis (nenhuma sequência de 3 ou 4 bytes de emoji)
  assert.doesNotMatch(whatsappUrl(plain), /%E2%(9A|AD)|%F0%9F/i);
});

test("parseStake: formatos pt-BR, ponto decimal e entradas inválidas", () => {
  assert.equal(parseStake("50"), 5000);
  assert.equal(parseStake("50,5"), 5050);
  assert.equal(parseStake("50,50"), 5050);
  assert.equal(parseStake("50.25"), 5025);
  assert.equal(parseStake("1.234,56"), 123456);
  assert.equal(parseStake("R$ 1.234,56"), 123456);
  assert.equal(parseStake("0,01"), 1);
  assert.equal(parseStake(",5"), 50);
  for (const bad of ["", "   ", "abc", "0", "0,00", "-5", "1,234", "50,555", "1.234.567", ".", ",", "1e3", "9999999,99999", "10000000", null, undefined]) {
    assert.equal(parseStake(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseStake("9999999,99"), 999999999);
});

test("formatBRL: milhar com ponto, vírgula decimal, dois dígitos", () => {
  assert.equal(formatBRL(5), "R$ 0,05");
  assert.equal(formatBRL(5000), "R$ 50,00");
  assert.equal(formatBRL(10500), "R$ 105,00");
  assert.equal(formatBRL(123456), "R$ 1.234,56");
  assert.equal(formatBRL(100000000), "R$ 1.000.000,00");
  assert.ok(!formatBRL(123456).includes("\u00a0")); // sem espaço "duro"
});

test("payoutCents: aposta × odd arredondada ao centavo (sem erro de ponto flutuante)", () => {
  assert.equal(payoutCents(5000, 2.1), 10500);   // 50 × 2,10 = 105,00
  assert.equal(payoutCents(5000, 3.1), 15500);
  assert.equal(payoutCents(1000, 1.66), 1660);
  assert.equal(payoutCents(333, 1.5), 500);      // 4,995 -> 5,00 (arredonda)
  assert.equal(payoutCents(1, 1.02), 1);         // 1,02 centavo -> 1 centavo
  assert.equal(payoutCents(10, 51), 510);
  assert.equal(payoutCents(5000, 1.1), 5500);    // 1,1 em float é 1,1000000000000001
});

test("com valor da aposta: retorno por odd e rodapé 'Valor da aposta'", () => {
  const match = m("Guiana Francesa", "Belize", "2026-10-07T02:00:00Z", { odds: { home: 2.1, draw: 3.25, away: 3.1 } });
  const text = buildMessage([{ league: "L", match, picks: ["home", "away"] }], { stakeCents: 5000 });
  assert.match(text, /Guiana Francesa × Belize\n.*\n\*Casa\*: 2\.10 \(retorno: R\$ 105,00\)\n\*Fora\*: 3\.10 \(retorno: R\$ 155,00\)\n/);
  assert.doesNotMatch(text, /Empate/);
  assert.ok(text.endsWith("\n\n*Valor da aposta*: R$ 50,00"));
  assert.doesNotMatch(text, /Odds mudam/);
  // sem picks: as três odds, cada uma com retorno
  const all = buildMessage([{ league: "L", match }], { stakeCents: 123456 });
  assert.match(all, /\*Empate\*: 3\.25 \(retorno: R\$ 4\.012,32\)/); // 1234,56 × 3,25
  assert.ok(all.endsWith("*Valor da aposta*: R$ 1.234,56"));
});

test("odd ausente com valor de aposta não quebra e não inventa retorno", () => {
  const text = buildMessage([{ league: "L", match: m("A", "B", null, { odds: { home: 2, draw: null, away: 4 } }) }], { stakeCents: 1000 });
  assert.match(text, /\*Empate\*: —\n/);
  assert.match(text, /\*Casa\*: 2\.00 \(retorno: R\$ 20,00\)/);
});

test("link do WhatsApp com valor de aposta continua sem emojis e com texto íntegro", () => {
  const items = [{ league: "L", match: m("A", "B", "2026-10-07T01:30:00Z", { live: true }), picks: ["draw"] }];
  const plain = buildMessage(items, { emojis: false, stakeCents: 2550 });
  assert.doesNotMatch(plain, /\p{Extended_Pictographic}/u);
  assert.match(plain, /\*Valor da aposta\*: R\$ 25,50$/);
  assert.equal(decodeURIComponent(whatsappUrl(plain).split("text=")[1]), plain);
});
