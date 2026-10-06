// Provedor Flashscore: lista de jogos de futebol do dia (feed público do site).
// Formato do feed: registros separados por "~", campos "CHAVE÷valor" separados por "¬".
//   ZA = campeonato | AA = id do jogo | AD = início (epoch s) | AE/AF = mandante/visitante
//   AB = status (1 agendado, 2 ao vivo, 3 encerrado)
// Odds NÃO vêm neste feed (ficam em global.ds.lsapp.eu); ver fetchOdds.

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
      cur = { name: f.ZA, matches: [] };
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

export async function fetchFlashscore(dayOffset = 0) {
  const res = await fetch(`${BASE}/f_1_${dayOffset}_-3_pt-br_1`, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Flashscore respondeu HTTP ${res.status}`);
  const leagues = parseFeed(await res.text());
  if (!leagues.length) throw new Error("Feed do Flashscore sem jogos");
  return leagues;
}
