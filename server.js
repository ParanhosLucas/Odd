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

const MAX_DAY = 7;
const cache = new Map(); // dia -> { at, body }

async function getOdds(day) {
  const hit = cache.get(day);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.body;
  let source = "flashscore", error = null, leagues;
  try {
    leagues = await fetchFlashscore(day);
  } catch (e) {
    source = "demo"; error = e.message;
    leagues = await fetchDemo();
  }
  const body = { source, error, day, maxDay: MAX_DAY, updatedAt: new Date().toISOString(), leagues };
  cache.set(day, { at: Date.now(), body });
  return body;
}

http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, "http://x");
  if (pathname === "/api/odds") {
    const day = Math.min(MAX_DAY, Math.max(0, parseInt(searchParams.get("day"), 10) || 0));
    const body = await getOdds(day);
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
