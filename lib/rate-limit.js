// Janela fixa por IP, em memória (suficiente para uma instância única).
export function createRateLimiter({ windowMs, max, now = Date.now }) {
  const hits = new Map();
  return (key) => {
    const t = now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
    let h = hits.get(key);
    if (!h || h.reset <= t) hits.set(key, (h = { count: 0, reset: t + windowMs }));
    h.count++;
    return { allowed: h.count <= max, retryAfter: Math.ceil((h.reset - t) / 1000) };
  };
}
