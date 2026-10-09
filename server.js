import http from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./lib/app.js";
import { createAuth } from "./lib/auth.js";
import { loadConfig } from "./lib/config.js";
import { createPgPool } from "./lib/pg-pool.js";
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

const app = createApp({
  config, store,
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
  process.on(sig, () => server.close(async () => { await pool?.end().catch(() => {}); process.exit(0); }));
}
