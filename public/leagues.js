// Ligas fixadas: identificadas pelo caminho do Flashscore (estável mesmo quando o nome ganha
// sufixos de fase, como "- Playoffs").
export const DEFAULT_PINNED = [
  { id: "/futebol/brasil/brasileirao-serie-a/", title: "Brasileirão Série A", country: "Brasil" },
  { id: "/futebol/brasil/brasileirao-serie-b/", title: "Brasileirão Série B", country: "Brasil" },
  { id: "/futebol/brasil/paulista/", title: "Paulista", country: "Brasil" },
  { id: "/futebol/brasil/copa-do-brasil/", title: "Copa do Brasil", country: "Brasil" },
];

const KEY = "odd.pinned";

// "BRASIL: Brasileirão Série A" -> "Brasileirão Série A"
export const shortName = (name) => {
  const i = String(name).indexOf(": ");
  return i < 0 ? String(name) : String(name).slice(i + 2);
};

export const leagueId = (l) => l.id || l.name;

// Resumo de uma liga vinda da API, no formato guardado na lista de fixadas.
export const toPinned = (l) => ({ id: leagueId(l), title: shortName(l.name), country: l.country || null });

export function loadPinned(storage) {
  try {
    const raw = storage.getItem(KEY);
    if (raw == null) return DEFAULT_PINNED.map((p) => ({ ...p }));
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string" && typeof p.title === "string") : [];
  } catch {
    return DEFAULT_PINNED.map((p) => ({ ...p }));
  }
}

export function savePinned(storage, list) {
  try { storage.setItem(KEY, JSON.stringify(list)); } catch {}
}

// Fixa se não está fixada; desafixa se está. Devolve uma lista nova.
export function togglePinned(list, pin) {
  return list.some((p) => p.id === pin.id) ? list.filter((p) => p.id !== pin.id) : [...list, pin];
}
