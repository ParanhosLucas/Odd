# Mcz Bet — odds de futebol (1X2)

Espelha a aba **Odds** do Flashscore (futebol, bet365): jogos que ainda não começaram, de hoje até +7 dias (jogos ao vivo não são exibidos).

## Rodar

```
npm install
ADMIN_USER=admin ADMIN_PASSWORD='uma-senha-forte' node server.js   # http://localhost:3000
npm test
```

Node 22+. Dependência de produção: `pg` (Postgres). Configuração por variáveis de ambiente: veja `.env.example`.

## Login e usuários

O site exige login. Os usuários e as sessões ficam num **Postgres** externo (Neon, grátis; veja "Hospedar" abaixo).

- **Primeiro administrador:** criado na subida a partir de `ADMIN_USER` / `ADMIN_PASSWORD`, **só se o banco ainda não tiver nenhum administrador** (nunca sobrescreve senhas). Se o banco for apagado/recriado, o admin volta sozinho com essas variáveis.
- **Criar e excluir usuários:** logado como administrador, abra **Usuários** no topo do site (`/admin.html`). Excluir derruba as sessões abertas do usuário na hora. Não dá para excluir a si mesmo nem o último administrador.
- **Segurança:** senhas só como hash `scrypt`; cookie de sessão `HttpOnly` + `SameSite=Lax` + `Secure` (em produção), com 7 dias de validade e guardado no banco só como hash; no máximo 10 falhas de login por usuário (30 por IP) em 15 minutos; mensagem de erro igual para "usuário inexistente" e "senha errada"; proteção contra CSRF (JSON obrigatório + checagem de `Origin`).
- **Não há** troca/redefinição de senha: para trocar a senha de alguém, exclua e crie o usuário de novo.
- Seleção, ligas fixadas, valor da aposta e registro ficam no navegador, **separados por usuário**.

### Rodar localmente com login

```
ADMIN_USER=admin ADMIN_PASSWORD='uma-senha-forte' node server.js   # usuários só em memória
# com Postgres local: acrescente DATABASE_URL=postgres://usuario:senha@127.0.0.1:5432/banco
```

Sem `DATABASE_URL` os usuários ficam em memória (somem ao reiniciar); em produção (`NODE_ENV=production`) o servidor **se recusa a subir** sem ela.

### Testes

`npm test` roda tudo (o Postgres é simulado com `pg-mem`). Para rodar também contra um Postgres de verdade (inclui o teste que derruba as conexões à força):

```
TEST_DATABASE_URL=postgres://usuario@127.0.0.1:5432/banco_de_teste npm test   # APAGA as tabelas users/sessions desse banco
```

## API

| Rota | Descrição |
|---|---|
| `GET /api/odds?day=N` | Jogos com odds do dia `N` (0 = hoje … `MAX_DAY`). `400` se `day` for inválido, `429` se passar do limite, `502` se a fonte falhar sem cache. |
| `GET /healthz` | `{ ok, lastSuccessAt }` — para health checks (público). |
| `POST /api/login` · `POST /api/logout` · `GET /api/me` | Login (`{ username, password }`), logout e usuário atual. |
| `GET/POST /api/admin/users` · `DELETE /api/admin/users/:id` | Listar, criar e excluir usuários (só administrador). |

Tudo em `/api/*` (exceto `login` e `/healthz`) exige login: `401` sem sessão, `403` sem ser administrador, `503` se o banco estiver fora.

Resposta de `/api/odds`:

```json
{ "source": "flashscore", "stale": false, "error": null, "day": 0, "maxDay": 7,
  "updatedAt": "…",
  "leagues": [{ "name": "BRASIL: Brasileirão Série B", "matches": [
    { "id": "…", "home": "…", "away": "…", "startTime": "ISO",
      "odds": { "home": 1.66, "draw": 3.7, "away": 5, "prev": { "home": 1.96, "draw": 3.25, "away": 3.6 } } } ] }] }
```

`prev` são as odds anteriores (a UI mostra ↑/↓ comparando). `stale: true` = o Flashscore falhou e o dado é o último obtido.

## Como o backend se comporta

- **Cache por dia** (`CACHE_TTL_SECONDS`) e **uma única busca** para requisições simultâneas.
- **Falha da fonte:** serve o último dado bom por até `STALE_MAX_SECONDS`; depois, `502` (ou dados de demonstração se `DEMO_FALLBACK=1`).
- **Rate limit** por IP, cabeçalhos de segurança (CSP etc.), gzip, bloqueio de path traversal, encerramento gracioso (SIGTERM).

## Hospedar: site no Render + banco no Neon (grátis)

O `render.yaml` cria só o **site**. Usuários e sessões ficam num Postgres **externo** (Neon), porque o banco grátis do Render expira 30 dias após criado e é apagado.

**1. Criar o banco no Neon** (neon.com, conta grátis)
1. Crie uma conta e um projeto (nome `odd`). Escolha a região mais próxima do site no Render (o padrão do Render é Oregon → no Neon, *AWS US West 2 (Oregon)*).
2. No painel do projeto, clique em **Connect**. Deixe **Connection pooling** ligado, escolha o banco `neondb` e copie a **connection string**. Ela tem este formato (e contém a senha):
   `postgresql://neondb_owner:...@ep-...-pooler....neon.tech/neondb?sslmode=require&channel_binding=require`

**2. Ligar o site ao banco (Render)**
1. Serviço **odd → Environment** → `DATABASE_URL` → cole a string do Neon → *Save*. A senha fica só no Render, nunca no GitHub.
   (Se o Render pedir o valor de `DATABASE_URL` ao sincronizar o Blueprint, cole a mesma string.)
2. **Manual Deploy → Deploy latest commit**. Nos logs devem aparecer `Banco de usuários pronto.` e `Administrador inicial "admin" criado.`

**3. Entrar:** o usuário é `admin` e a senha é o valor de `ADMIN_PASSWORD` em **Environment** (gerado pelo Render). Depois crie os outros usuários em **Usuários**.

**Se vinha do banco do Render:** depois de confirmar que o login funciona com o Neon, apague o banco antigo (`odd-db` → *Settings* → *Delete Database*). Os usuários dele não são migrados: o `admin` volta sozinho e os demais precisam ser criados de novo.

**Como o Neon grátis se comporta (confira os termos atuais em neon.com/docs/introduction/plans):**
- O banco **dorme após 5 minutos sem uso** e os dados continuam lá. O primeiro acesso depois disso demora de ~0,5 s a alguns segundos. O servidor fecha conexões ociosas antes e tenta de novo se uma conexão cair (`lib/pg-pool.js`).
- Não encontrei indício de que o Neon apague banco grátis por inatividade. Mesmo assim, não há backup automático no plano grátis: se os usuários forem importantes, faça `pg_dump` de vez em quando.

**Limites do site grátis no Render:**
- O site "dorme" após ~15 min sem acesso (o primeiro acesso demora ~30 s). As sessões ficam no banco e sobrevivem a isso.
- O cache de odds e o limite de requisições ficam em memória: use **uma instância**.

Fora do Render: `docker build -t odd . && docker run -p 3000:3000 -e DATABASE_URL=... -e ADMIN_USER=... -e ADMIN_PASSWORD=... -e TRUST_PROXY=1 odd`.

## Aviso importante

Os dados vêm de feeds internos do Flashscore, **não de uma API oficial**: o formato pode mudar sem aviso e os
Termos de Uso do site restringem scraping. Para uso público/comercial, prefira uma API de odds licenciada.
Em `providers/flashscore.js` está todo o código que depende do Flashscore.
