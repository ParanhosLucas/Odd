// Emojis: a página wa.me do WhatsApp mostra "�" no lugar de qualquer emoji que chega pelo link (mesmo
// os simples). Por isso o link é enviado sem emojis ({ emojis: false }); a mensagem COM emojis serve
// para o botão "Copiar mensagem", que cola o texto direto no WhatsApp sem passar pelo link.
// Monta a mensagem de WhatsApp com os jogos selecionados e o link wa.me.
export const MAX_SELECTED = 30;
export const MAX_LINK_LENGTH = 7500; // servidores costumam recusar URLs acima de ~8 mil caracteres

export const OUTCOMES = [["home", "Casa"], ["draw", "Empate"], ["away", "Fora"]];

const odd = (v) => (v == null ? "—" : v.toFixed(2));

// ---- Valor da aposta -------------------------------------------------------------------------
// Tudo em centavos inteiros para não acumular erro de ponto flutuante.
const MAX_STAKE_CENTS = 999_999_999; // R$ 9.999.999,99

// "50" | "50,5" | "1.234,56" | "R$ 50.25" -> centavos (5000, 5050, 123456, 5025); inválido/zero -> null.
export function parseStake(input) {
  let t = String(input ?? "").replace(/R\$|\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", "."); // pt-BR: ponto = milhar, vírgula = decimal
  else if ((t.match(/\./g) || []).length > 1) return null;          // "1.234.567" sem vírgula é ambíguo
  if (!/^\d*\.?\d{0,2}$/.test(t) || t === ".") return null;        // no máximo 2 casas decimais
  const cents = Math.round(Number(t) * 100);
  return Number.isFinite(cents) && cents > 0 && cents <= MAX_STAKE_CENTS ? cents : null;
}

// 105000 -> "R$ 1.050,00"
export function formatBRL(cents) {
  const reais = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${reais},${String(cents % 100).padStart(2, "0")}`;
}

// Retorno total (aposta × odd), em centavos, arredondado ao centavo mais próximo.
export const payoutCents = (stakeCents, oddValue) => Math.round(stakeCents * oddValue);

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      })
    : "";

// Odds que entram na mensagem para um item: as escolhidas (picks) ou, sem escolha, as três.
const listedOutcomes = ({ picks }) => OUTCOMES.filter(([k]) => !picks?.length || picks.includes(k));

// Soma dos retornos de todas as odds listadas. Soma os valores já arredondados ao centavo,
// para o total bater exatamente com as linhas "(retorno: ...)" da mensagem.
export function totalReturnCents(items, stakeCents) {
  if (!stakeCents) return 0;
  let total = 0;
  for (const it of items) {
    for (const [k] of listedOutcomes(it)) {
      const v = it.match.odds?.[k];
      if (v != null) total += payoutCents(stakeCents, v);
    }
  }
  return total;
}

// items: [{ league, match, picks? }]; picks = subconjunto de ["home","draw","away"] (vazio/ausente = as três). Agrupa por campeonato; campeonatos e jogos em ordem de horário.
export function buildMessage(items, { emojis = true, stakeCents = null } = {}) {
  const byLeague = new Map();
  for (const it of [...items].sort((a, b) => String(a.match.startTime).localeCompare(String(b.match.startTime)))) {
    if (!byLeague.has(it.league)) byLeague.set(it.league, []);
    byLeague.get(it.league).push(it);
  }
  const lines = [emojis ? "⚡ *Odds Futebol*" : "*Odds Futebol*"];
  for (const [league, matches] of byLeague) {
    lines.push("", `*${league}*`);
    for (const { match: m, picks } of matches) {
      const o = m.odds || {};
      const keys = listedOutcomes({ picks });
      lines.push(`${m.home} × ${m.away}${m.live ? (emojis ? " ⭕ AO VIVO" : " (AO VIVO)") : ""}`);
      if (stakeCents) {
        // Com valor de aposta: uma odd por linha, com o retorno de cada uma.
        if (when(m.startTime)) lines.push(when(m.startTime));
        for (const [k, label] of keys) {
          const ret = o[k] == null ? "" : ` (retorno: ${formatBRL(payoutCents(stakeCents, o[k]))})`;
          lines.push(`*${label}*: ${odd(o[k])}${ret}`);
        }
      } else {
        lines.push(`${when(m.startTime) ? when(m.startTime) + " · " : ""}${keys.map(([k, label]) => `*${label}*: ${odd(o[k])}`).join(" | ")}`);
      }
    }
  }
  if (stakeCents) {
    lines.push("", `*Valor da aposta*: ${formatBRL(stakeCents)}`);
    lines.push(`*Retorno Total*: ${formatBRL(totalReturnCents(items, stakeCents))}`);
  }
  return lines.join("\n");
}

export const whatsappUrl = (text) => "https://wa.me/?text=" + encodeURIComponent(text);
