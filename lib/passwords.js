// Hash de senha com scrypt (nativo do Node). Formato guardado: scrypt$N$r$p$salt$hash (base64),
// com os parâmetros dentro da string, para poder aumentá-los no futuro sem invalidar senhas antigas.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const PARAMS = { N: 2 ** 15, r: 8, p: 1 }; // ~32 MiB por hash; OWASP aceita N=2^15 com r=8
const KEYLEN = 64;
const maxmem = (N, r) => 128 * N * r * 2;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128; // limita o custo de um hash (evita abuso com senhas gigantes)

export async function hashPassword(password, params = PARAMS) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEYLEN, { ...params, maxmem: maxmem(params.N, params.r) });
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split("$");
  if (alg !== "scrypt" || !hash) return false;
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  if (![params.N, params.r, params.p].every(Number.isInteger) || params.N > 2 ** 20) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length, { ...params, maxmem: maxmem(params.N, params.r) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Hash "falso" para gastar o mesmo tempo quando o usuário não existe (não revela quem tem conta pelo tempo de resposta).
let dummy;
export const dummyHash = () => (dummy ??= hashPassword("senha-que-ninguem-usa"));
