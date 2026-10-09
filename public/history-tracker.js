// Rastreador do histórico: acompanha a aposta (cupom) montada na tela e envia ao servidor cada criação,
// alteração, limpeza, envio no WhatsApp e cópia. O HORÁRIO de cada evento é gravado pelo servidor.
// Eventos que não puderam ser enviados (sem internet, servidor dormindo) ficam numa fila guardada no navegador
// e são reenviados até dar certo.
import { OUTCOMES, formatBRL } from "./share.js";

const LABEL = Object.fromEntries(OUTCOMES);
const MAX_QUEUE = 200;     // limite da fila guardada no navegador (descarta os mais antigos)
const BATCH = 20;          // o servidor aceita até 20 eventos por envio
const MAX_SUMMARY = 500;
const MAX_DETAIL = 28_000; // o servidor recusa mais de 30 mil caracteres

const clip = (s, n = MAX_SUMMARY) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const name = (g) => `${g.home} × ${g.away}`;
const o = (v) => (v == null ? "—" : Number(v).toFixed(2));

// Retrato da aposta: jogos, odds escolhidas (com o valor da odd naquele momento) e valor apostado.
export function snapshotOf(items, stakeCents) {
  return {
    stakeCents: stakeCents || null,
    games: [...items]
      .map((it) => ({
        id: it.match.id, league: it.league, home: it.match.home, away: it.match.away, startTime: it.match.startTime ?? null,
        picks: OUTCOMES.map(([k]) => k).filter((k) => it.picks?.includes(k)),
        odds: { home: it.match.odds?.home ?? null, draw: it.match.odds?.draw ?? null, away: it.match.odds?.away ?? null },
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
}

const pickText = (g, keys) => keys.map((k) => `${LABEL[k]} (${o(g.odds[k])})`).join(", ");

// Lista, em português, o que o usuário mudou entre dois retratos. Variação de odd do mercado NÃO conta como alteração.
export function diffSnapshots(prev, next) {
  const out = [];
  const before = new Map(prev.games.map((g) => [g.id, g]));
  const after = new Map(next.games.map((g) => [g.id, g]));
  for (const g of next.games) {
    const old = before.get(g.id);
    if (!old) {
      out.push(`Adicionou o jogo ${name(g)}${g.picks.length ? ` — ${pickText(g, g.picks)}` : ""}`);
      continue;
    }
    const added = g.picks.filter((k) => !old.picks.includes(k));
    const removed = old.picks.filter((k) => !g.picks.includes(k));
    if (added.length) out.push(`${name(g)}: escolheu ${pickText(g, added)}`);
    if (removed.length) out.push(`${name(g)}: tirou ${removed.map((k) => LABEL[k]).join(", ")}`);
  }
  for (const g of prev.games) if (!after.has(g.id)) out.push(`Removeu o jogo ${name(g)}`);
  if (prev.stakeCents !== next.stakeCents) {
    out.push(
      !next.stakeCents ? "Removeu o valor da aposta"
        : !prev.stakeCents ? `Definiu o valor da aposta: ${formatBRL(next.stakeCents)}`
          : `Alterou o valor da aposta: ${formatBRL(prev.stakeCents)} → ${formatBRL(next.stakeCents)}`,
    );
  }
  return out;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// "A × B (Casa 2.10); C × D" + valor da aposta, quando houver.
const gamesList = (snap) =>
  snap.games.map((g) => `${name(g)}${g.picks.length ? ` (${pickText(g, g.picks)})` : ""}`).join("; ")
  + (snap.stakeCents ? `; valor da aposta ${formatBRL(snap.stakeCents)}` : "");

const defaultId = () => {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join("-");
};

const readJson = (storage, key, fallback) => {
  try { const v = JSON.parse(storage.getItem(key)); return v ?? fallback; } catch { return fallback; }
};
const writeJson = (storage, key, value) => { try { storage.setItem(key, JSON.stringify(value)); } catch {} };

const EMPTY = { stakeCents: null, games: [] };

// storage: armazenamento do usuário (scopedStorage). send(events, { keepalive }) -> { ok, status } (nunca lança).
export function createTracker({ storage, send, newId = defaultId, nowIso = () => new Date().toISOString(), debounceMs = 1200, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const SLIP_KEY = "odd.hist.slip", QUEUE_KEY = "odd.hist.queue";
  // slip: { id, snapshot, sent } — a aposta em andamento. Depois de enviada, qualquer mudança abre uma aposta NOVA.
  let slip = readJson(storage, SLIP_KEY, null);
  if (!slip || typeof slip !== "object" || !slip.snapshot?.games) slip = { id: null, snapshot: EMPTY, sent: false };
  let queue = readJson(storage, QUEUE_KEY, []);
  if (!Array.isArray(queue)) queue = [];
  let timer = null, pending = null, flushing = false, retryTimer = null, retryMs = 2000, blocked = false;

  const saveSlip = () => writeJson(storage, SLIP_KEY, slip);
  const saveQueue = () => writeJson(storage, QUEUE_KEY, queue);

  function enqueue(event) {
    queue.push({ ...event, clientAt: nowIso() });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    saveQueue();
    flush();
  }

  const detailOf = (snapshot, extra = {}) => {
    const d = { snapshot, ...extra };
    return JSON.stringify(d).length > MAX_DETAIL ? { ...extra, snapshot: { stakeCents: snapshot.stakeCents, games: snapshot.games.map(({ id, home, away }) => ({ id, home, away })) } } : d;
  };

  // Compara a tela com o último retrato e registra o que mudou. { reason } explica remoções automáticas.
  function commit(items, stakeCents, { reason } = {}) {
    if (timer) { clearTimer(timer); timer = null; pending = null; }
    const next = snapshotOf(items, stakeCents);
    const prev = slip.snapshot;
    const had = prev.games.length > 0, has = next.games.length > 0;
    if (!had && !has) { slip.snapshot = next; saveSlip(); return; }

    if (had && !has) {
      enqueue({ action: "cleared", slipId: slip.id, registration: null, summary: reason || "Limpou a seleção", detail: detailOf(prev) });
      slip = { id: null, snapshot: EMPTY, sent: false };
      saveSlip();
      return;
    }
    const changes = had ? diffSnapshots(prev, next) : [];
    if (had && !changes.length) return;

    if (!had || slip.sent || !slip.id) {
      // Primeira seleção, ou mudança depois de a aposta já ter sido enviada/copiada: é uma aposta nova.
      const fromSent = had && slip.sent;
      slip = { id: newId(), snapshot: next, sent: false };
      const summary = fromSent
        ? `Criou uma nova aposta a partir da anterior (já enviada) com ${plural(next.games.length, "jogo", "jogos")}: ${gamesList(next)}`
        : `Criou a aposta com ${plural(next.games.length, "jogo", "jogos")}: ${gamesList(next)}`;
      enqueue({ action: "created", slipId: slip.id, registration: null, summary: clip(summary), detail: detailOf(next, fromSent ? { changes } : {}) });
    } else {
      slip.snapshot = next;
      enqueue({ action: "changed", slipId: slip.id, registration: null, summary: clip(changes.join("; ")), detail: detailOf(next, { changes }) });
    }
    saveSlip();
  }

  // Chamado a cada mudança na tela: espera um instante (digitar o valor gera várias mudanças) e registra uma vez.
  function track(items, stakeCents) {
    pending = { items: [...items], stakeCents };
    if (timer) clearTimer(timer);
    timer = setTimer(() => { const p = pending; timer = null; pending = null; if (p) commit(p.items, p.stakeCents); }, debounceMs);
  }

  // Grava o que estiver esperando (ao enviar, ao sair da página).
  function settle() {
    if (!pending) return;
    const p = pending;
    commit(p.items, p.stakeCents);
  }

  // kind: "sent" (botão do WhatsApp) | "copied" (Copiar mensagem). message = texto enviado/copiado.
  function recordShare(kind, items, stakeCents, registration, message) {
    commit(items, stakeCents);
    if (!slip.id) { // segurança: nada selecionado (não deveria acontecer, o botão exige 2 jogos)
      slip = { id: newId(), snapshot: snapshotOf(items, stakeCents), sent: false };
    }
    const n = slip.snapshot.games.length;
    const summary = kind === "sent"
      ? `Enviou no WhatsApp a aposta ${registration} (${plural(n, "jogo", "jogos")})`
      : `Copiou a mensagem da aposta ${registration} (${plural(n, "jogo", "jogos")})`;
    slip.sent = true;
    saveSlip();
    enqueue({ action: kind, slipId: slip.id, registration, summary, detail: detailOf(slip.snapshot, { message: clip(message, 12_000) }) });
  }

  function schedule() {
    if (retryTimer) return;
    retryTimer = setTimer(() => { retryTimer = null; flush(); }, retryMs);
    retryMs = Math.min(retryMs * 2, 60_000);
  }

  // Envia a fila ao servidor, em lotes. Falha de rede: tenta de novo mais tarde. 401/403: para (sessão expirou).
  async function flush({ keepalive = false } = {}) {
    if (flushing || !queue.length || blocked) return;
    flushing = true;
    try {
      while (queue.length) {
        const batch = queue.slice(0, BATCH);
        const r = await send(batch, { keepalive });
        if (r.ok) { queue = queue.slice(batch.length); saveQueue(); retryMs = 2000; continue; }
        if (r.status === 401 || r.status === 403) { blocked = true; break; }       // sem sessão: mantém a fila para o próximo login
        if (r.status === 400 || r.status === 413) { queue = queue.slice(batch.length); saveQueue(); continue; } // lote inválido: descarta, não trava a fila
        schedule(); break;                                                          // rede/servidor/limite: tenta depois
      }
    } finally { flushing = false; }
  }

  return { commit, track, settle, recordShare, flush, get queueLength() { return queue.length; }, get slipId() { return slip.id; } };
}
