// Banco isolado para testes com Postgres de verdade: cada chamada cria um esquema novo e devolve uma URL cujo
// search_path aponta para ele. Assim os arquivos de teste (que rodam em paralelo) nunca pisam nos dados uns dos outros.
import { randomBytes } from "node:crypto";
import pg from "pg";

export async function isolatedDb(baseUrl) {
  const schema = `t_${process.pid}_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  // application_name = nome do esquema: dá para identificar (e derrubar) só as conexões deste teste em pg_stat_activity
  const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=${encodeURIComponent(`-c search_path=${schema}`)}&application_name=${schema}`;
  return {
    url, schema,
    async drop() { try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await admin.end(); } },
  };
}
