# Odd — odds de futebol (1X2)

Espelha a aba **Odds** do Flashscore (futebol, bet365): jogos que ainda não começaram, de hoje até +7 dias (jogos ao vivo não são exibidos).

## Rodar

```
node server.js          # http://localhost:3000
npm test
```

Node 18+. Sem dependências. Configuração por variáveis de ambiente: veja `.env.example`.

## API

| Rota | Descrição |
|---|---|
| `GET /api/odds?day=N` | Jogos com odds do dia `N` (0 = hoje … `MAX_DAY`). `400` se `day` for inválido, `429` se passar do limite, `502` se a fonte falhar sem cache. |
| `GET /healthz` | `{ ok, lastSuccessAt }` — para health checks. |

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

## Hospedar

```
docker build -t odd . && docker run -p 3000:3000 -e TRUST_PROXY=1 odd
```

**Render (grátis):** `render.yaml` já está pronto. Em render.com: *New → Blueprint* → escolha este repositório → *Apply*.
O plano grátis "dorme" após ~15 min sem acesso (o primeiro acesso depois disso demora ~30 s).
Se o Flashscore bloquear o IP do provedor, `/api/odds` devolve `502` — veja os logs do serviço.

Em Railway/Fly: use o Dockerfile (ou `node server.js`), defina `TRUST_PROXY=1` e `NODE_ENV=production`.
O rate limit e o cache ficam em memória: use **uma instância** (ou adicione Redis para escalar).

## Aviso importante

Os dados vêm de feeds internos do Flashscore, **não de uma API oficial**: o formato pode mudar sem aviso e os
Termos de Uso do site restringem scraping. Para uso público/comercial, prefira uma API de odds licenciada.
Em `providers/flashscore.js` está todo o código que depende do Flashscore.
