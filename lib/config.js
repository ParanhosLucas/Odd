// Toda a configuração vem de variáveis de ambiente (ver .env.example).
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

export function loadConfig(env = process.env) {
  const prod = env.NODE_ENV === "production";
  return {
    port: int(env.PORT, 3000),
    ttlMs: int(env.CACHE_TTL_SECONDS, 30) * 1000,
    staleMaxMs: int(env.STALE_MAX_SECONDS, 600) * 1000,
    maxDay: int(env.MAX_DAY, 7),
    rateLimit: { windowMs: 60_000, max: int(env.RATE_LIMIT_PER_MINUTE, 120) },
    trustProxy: env.TRUST_PROXY === "1",
    // Dados de demonstração só como reserva fora de produção (a menos que forçado).
    demoFallback: env.DEMO_FALLBACK ? env.DEMO_FALLBACK === "1" : !prod,
    production: prod,
    // Login e usuários
    databaseUrl: env.DATABASE_URL || null,
    databaseSsl: env.DATABASE_SSL === "1",
    adminUser: env.ADMIN_USER || null,
    adminPassword: env.ADMIN_PASSWORD || null,
    sessionTtlMs: int(env.SESSION_DAYS, 7) * 86_400_000,
    secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === "1" : prod, // cookie só por HTTPS em produção
    loginLimit: { windowMs: 15 * 60_000, maxPerUser: 10, maxPerIp: 30 },
  };
}
