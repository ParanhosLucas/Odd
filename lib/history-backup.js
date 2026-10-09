// Backup automático do histórico num SEGUNDO banco Postgres (BACKUP_DATABASE_URL), de preferência de outro
// projeto/conta do Neon: se o banco principal for apagado ou corrompido, a cópia continua intacta.
//
// Como funciona:
//  - a cada gravação no histórico (aposta alterada, enviada, copiada, usuário criado/excluído), os mesmos
//    eventos são copiados para o banco de backup logo em seguida (em segundo plano: nunca atrasa nem derruba o site);
//  - se a cópia falhar (banco de backup dormindo, sem rede), os eventos ficam numa fila e são tentados de novo
//    com espera crescente (2 s … 5 min);
//  - ao iniciar, o servidor compara os bancos e copia tudo o que faltar (cobre queda no meio de uma cópia e
//    reinício do servidor com a fila cheia);
//  - copiar é idempotente: o mesmo evento nunca é gravado duas vezes.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bet_events_backup (
     source_id INTEGER NOT NULL,
     user_id INTEGER,
     username TEXT NOT NULL,
     slip_id TEXT NOT NULL,
     action TEXT NOT NULL,
     registration TEXT,
     summary TEXT NOT NULL,
     detail TEXT NOT NULL DEFAULT '{}',
     client_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL,
     backed_up_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS bet_events_backup_key ON bet_events_backup(source_id, created_at)`,
];
// A chave inclui created_at: se o banco principal fosse recriado do zero (ids recomeçando em 1), um evento novo
// nunca seria confundido com um antigo de mesmo id.

const COLS = 10;

export function createPgBackupTarget(pool) {
  return {
    async init() { for (const sql of SCHEMA) await pool.query(sql); },
    // events no formato publicEvent (id, userId, username, slipId, action, registration, summary, detail, clientAt, createdAt)
    async upsertEvents(events) {
      if (!events.length) return;
      const params = [], rows = events.map((e) => {
        const b = params.length;
        params.push(e.id, e.userId ?? null, e.username, e.slipId, e.action, e.registration ?? null, e.summary, JSON.stringify(e.detail ?? {}), e.clientAt ?? null, e.createdAt);
        return `(${Array.from({ length: COLS }, (_, i) => `$${b + i + 1}`).join(", ")})`;
      });
      await pool.query(
        `INSERT INTO bet_events_backup (source_id, user_id, username, slip_id, action, registration, summary, detail, client_at, created_at) VALUES ${rows.join(", ")} ON CONFLICT (source_id, created_at) DO NOTHING`,
        params,
      );
    },
    async maxSourceId() {
      const { rows } = await pool.query("SELECT COALESCE(MAX(source_id), 0) AS m FROM bet_events_backup");
      return Number(rows[0].m);
    },
    async count() {
      const { rows } = await pool.query("SELECT COUNT(*) AS n FROM bet_events_backup");
      return Number(rows[0].n);
    },
  };
}

// Mesma interface, só em memória (testes).
export function createMemoryBackupTarget() {
  const rows = new Map();
  return {
    rows,
    async init() {},
    async upsertEvents(events) { for (const e of events) rows.set(`${e.id}|${e.createdAt}`, { ...e }); },
    async maxSourceId() { return Math.max(0, ...[...rows.values()].map((e) => e.id)); },
    async count() { return rows.size; },
  };
}

const BATCH = 200;
const RETRY_MIN = 2000, RETRY_MAX = 300_000;

export function createHistoryBackup({ source, target, log = console, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let queue = [], running = false, again = false, retryTimer = null, retryMs = RETRY_MIN;
  let ready = false, lastOkAt = null, lastError = null, lastCount = null;

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimer(() => { retryTimer = null; drain(); }, retryMs);
    retryTimer.unref?.();
    retryMs = Math.min(retryMs * 2, RETRY_MAX);
  }

  // Copia a fila, em lotes. Em caso de erro mantém o que falta e tenta de novo depois.
  async function drain() {
    if (!ready) return;
    if (running) { again = true; return; }
    running = true;
    try {
      do {
        again = false;
        while (queue.length) {
          const batch = queue.slice(0, BATCH);
          await target.upsertEvents(batch);
          queue = queue.slice(batch.length);
          lastOkAt = new Date(now()).toISOString();
          lastError = null;
          retryMs = RETRY_MIN;
        }
      } while (again);
    } catch (e) {
      lastError = e.message;
      log.warn?.(`Backup do histórico falhou (${queue.length} evento(s) na fila; nova tentativa em ${Math.round(retryMs / 1000)} s): ${e.message}`);
      scheduleRetry();
    } finally { running = false; }
  }

  // Compara os dois bancos e copia o que o backup ainda não tem. Roda ao iniciar.
  async function catchUp() {
    let afterId = await target.maxSourceId();
    for (;;) {
      const page = await source.listEventsAfter({ afterId, limit: 500 });
      if (!page.length) break;
      await target.upsertEvents(page);
      afterId = page.at(-1).id;
      lastOkAt = new Date(now()).toISOString();
      if (page.length < 500) break;
    }
  }

  return {
    enabled: true,
    // Chamado depois de cada gravação no histórico. NUNCA lança: o backup não pode derrubar o site.
    push(events) {
      if (!events?.length) return;
      queue.push(...events);
      drain().catch(() => {});
    },
    // Prepara o banco de backup e copia o atraso. Tenta até conseguir (o banco pode estar dormindo).
    async start() {
      for (let attempt = 1; ; attempt++) {
        try {
          await target.init();
          await catchUp();
          ready = true;
          lastError = null;
          log.log?.("Backup do histórico pronto.");
          drain().catch(() => {});
          return;
        } catch (e) {
          lastError = e.message;
          log.error?.(`Backup do histórico indisponível (tentativa ${attempt}): ${e.message}`);
          await new Promise((r) => setTimer(r, Math.min(3000 * attempt, 60_000)));
        }
      }
    },
    async status() {
      try { lastCount = await target.count(); } catch { /* mostra o último valor conhecido */ }
      return { enabled: true, ready, pending: queue.length, backedUp: lastCount, lastOkAt, lastError };
    },
    stop() { if (retryTimer) clearTimer(retryTimer); },
  };
}

// Sem BACKUP_DATABASE_URL: nada é copiado, e o painel avisa.
export const createNoBackup = () => ({ enabled: false, push() {}, async start() {}, async status() { return { enabled: false }; }, stop() {} });
