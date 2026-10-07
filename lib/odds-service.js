// Cache por dia com três garantias:
//  1. requisições simultâneas ao mesmo dia compartilham uma única busca;
//  2. se o Flashscore falhar, serve o último dado bom (stale) por até staleMaxMs;
//  3. sem dado antigo, usa a reserva (demo) se permitida; senão propaga o erro.
export function createOddsService({ fetchLeagues, fetchFallback, ttlMs, staleMaxMs, maxDay, now = Date.now }) {
  const cache = new Map();    // dia -> { at, body }
  const inflight = new Map(); // dia -> Promise<body>
  let lastSuccessAt = null;

  const build = (day, source, leagues, extra = {}) => ({
    source, error: null, stale: false, day, maxDay,
    updatedAt: new Date(now()).toISOString(), leagues, ...extra,
  });

  async function refresh(day) {
    try {
      const body = build(day, "flashscore", await fetchLeagues(day));
      cache.set(day, { at: now(), body });
      lastSuccessAt = now();
      return body;
    } catch (e) {
      const old = cache.get(day);
      if (old && now() - old.at < staleMaxMs) return { ...old.body, stale: true, error: e.message };
      if (fetchFallback) return build(day, "demo", await fetchFallback(day), { error: e.message });
      throw e;
    }
  }

  return {
    get(day) {
      const hit = cache.get(day);
      if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.body);
      if (!inflight.has(day)) inflight.set(day, refresh(day).finally(() => inflight.delete(day)));
      return inflight.get(day);
    },
    lastSuccessAt: () => lastSuccessAt,
  };
}
