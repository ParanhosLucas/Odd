// Guarda as odds dos dias já vistos para trocar de dia SEM esperar o servidor:
//  - open(d): devolve na hora o que já se tem e, se estiver velho, atualiza por trás;
//  - prefetch(dias): busca antes de o usuário pedir (os dias vizinhos);
//  - uma busca por dia de cada vez (pedidos repetidos compartilham a mesma).
export function createDayCache({ fetchDay, now = Date.now, freshMs = 20_000, minDay = 0, maxDay = 7 }) {
  const entries = new Map();  // dia -> { data, at }
  const inflight = new Map(); // dia -> Promise
  const valid = (d) => Number.isInteger(d) && d >= minDay && d <= maxDay;
  const peek = (d) => entries.get(d) ?? null;
  const isFresh = (d) => { const e = entries.get(d); return Boolean(e) && now() - e.at < freshMs; };

  function load(d) {
    if (!inflight.has(d)) {
      inflight.set(d, fetchDay(d)
        .then((data) => { entries.set(d, { data, at: now() }); return data; })
        .finally(() => inflight.delete(d)));
    }
    return inflight.get(d);
  }

  return {
    peek, isFresh, load,
    // { cached: o que já temos (ou null), refresh: promessa da atualização (ou null se ainda está fresco) }
    open(d) { return { cached: peek(d)?.data ?? null, refresh: isFresh(d) ? null : load(d) }; },
    prefetch(days) { for (const d of days) if (valid(d) && !isFresh(d) && !inflight.has(d)) load(d).catch(() => {}); },
  };
}
