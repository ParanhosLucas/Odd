import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROLE_LABELS, roleLabel } from "../public/roles.js";
import { ROLES } from "./auth.js";

const pub = (f) => readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), "public", f), "utf8");

test("perfil 'user' aparece como Vendedor; o valor guardado continua 'user'", () => {
  assert.equal(roleLabel("user"), "Vendedor");
  assert.equal(roleLabel("admin"), "Administrador");
  assert.equal(roleLabel("outro"), "outro"); // perfil desconhecido não vira "undefined"
  assert.deepEqual(Object.keys(ROLE_LABELS).sort(), [...ROLES].sort()); // um rótulo para cada perfil que o servidor aceita
  assert.deepEqual(ROLES, ["user", "admin"]); // nada mudou no banco nem na API
});

test("lista de Perfil: opções Vendedor e Administrador, com os mesmos valores de antes", () => {
  const select = pub("admin.html").match(/<select name="role">([\s\S]*?)<\/select>/)[1];
  const options = [...select.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(options, [["user", "Vendedor"], ["admin", "Administrador"]]);
  for (const [valor, rotulo] of options) assert.equal(rotulo, ROLE_LABELS[valor]); // HTML e roles.js não divergem
});

test("coluna Perfil da tabela usa o rótulo novo", () => {
  const js = pub("admin.js");
  assert.match(js, /import \{ roleLabel \} from "\/roles\.js"/);
  assert.match(js, /cell\(roleLabel\(u\.role\)\)/);
  assert.doesNotMatch(js, /"Usuário"\)/); // o texto fixo antigo da coluna sumiu
});

test("só o perfil mudou: o resto da tela de usuários continua dizendo Usuário", () => {
  const html = pub("admin.html");
  assert.match(html, /<title>Usuários · MCZ Bet<\/title>/);
  assert.match(html, /<h1>Usuários<\/h1>/);
  assert.match(html, /<label>Usuário <input name="username"/);
  assert.match(html, /<h2>Usuários cadastrados<\/h2>/);
  assert.match(html, /<th>Usuário<\/th><th>Perfil<\/th>/);
  assert.doesNotMatch(html, /<option[^>]*>Usuário<\/option>/);
});
