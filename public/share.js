// Monta a mensagem de WhatsApp com os jogos selecionados e o link wa.me.
export const MAX_SELECTED = 30; // mantém o link dentro de um tamanho seguro

const odd = (v) => (v == null ? "—" : v.toFixed(2));

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      })
    : "";

// items: [{ league, match }]. Agrupa por campeonato; campeonatos e jogos em ordem de horário.
export function buildMessage(items) {
  const byLeague = new Map();
  for (const it of [...items].sort((a, b) => String(a.match.startTime).localeCompare(String(b.match.startTime)))) {
    if (!byLeague.has(it.league)) byLeague.set(it.league, []);
    byLeague.get(it.league).push(it.match);
  }
  const lines = ["⚽ *Odds Futebol* (1 = casa · X = empate · 2 = fora)"];
  for (const [league, matches] of byLeague) {
    lines.push("", `*${league}*`);
    for (const m of matches) {
      const o = m.odds || {};
      lines.push(`${m.home} × ${m.away}${m.live ? " 🔴 AO VIVO" : ""}`);
      lines.push(`${when(m.startTime) ? when(m.startTime) + " · " : ""}1: ${odd(o.home)} | X: ${odd(o.draw)} | 2: ${odd(o.away)}`);
    }
  }
  lines.push("", "_Odds bet365 via Flashscore; mudam a qualquer momento._");
  return lines.join("\n");
}

export const whatsappUrl = (text) => "https://wa.me/?text=" + encodeURIComponent(text);
