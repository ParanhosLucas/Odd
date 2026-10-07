import test from "node:test";
import assert from "node:assert/strict";
import { parseFeed, parseOdds } from "./flashscore.js";

const feed = "SA÷1¬~ZA÷BRASIL: Série A¬ZB÷39¬ZY÷Brasil¬ZL÷/futebol/brasil/brasileirao-serie-a/¬~AA÷abc¬AD÷1791313200¬AB÷1¬AE÷Flamengo¬AF÷Palmeiras¬~AA÷def¬AD÷1791313200¬AB÷3¬AE÷X¬AF÷Y¬~AA÷ghi¬AD÷1791313200¬AB÷2¬AE÷A¬AF÷B¬";

test("lê campeonato e só jogos agendados; ignora ao vivo e encerrados", () => {
  const [l] = parseFeed(feed);
  assert.equal(l.name, "BRASIL: Série A");
  assert.equal(l.id, "/futebol/brasil/brasileirao-serie-a/");
  assert.equal(l.country, "Brasil");
  assert.deepEqual(l.matches.map((m) => [m.id, m.home, m.away]), [["abc", "Flamengo", "Palmeiras"]]); // ghi (ao vivo) e def (encerrado) ficam de fora
  assert.equal("live" in l.matches[0], false);
});

test("descarta campeonatos sem jogos elegíveis", () => {
  assert.deepEqual(parseFeed("ZA÷L¬~AA÷d¬AB÷3¬AE÷X¬AF÷Y¬"), []);
});

test("lê odds atuais e anteriores por jogo", () => {
  const m = parseOdds("SA÷1¬~AA÷abc¬AY÷1¬ODA÷16¬XA÷10¬YA÷11¬MG÷2¬XB÷4.75¬YB÷5.25¬MG÷2¬XC÷1.3¬YC÷1.22¬MG÷2¬~AA÷sem¬XA÷2¬");
  assert.deepEqual(m.get("abc"), { home: 10, draw: 4.75, away: 1.3, prev: { home: 11, draw: 5.25, away: 1.22 } });
  assert.equal(m.has("sem"), false);
});

test("campeonato só com jogos ao vivo não aparece", () => {
  assert.deepEqual(parseFeed("ZA÷L¬~AA÷x¬AD÷1791313200¬AB÷2¬AE÷A¬AF÷B¬~AA÷y¬AD÷1791313200¬AB÷2¬AE÷C¬AF÷D¬"), []);
});
