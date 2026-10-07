// Número de registro das apostas: DDMMAA-NNNN (data de Brasília + contador do dia), ex.: 071026-0001.
// O contador fica guardado neste navegador. Enviar/copiar o MESMO cupom reaproveita o número; mudar
// jogos, odds escolhidas ou valor da aposta cria uma aposta nova (e um número novo).
const SEQ_KEY = "odd.regSeq";   // { date: "071026", n: 3 }
const CUR_KEY = "odd.regCur";   // { key, number } — cupom já registrado

// Identifica o cupom: jogos + odds escolhidas + valor. Independe da ordem e das odds do momento.
export function slipKey(items, stakeCents) {
  const parts = items
    .map((it) => `${it.match.id}:${[...(it.picks || [])].sort().join(",")}`)
    .sort();
  return `${parts.join("|")}#${stakeCents || 0}`;
}

// Data de hoje em Brasília no formato DDMMAA.
export function brtDate(now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit" })
      .formatToParts(now).map((x) => [x.type, x.value]),
  );
  return `${p.day}${p.month}${p.year}`;
}

export const formatNumber = (date, n) => `${date}-${String(n).padStart(4, "0")}`;

const read = (storage, key) => {
  try { return JSON.parse(storage.getItem(key)); } catch { return null; }
};
const write = (storage, key, value) => {
  try { storage.setItem(key, JSON.stringify(value)); } catch {}
};

// Número do cupom já registrado (sem criar um novo), ou null.
export function currentRegistration(storage, key) {
  const cur = read(storage, CUR_KEY);
  return cur && cur.key === key && typeof cur.number === "string" ? cur.number : null;
}

// Devolve o número do cupom: reaproveita se já registrado; senão gera o próximo do dia.
export function register(storage, key, now = new Date()) {
  const existing = currentRegistration(storage, key);
  if (existing) return existing;
  const date = brtDate(now);
  const seq = read(storage, SEQ_KEY);
  const n = seq && seq.date === date && Number.isInteger(seq.n) && seq.n >= 0 ? seq.n + 1 : 1;
  const number = formatNumber(date, n);
  write(storage, SEQ_KEY, { date, n });
  write(storage, CUR_KEY, { key, number });
  return number;
}
