import test from "node:test";
import assert from "node:assert/strict";
import { parseFeed } from "./flashscore.js";

const feed = "SA÷1¬~ZA÷BRASIL: Série A¬ZB÷1¬~AA÷abc¬AD÷1791313200¬AB÷1¬AE÷Flamengo¬AF÷Palmeiras¬~AA÷def¬AD÷1791313200¬AB÷3¬AE÷X¬AF÷Y¬~AA÷ghi¬AD÷1791313200¬AB÷2¬AE÷A¬AF÷B¬";

test("lê campeonato e jogos agendados/ao vivo, ignora encerrados", () => {
  const [l] = parseFeed(feed);
  assert.equal(l.name, "BRASIL: Série A");
  assert.deepEqual(l.matches.map((m) => [m.id, m.home, m.away, m.live]), [["abc", "Flamengo", "Palmeiras", false], ["ghi", "A", "B", true]]);
});

test("descarta campeonatos sem jogos elegíveis", () => {
  assert.deepEqual(parseFeed("ZA÷L¬~AA÷d¬AB÷3¬AE÷X¬AF÷Y¬"), []);
});
