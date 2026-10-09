// Janela fixa por chave (ex.: IP), em memória (suficiente para uma instância única).
//   limit(key)      conta uma ocorrência e diz se ainda está dentro do limite
//   limit.peek(key) só consulta (não conta): usado no login, que conta apenas as FALHAS
//   limit.reset(key) zera a chave
export function createRateLimiter({ windowMs, max, now = Date.now }) {
  const hits = new Map();
  const live = (key, t) => {
    const h = hits.get(key);
    return h && h.reset > t ? h : null;
  };
  const limit = (key) => {
    const t = now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
    let h = live(key, t);
    if (!h) hits.set(key, (h = { count: 0, reset: t + windowMs }));
    h.count++;
    return { allowed: h.count <= max, retryAfter: Math.ceil((h.reset - t) / 1000) };
  };
  limit.peek = (key) => {
    const t = now(), h = live(key, t);
    return h ? { allowed: h.count < max, retryAfter: Math.ceil((h.reset - t) / 1000) } : { allowed: true, retryAfter: 0 };
  };
  limit.reset = (key) => { hits.delete(key); };
  return limit;
}
