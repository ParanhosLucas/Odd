import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFlashscore } from "./providers/flashscore.js";
import { fetchDemo } from "./providers/demo.js";

const PORT = process.env.PORT || 3000;
const TTL_MS = 30_000;
const PUBLIC = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

let cache = { at: 0, body: null };

async function getOdds() {
  if (cache.body && Date.now() - cache.at < TTL_MS) return cache.body;
  let source = "flashscore", error = null, leagues;
  try {
    leagues = await fetchFlashscore();
  } catch (e) {
    source = "demo"; error = e.message;
    leagues = await fetchDemo();
  }
  cache = { at: Date.now(), body: { source, error, updatedAt: new Date().toISOString(), leagues } };
  return cache.body;
}

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  if (pathname === "/api/odds") {
    const body = await getOdds();
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify(body));
  }
  const file = normalize(pathname === "/" ? "/index.html" : pathname);
  try {
    const data = await readFile(join(PUBLIC, file));
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
