// Provedor Betano (futebol, mercado 1X2).
//
// ATENÇÃO: o formato abaixo é um mapeamento tolerante, NÃO verificado contra a
// API real (o Betano bloqueia/varia por região e o endpoint pode mudar).
// Configure BETANO_FOOTBALL_URL com a URL JSON que você vê na aba Network do
// navegador ao abrir Futebol no Betano, e ajuste `normalize` se preciso.
// Use apenas se os Termos de Uso do Betano permitirem esse acesso.

const URL_ = process.env.BETANO_FOOTBALL_URL;

const num = (v) => (v == null ? NaN : Number(String(v).replace(",", ".")));

function pick1x2(event) {
  const markets = event.markets || [];
  const m = markets.find((x) => /^(mres|1x2)$/i.test(x.type || "") || /resultado final|1x2|match result/i.test(x.name || ""));
  const sel = m?.selections || [];
  if (sel.length < 3) return null;
  const price = (i) => num(sel[i].price ?? sel[i].odds);
  const [home, draw, away] = [price(0), price(1), price(2)];
  return [home, draw, away].every(Number.isFinite) ? { home, draw, away } : null;
}

export function normalize(json) {
  const blocks = json?.data?.blocks || json?.blocks || json?.leagues || [];
  const leagues = [];
  for (const b of blocks) {
    const matches = [];
    for (const e of b.events || b.matches || []) {
      const odds = pick1x2(e);
      if (!odds) continue;
      const parts = e.participants?.map((p) => p.name) ?? String(e.name || "").split(/\s+[-–v]\s+/i);
      if (parts.length < 2) continue;
      const ts = e.startTime ?? e.startDate;
      matches.push({
        id: String(e.id ?? `${parts[0]}-${parts[1]}`),
        home: parts[0], away: parts[1],
        startTime: ts ? new Date(Number.isFinite(+ts) ? +ts : ts).toISOString() : null,
        live: Boolean(e.liveNow ?? e.live),
        odds,
      });
    }
    if (matches.length) leagues.push({ name: b.name || b.leagueName || "Futebol", matches });
  }
  return leagues;
}

export async function fetchBetano() {
  if (!URL_) throw new Error("BETANO_FOOTBALL_URL não configurada");
  const res = await fetch(URL_, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0", "accept-language": "pt-BR,pt;q=0.9" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Betano respondeu HTTP ${res.status}`);
  const leagues = normalize(await res.json());
  if (!leagues.length) throw new Error("Resposta do Betano sem jogos 1X2 reconhecíveis");
  return leagues;
}
