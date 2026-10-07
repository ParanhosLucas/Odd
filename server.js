import http from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./lib/app.js";
import { loadConfig } from "./lib/config.js";
import { fetchFlashscore } from "./providers/flashscore.js";
import { fetchDemo } from "./providers/demo.js";

const config = loadConfig();
const app = createApp({
  config,
  fetchLeagues: fetchFlashscore,
  fetchFallback: fetchDemo,
  publicDir: join(fileURLToPath(new URL(".", import.meta.url)), "public"),
});

const server = http.createServer(app).listen(config.port, () => console.log(`Odd em http://localhost:${config.port}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
