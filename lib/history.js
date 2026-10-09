// Histórico das apostas: validação dos eventos que o navegador envia. O horário de cada evento é SEMPRE o do
// servidor; o do aparelho (clientAt) é guardado só como informação, porque o relógio do celular pode estar errado.
export const CLIENT_ACTIONS = ["created", "changed", "cleared", "sent", "copied"];
export const ADMIN_ACTIONS = ["user_created", "user_deleted"];
export const MAX_EVENTS_PER_REQUEST = 20;
export const MAX_DETAIL_CHARS = 30_000; // cabe a mensagem do WhatsApp (até ~9 mil) e o retrato dos jogos
export const HISTORY_BODY_LIMIT = 64 * 1024;

const SLIP_ID = /^[A-Za-z0-9_-]{8,64}$/;
const REGISTRATION = /^\d{6}-\d{4,6}$/;

// Devolve { ok: true, events } ou { ok: false, error }. Nada do que vem do navegador é confiado: tipos, tamanhos e formato.
export function validateEvents(body) {
  const list = body?.events;
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: "events deve ser uma lista com pelo menos 1 evento." };
  if (list.length > MAX_EVENTS_PER_REQUEST) return { ok: false, error: `No máximo ${MAX_EVENTS_PER_REQUEST} eventos por envio.` };
  const events = [];
  for (const [i, e] of list.entries()) {
    const where = `Evento ${i + 1}: `;
    if (!e || typeof e !== "object" || Array.isArray(e)) return { ok: false, error: where + "formato inválido." };
    if (!CLIENT_ACTIONS.includes(e.action)) return { ok: false, error: where + "ação inválida." };
    if (typeof e.slipId !== "string" || !SLIP_ID.test(e.slipId)) return { ok: false, error: where + "slipId inválido." };
    if (e.registration != null && (typeof e.registration !== "string" || !REGISTRATION.test(e.registration))) return { ok: false, error: where + "registro inválido." };
    if ((e.action === "sent" || e.action === "copied") && !e.registration) return { ok: false, error: where + "envio sem número de registro." };
    const summary = typeof e.summary === "string" ? e.summary.trim() : "";
    if (!summary || summary.length > 500) return { ok: false, error: where + "resumo deve ter de 1 a 500 caracteres." };
    const detail = e.detail ?? {};
    if (typeof detail !== "object" || Array.isArray(detail)) return { ok: false, error: where + "detalhe inválido." };
    const detailJson = JSON.stringify(detail);
    if (detailJson.length > MAX_DETAIL_CHARS) return { ok: false, error: where + "detalhe grande demais." };
    let clientAt = null;
    if (e.clientAt != null) {
      const t = typeof e.clientAt === "string" ? Date.parse(e.clientAt) : NaN;
      if (!Number.isFinite(t)) return { ok: false, error: where + "clientAt inválido." };
      clientAt = new Date(t);
    }
    events.push({ action: e.action, slipId: e.slipId, registration: e.registration ?? null, summary, detail, clientAt });
  }
  return { ok: true, events };
}

export const clampLimit = (raw, def = 100, max = 300) => {
  const n = raw == null ? def : /^\d{1,4}$/.test(String(raw)) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : null;
};
export const parseCursor = (raw) => (raw == null ? { ok: true, value: null } : /^\d{1,12}$/.test(String(raw)) ? { ok: true, value: Number(raw) } : { ok: false });
