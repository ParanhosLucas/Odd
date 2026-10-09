import http from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./lib/app.js";
import { createAuth } from "./lib/auth.js";
import { loadConfig } from "./lib/config.js";
import { createPgPool } from "./lib/pg-pool.js";
import { createHistoryBackup, createNoBackup, createPgBackupTarget } from "./lib/history-backup.js";
import { createMemoryStore, createPgStore } from "./lib/users-store.js";
import { fetchFlashscore } from "./providers/flashscore.js";
import { fetchDemo } from "./providers/demo.js";

const config = loadConfig();

let pool = null, store;
if (config.databaseUrl) {
  pool = createPgPool({ connectionString: config.databaseUrl, ssl: config.databaseSsl });
  store = createPgStore(pool);
} else if (config.production) {
  console.error("DATABASE_URL é obrigatória em produção (usuários e sessões ficam no banco).");
  process.exit(1);
} else {
  console.warn("DATABASE_URL não definida: usando usuários em MEMÓRIA (somem ao reiniciar). Só para desenvolvimento.");
  store = createMemoryStore();
}

// Backup automático do histórico num segundo banco (opcional, mas recomendado em produção).
let backupPool = null, backup = createNoBackup();
if (config.backupDatabaseUrl) {
  if (config.backupDatabaseUrl === config.databaseUrl) {
    console.error("BACKUP_DATABASE_URL é igual a DATABASE_URL: isso não é um backup. Use outro banco. Backup DESLIGADO.");
  } else {
    backupPool = createPgPool({ connectionString: config.backupDatabaseUrl, ssl: config.databaseSsl });
    backup = createHistoryBackup({ source: store, target: createPgBackupTarget(backupPool) });
  }
} else if (config.production) {
  console.warn("BACKUP_DATABASE_URL não definida: o histórico NÃO está sendo copiado para um segundo banco.");
}

const app = createApp({
  config, store, backup,
  fetchLeagues: fetchFlashscore,
  fetchFallback: fetchDemo,
  publicDir: join(fileURLToPath(new URL(".", import.meta.url)), "public"),
});

const server = http.createServer(app).listen(config.port, () => console.log(`MCZ Bet em http://localhost:${config.port}`));

// Aquece o cache de odds (hoje até +3 dias) em segundo plano, com intervalo entre as buscas, para o primeiro
// usuário não esperar a busca no Flashscore.
app.warm([0, 1, 2, 3], { gapMs: 700 }).then(() => console.log("Cache de odds aquecido."));

// O banco pode demorar a ficar pronto no primeiro deploy: tenta de novo em vez de derrubar o servidor.
// Enquanto isso, as rotas que dependem do banco respondem 503.
const auth = createAuth({ store, config });
(async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      await store.init();
      await auth.ensureAdmin();
      console.log("Banco de usuários pronto.");
      backup.start().catch((e) => console.error("Backup do histórico:", e.message)); // copia o atraso e passa a copiar a cada alteração
      return;
    } catch (e) {
      console.error(`Banco indisponível (tentativa ${attempt}): ${e.message}`);
      if (attempt >= 20) { console.error("Desistindo: confira DATABASE_URL e o banco no Render."); process.exit(1); }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
})();

setInterval(() => auth.purgeExpired().catch((e) => console.error("Falha ao limpar sessões:", e.message)), 3_600_000).unref();

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => server.close(async () => { backup.stop(); await pool?.end().catch(() => {}); await backupPool?.end().catch(() => {}); process.exit(0); }));
}
