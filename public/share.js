// Emojis: a página wa.me do WhatsApp mostra "�" no lugar de qualquer emoji que chega pelo link (mesmo
// os simples). Por isso o link é enviado sem emojis ({ emojis: false }); a mensagem COM emojis serve
// para o botão "Copiar mensagem", que cola o texto direto no WhatsApp sem passar pelo link.
// Monta a mensagem de WhatsApp com os jogos selecionados e o link wa.me.
export const MAX_SELECTED = 30;
export const MIN_GAMES_TO_SEND = 2; // só dá para enviar/copiar com pelo menos 2 jogos selecionados

// n = quantidade de jogos selecionados (jogos, não odds escolhidas)
export const canSend = (n) => n >= MIN_GAMES_TO_SEND;
export const minGamesHint = (n) => {
  const falta = MIN_GAMES_TO_SEND - n;
  return `Selecione pelo menos ${MIN_GAMES_TO_SEND} jogos para enviar (falta${falta > 1 ? "m" : ""} ${falta})`;
};
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

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      })
    : "";

// Odds que entram na mensagem para um item: as escolhidas (picks) ou, sem escolha, as três.
const listedOutcomes = ({ picks }) => OUTCOMES.filter(([k]) => !picks?.length || picks.includes(k));

// Aposta MÚLTIPLA: uma só aposta vale pelos jogos juntos, então as odds ESCOLHIDAS se multiplicam.
// Frações exatas (odds em centésimos, BigInt), sem erro de ponto flutuante.
// Devolve { num, den } (produto = num/den) ou null se não houver odd escolhida (ou se alguma não tiver valor).
function oddProduct(items) {
  let num = 1n, den = 1n, n = 0;
  for (const it of items) {
    if (!it.picks?.length) continue; // jogo marcado sem escolher odd não entra
    for (const [k] of listedOutcomes(it)) {
      const v = it.match.odds?.[k];
      if (v == null) return null;
      num *= BigInt(Math.round(v * 100));
      den *= 100n;
      n++;
    }
  }
  return n ? { num, den } : null;
}

// Retorno Total = aposta × Odd total (do produto EXATO, não do número cortado na tela), arredondado ao centavo.
// Ex.: R$ 10 × (1,53 × 3,14 = 4,8042) = R$ 48,04.
export function totalReturnCents(items, stakeCents) {
  const p = stakeCents ? oddProduct(items) : null;
  if (!p) return 0;
  const x = BigInt(stakeCents) * p.num;
  return Number((2n * x + p.den) / (2n * p.den)); // divisão arredondando à metade para cima
}

// Odd total (para mostrar): o mesmo produto com DUAS casas decimais, CORTANDO (sem arredondar): 4,8042 -> "4,80".
export function totalOddText(items) {
  const p = oddProduct(items);
  if (!p) return null;
  const cents = (p.num * 100n) / p.den;
  return `${cents / 100n},${String(cents % 100n).padStart(2, "0")}`;
}

// items: [{ league, match, picks? }]; picks = subconjunto de ["home","draw","away"] (vazio/ausente = as três). Agrupa por campeonato; campeonatos e jogos em ordem de horário.
export function buildMessage(items, { emojis = true, stakeCents = null, registration = null } = {}) {
  const byLeague = new Map();
  for (const it of [...items].sort((a, b) => String(a.match.startTime).localeCompare(String(b.match.startTime)))) {
    if (!byLeague.has(it.league)) byLeague.set(it.league, []);
    byLeague.get(it.league).push(it);
  }
  const lines = [emojis ? "⚡ *MCZ Bet*" : "*MCZ Bet*"];
  if (registration) lines.push(`*Registro*: ${registration}`);
  for (const [league, matches] of byLeague) {
    lines.push("", `*${league}*`);
    for (const { match: m, picks } of matches) {
      const o = m.odds || {};
      const keys = listedOutcomes({ picks });
      lines.push(`${m.home} × ${m.away}`);
      lines.push(`${when(m.startTime) ? when(m.startTime) + " · " : ""}${keys.map(([k, label]) => `*${label}*: ${odd(o[k])}`).join(" | ")}`);
    }
  }
  const oddTotal = totalOddText(items);
  if (oddTotal) lines.push("", `*Odd total*: ${oddTotal}`);
  if (stakeCents) {
    if (!oddTotal) lines.push("");
    lines.push(`*Valor da aposta*: ${formatBRL(stakeCents)}`);
    const total = totalReturnCents(items, stakeCents);
    if (total) lines.push(`*Retorno Total*: ${formatBRL(total)}`);
  }
  return lines.join("\n");
}

export const whatsappUrl = (text) => "https://wa.me/?text=" + encodeURIComponent(text);
