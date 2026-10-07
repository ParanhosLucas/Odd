import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { createOddsService } from "./odds-service.js";
import { createRateLimiter } from "./rate-limit.js";

const gz = promisify(gzip);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const SECURITY = {
  "content-security-policy": "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

export function createApp({ config, fetchLeagues, fetchFallback, publicDir, now = Date.now }) {
  const odds = createOddsService({
    fetchLeagues, fetchFallback: config.demoFallback ? fetchFallback : null,
    ttlMs: config.ttlMs, staleMaxMs: config.staleMaxMs, maxDay: config.maxDay, now,
  });
  const limit = createRateLimiter({ ...config.rateLimit, now });

  const clientIp = (req) =>
    (config.trustProxy && req.headers["x-forwarded-for"]?.split(",")[0].trim()) || req.socket.remoteAddress || "?";

  async function sendJson(req, res, status, obj, extra = {}) {
    let body = Buffer.from(JSON.stringify(obj));
    const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY, ...extra };
    if (/\bgzip\b/.test(req.headers["accept-encoding"] || "") && body.length > 1024) {
      body = await gz(body);
      headers["content-encoding"] = "gzip";
      headers.vary = "Accept-Encoding";
    }
    res.writeHead(status, headers);
    res.end(body);
  }

  async function sendStatic(res, pathname) {
    const rel = normalize(pathname === "/" ? "/index.html" : pathname);
    const file = join(publicDir, rel);
    if (!file.startsWith(publicDir + sep)) return notFound(res);
    try {
      const data = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "public, max-age=300", ...SECURITY });
      res.end(data);
    } catch {
      notFound(res);
    }
  }

  const notFound = (res) => { res.writeHead(404, { "content-type": "text/plain; charset=utf-8", ...SECURITY }); res.end("Not found"); };

  return async function handler(req, res) {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" });
        return res.end();
      }
      const { pathname, searchParams } = new URL(req.url, "http://x");

      if (pathname === "/healthz") {
        const t = odds.lastSuccessAt();
        return sendJson(req, res, 200, { ok: true, lastSuccessAt: t && new Date(t).toISOString() });
      }

      if (pathname === "/api/odds") {
        const rl = limit(clientIp(req));
        if (!rl.allowed) return sendJson(req, res, 429, { error: "Muitas requisições" }, { "retry-after": String(rl.retryAfter) });
        const raw = searchParams.get("day");
        const day = raw == null ? 0 : /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
        if (!Number.isInteger(day) || day < 0 || day > config.maxDay) {
          return sendJson(req, res, 400, { error: `day deve ser um inteiro entre 0 e ${config.maxDay}` });
        }
        try {
          return sendJson(req, res, 200, await odds.get(day));
        } catch (e) {
          console.error("Falha ao obter odds:", e.message);
          return sendJson(req, res, 502, { error: "Fonte de odds indisponível", detail: e.message });
        }
      }

      return sendStatic(res, pathname);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  };
}
