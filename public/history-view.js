// Apresentação do histórico: agrupa os eventos por aposta e formata data e hora (horário de Brasília).
export const ACTION_LABEL = {
  created: "Criou", changed: "Alterou", cleared: "Limpou", sent: "Enviou no WhatsApp", copied: "Copiou a mensagem",
  user_created: "Criou usuário", user_deleted: "Excluiu usuário",
};
export const STATUS_LABEL = { sent: "Enviada", copied: "Copiada", cleared: "Descartada", open: "Em andamento" };
const ADMIN_ACTIONS = new Set(["user_created", "user_deleted"]);

// "2026-10-09T15:30:12Z" -> "09/10/2026 12:30:12" (Brasília). Sempre com segundos: dois eventos seguidos se distinguem.
export function formatDateTime(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(t)).map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

// Situação final da aposta: enviada > copiada > descartada (terminou limpa) > em andamento.
function statusOf(events) {
  if (events.some((e) => e.action === "sent")) return "sent";
  if (events.some((e) => e.action === "copied")) return "copied";
  return events.at(-1)?.action === "cleared" ? "cleared" : "open";
}

// events: como a API devolve (mais novo primeiro, de qualquer usuário). Devolve apostas (mais recentes primeiro,
// cada uma com os eventos do mais antigo para o mais novo) e, à parte, os eventos de administração.
export function groupHistory(events) {
  const bySlip = new Map();
  const admin = [];
  for (const e of events) {
    if (ADMIN_ACTIONS.has(e.action)) { admin.push(e); continue; }
    const key = `${e.username}\u0000${e.slipId}`;
    if (!bySlip.has(key)) bySlip.set(key, { key, slipId: e.slipId, username: e.username, events: [] });
    bySlip.get(key).events.push(e);
  }
  const slips = [...bySlip.values()].map((s) => {
    s.events.sort((a, b) => a.id - b.id);
    const regs = [...new Set(s.events.map((e) => e.registration).filter(Boolean))];
    return { ...s, registrations: regs, status: statusOf(s.events), startedAt: s.events[0].createdAt, lastAt: s.events.at(-1).createdAt, lastId: s.events.at(-1).id };
  });
  slips.sort((a, b) => b.lastId - a.lastId);
  return { slips, admin };
}
