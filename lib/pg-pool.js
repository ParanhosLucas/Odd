// Conexão com o Postgres pensada para bancos que "dormem" (ex.: Neon grátis suspende após 5 min sem uso):
//  - fecha conexões ociosas depois de 10 s (o servidor do banco não derruba uma conexão que já fechamos);
//  - espera até 15 s por uma conexão (acordar o banco leva de 0,5 s a alguns segundos);
//  - se uma consulta falhar por conexão derrubada/banco acordando, tenta mais UMA vez.
//    (Reexecutar uma escrita cuja resposta se perdeu é raro e seguro aqui: usuário repetido vira
//    "já existe", e o token de sessão é único.)
import pg from "pg";

const RETRYABLE = /Connection terminated|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|timeout exceeded when trying to connect|57P01|57P03/i;
export const isRetryable = (e) => RETRYABLE.test(`${e?.code ?? ""} ${e?.message ?? ""}`);

// "sslmode=require" já significa "verify-full" no pg 8 (certificado verificado), mas o pg avisa que isso
// mudará no v9. Escrever "verify-full" mantém exatamente a mesma segurança, sem depender da versão.
export const normalizeDatabaseUrl = (url) => url.replace(/([?&])sslmode=require(?=&|$)/, "$1sslmode=verify-full");

export function createPgPool({ connectionString, ssl = false }, { PoolClass = pg.Pool, retryDelayMs = 300, log = console } = {}) {
  const pool = new PoolClass({
    connectionString: normalizeDatabaseUrl(connectionString),
    ssl: ssl ? { rejectUnauthorized: false } : undefined, // DATABASE_SSL=1: força TLS sem verificar o certificado
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });
  pool.on("error", (e) => log.warn(`Conexão ociosa com o banco encerrada pelo servidor (normal quando o banco dorme): ${e.message}`));

  return {
    async query(text, params) {
      try {
        return await pool.query(text, params);
      } catch (e) {
        if (!isRetryable(e)) throw e;
        log.warn(`Banco indisponível (${e.message}); tentando de novo...`);
        await new Promise((r) => setTimeout(r, retryDelayMs));
        return pool.query(text, params);
      }
    },
    end: () => pool.end(),
  };
}
