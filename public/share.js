// Emojis: só os do plano básico do Unicode (um único caractere, sem seletor de variação nem junção),
// porque os de 4 bytes (ex.: círculo vermelho) chegam como "�" no WhatsApp Web via link wa.me.
// Monta a mensagem de WhatsApp com os jogos selecionados e o link wa.me.
export const MAX_SELECTED = 30; // mantém o link dentro de um tamanho seguro

export const OUTCOMES = [["home", "Casa"], ["draw", "Empate"], ["away", "Fora"]];

const odd = (v) => (v == null ? "—" : v.toFixed(2));

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      })
    : "";

// items: [{ league, match, picks? }]; picks = subconjunto de ["home","draw","away"] (vazio/ausente = as três). Agrupa por campeonato; campeonatos e jogos em ordem de horário.
export function buildMessage(items) {
  const byLeague = new Map();
  for (const it of [...items].sort((a, b) => String(a.match.startTime).localeCompare(String(b.match.startTime)))) {
    if (!byLeague.has(it.league)) byLeague.set(it.league, []);
    byLeague.get(it.league).push(it);
  }
  const lines = ["⚡ *Odds Futebol*"];
  for (const [league, matches] of byLeague) {
    lines.push("", `*${league}*`);
    for (const { match: m, picks } of matches) {
      const o = m.odds || {};
      const keys = OUTCOMES.filter(([k]) => !picks?.length || picks.includes(k));
      lines.push(`${m.home} × ${m.away}${m.live ? " ⭕ AO VIVO" : ""}`);
      lines.push(`${when(m.startTime) ? when(m.startTime) + " · " : ""}${keys.map(([k, label]) => `${label}: ${odd(o[k])}`).join(" | ")}`);
    }
  }
  lines.push("", "*Odds mudam a qualquer momento*");
  return lines.join("\n");
}

export const whatsappUrl = (text) => "https://wa.me/?text=" + encodeURIComponent(text);
