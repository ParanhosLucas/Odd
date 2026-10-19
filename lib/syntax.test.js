import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Os scripts do navegador (app.js etc.) não rodam nos testes de unidade: um erro de sintaxe neles deixaria o site
// em branco sem nenhum teste falhar. Aqui cada arquivo de /public passa pela checagem de sintaxe do Node.
const publicDir = join(fileURLToPath(new URL("..", import.meta.url)), "public");
for (const f of readdirSync(publicDir).filter((x) => x.endsWith(".js"))) {
  test(`sintaxe válida: public/${f}`, () => {
    // .js de /public são módulos (ou scripts clássicos, como theme.js): --check aceita ambos pelo conteúdo
    assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", join(publicDir, f)], { stdio: "pipe" }));
  });
}
