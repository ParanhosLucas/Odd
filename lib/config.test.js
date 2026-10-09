import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.js";

test("padrões de desempenho: cache de odds 30 s, sessão em memória 30 s, login válido por 7 dias", () => {
  const c = loadConfig({});
  assert.equal(c.ttlMs, 30_000);
  assert.equal(c.sessionCacheMs, 30_000);
  assert.equal(c.sessionTtlMs, 7 * 86_400_000);
  assert.equal(c.staleMaxMs, 600_000);
});

test("variáveis de ambiente ajustam o desempenho; valores inválidos voltam ao padrão", () => {
  const c = loadConfig({ SESSION_CACHE_SECONDS: "5", CACHE_TTL_SECONDS: "60" });
  assert.equal(c.sessionCacheMs, 5_000);
  assert.equal(c.ttlMs, 60_000);
  const ruim = loadConfig({ SESSION_CACHE_SECONDS: "abc", CACHE_TTL_SECONDS: "" });
  assert.equal(ruim.sessionCacheMs, 30_000);
  assert.equal(ruim.ttlMs, 30_000);
  assert.equal(loadConfig({ SESSION_CACHE_SECONDS: "0" }).sessionCacheMs, 0); // 0 desliga o cache de sessão
});
