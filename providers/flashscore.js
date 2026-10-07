// Provedor Flashscore: lista de jogos de futebol do dia (feed público do site).
// Formato do feed: registros separados por "~", campos "CHAVE÷valor" separados por "¬".
//   ZA = campeonato (ZL = caminho estável, ZY = país) | AA = id do jogo | AD = início (epoch s) | AE/AF = mandante/visitante
//   AB = status (1 agendado, 2 ao vivo, 3 encerrado)
// Odds 1X2 vêm de outro feed (fo_...): XA/XB/XC = odds atuais (casa/empate/fora),
// YA/YB/YC = odds anteriores, ODA = casa de apostas (16 = bet365).

const BASE = "https://www.flashscore.com.br/x/feed";
const HEADERS = { "x-fsign": "SW9D1eZo", "user-agent": "Mozilla/5.0", "accept-language": "pt-BR,pt;q=0.9" };

const fields = (rec) => Object.fromEntries(rec.split("¬").filter((s) => s.includes("÷")).map((s) => {
  const i = s.indexOf("÷");
  return [s.slice(0, i), s.slice(i + 1)];
}));

export function parseFeed(text) {
  const leagues = [];
  let cur = null;
  for (const rec of text.split("~")) {
    const f = fields(rec);
    if (f.ZA) {
      cur = { id: f.ZL || f.ZA, country: f.ZY || null, name: f.ZA, matches: [] };
      leagues.push(cur);
    } else if (f.AA && cur && (f.AB === "1" || f.AB === "2")) {
      cur.matches.push({
        id: f.AA,
        home: f.AE, away: f.AF,
        startTime: new Date(Number(f.AD) * 1000).toISOString(),
        live: f.AB === "2",
        odds: null,
      });
    }
  }
  return leagues.filter((l) => l.matches.length);
}

export function parseOdds(text) {
  const out = new Map();
  for (const rec of text.split("~")) {
    const f = fields(rec);
    if (!f.AA) continue;
    const n = (k) => (f[k] === undefined ? NaN : Number(f[k]));
    const cur = { home: n("XA"), draw: n("XB"), away: n("XC") };
    if (!Object.values(cur).every(Number.isFinite)) continue;
    const prev = { home: n("YA"), draw: n("YB"), away: n("YC") };
    out.set(f.AA, { ...cur, prev: Object.values(prev).every(Number.isFinite) ? prev : null });
  }
  return out;
}

const get = async (path) => {
  const res = await fetch(`${BASE}/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Flashscore respondeu HTTP ${res.status} em ${path}`);
  return res.text();
};

// Espelha a aba "Odds": só jogos agendados/ao vivo que têm odds 1X2.
export async function fetchFlashscore(dayOffset = 0) {
  const [games, odds] = await Promise.all([
    get(`f_1_${dayOffset}_-3_pt-br_1`),
    get(`fo_1_${dayOffset}_-3_pt-br_1_0`),
  ]);
  const oddsById = parseOdds(odds);
  const leagues = parseFeed(games)
    .map((l) => ({ ...l, matches: l.matches.filter((m) => oddsById.has(m.id)).map((m) => ({ ...m, odds: oddsById.get(m.id) })) }))
    .filter((l) => l.matches.length);
  if (!leagues.length) throw new Error("Flashscore sem jogos com odds");
  return leagues;
}
