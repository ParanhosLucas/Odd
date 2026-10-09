// Cache de odds por dia, desenhado para ninguém esperar a busca no Flashscore (0,5 a 2 s):
//  1. dado fresco (dentro do TTL do dia): responde direto;
//  2. dado velho mas aproveitável (até staleMaxMs): responde NA HORA com ele e atualiza por trás
//     (stale-while-revalidate); se a atualização falhar, passa a avisar { stale: true, error };
//  3. sem dado aproveitável: espera a busca (várias requisições ao mesmo dia compartilham uma só);
//  4. se a fonte falhar e não houver dado, usa a reserva (demo) se permitida; senão propaga o erro.
// O TTL cresce com a distância: hoje muda o tempo todo; dias distantes quase não mudam.
const FAIL_BACKOFF_MS = 10_000; // depois de uma falha, não bate na fonte de novo por este tempo

export function createOddsService({ fetchLeagues, fetchFallback, ttlMs, staleMaxMs, maxDay, now = Date.now, log = console }) {
  const cache = new Map();    // dia -> { at, body, error, failedAt }
  const inflight = new Map(); // dia -> Promise<body>
  let lastSuccessAt = null;

  const ttlFor = (day) => (day === 0 ? ttlMs : day === 1 ? ttlMs * 2 : ttlMs * 10);

  const build = (day, source, leagues, extra = {}) => ({
    source, error: null, stale: false, day, maxDay,
    updatedAt: new Date(now()).toISOString(), leagues, ...extra,
  });

  // Corpo a devolver: o mesmo objeto enquanto está tudo bem (permite reaproveitar a serialização).
  const view = (entry) => (entry.error ? { ...entry.body, stale: true, error: entry.error } : entry.body);

  async function refresh(day) {
    try {
      const body = build(day, "flashscore", await fetchLeagues(day));
      cache.set(day, { at: now(), body, error: null, failedAt: null });
      lastSuccessAt = now();
      return body;
    } catch (e) {
      const old = cache.get(day);
      if (old && now() - old.at < staleMaxMs) {
        old.error = e.message;
        old.failedAt = now();
        return view(old);
      }
      if (fetchFallback) return build(day, "demo", await fetchFallback(day), { error: e.message });
      throw e;
    }
  }

  function start(day) {
    if (!inflight.has(day)) inflight.set(day, refresh(day).finally(() => inflight.delete(day)));
    return inflight.get(day);
  }

  return {
    get(day) {
      const hit = cache.get(day);
      const age = hit ? now() - hit.at : Infinity;
      if (hit && age < ttlFor(day)) return Promise.resolve(view(hit));
      if (hit && age < staleMaxMs) {
        const backingOff = hit.failedAt != null && now() - hit.failedAt < FAIL_BACKOFF_MS;
        if (!backingOff) start(day).catch((e) => log.error("Falha ao atualizar odds em segundo plano:", e.message));
        return Promise.resolve(view(hit));
      }
      return start(day);
    },

    // Aquece o cache (ex.: na subida do servidor) sem derrubar nada se a fonte falhar.
    async warm(days, { gapMs = 0 } = {}) {
      for (const day of days) {
        try { await this.get(day); } catch (e) { log.warn(`Aquecimento do dia ${day} falhou: ${e.message}`); }
        if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
      }
    },

    lastSuccessAt: () => lastSuccessAt,
  };
}
