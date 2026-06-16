# AVSYS — Guia para Claude Code

## O que é este projeto

Sistema distribuído de reserva de passagens aéreas — projeto final de Sistemas Distribuídos. Três microsserviços Bun/ElysiaJS atrás de um NGINX, com Redis para lock distribuído e RabbitMQ para eventos assíncronos. Banco de dados SQLite nativo em cada serviço.

## Comandos essenciais

```bash
# Subir tudo (rebuild obrigatório após mudanças em serviços)
docker compose up --build -d

# Ver status e health checks
docker compose ps

# Logs de um serviço específico
docker compose logs -f reservation-service

# Reiniciar só um serviço (quando apenas código TypeScript mudou)
docker compose restart reservation-service

# Parar tudo e apagar bancos
docker compose down -v
```

> **Frontend** (`frontend/`) é volume montado no NGINX — mudanças em `.html` são visíveis imediatamente sem rebuild. Mudanças em `services/*/src/` exigem `docker compose up --build`.

## Arquitetura em 30 segundos

```
Browser → NGINX :80 → flight-catalog  :3001  (SQLite: flights, seats)
                    → reservation-service :3002 (SQLite: reservations, seats*, events)
                    → payment-service     :3003 (SQLite: payments)
                              ↕ Redis  (lock distribuído, idempotência)
                              ↕ RabbitMQ  exchange: airline.events
```

`*` reservation-service mantém cópia local de `seats` para atomicidade do lock otimista. flight-catalog é a fonte canônica do catálogo; reservation-service gerencia disponibilidade para reservas.

## Roteamento NGINX

O NGINX faz **strip de prefixo** — a barra final em `proxy_pass` é obrigatória:

| URL pública | Serviço recebe |
|---|---|
| `GET /api/flights/search` | `GET /flights/search` |
| `POST /api/reservations/` | `POST /reservations/` |
| `GET /api/events` | `GET /events` |

**Crítico:** sempre use trailing slash nas chamadas `fetch` para `POST /api/reservations/`. Sem ela, NGINX retorna 301, o browser converte POST→GET no redirect, e o ElysiaJS retorna `NOT_FOUND` (texto, não JSON).

## Estrutura de cada microsserviço

```
src/
├── index.ts              # entrada: conecta RabbitMQ, registra rotas, listen
├── config/
│   ├── database.ts       # cria DB, migrações inline, seed idempotente
│   ├── redis.ts          # ioredis singleton
│   └── rabbitmq.ts       # amqplib: connect com retry, assert topologia, publish()
└── modules/
    ├── <feature>/
    │   ├── index.ts      # controller ElysiaJS (rotas, validação TypeBox)
    │   ├── service.ts    # lógica de negócio (abstract class com static methods)
    │   └── model.ts      # schemas TypeBox + tipos exportados
    └── consumers/
        └── *.consumer.ts # consumidores RabbitMQ
```

## Padrões de código

**Controller (`index.ts`):** usa `new Elysia({ prefix, name })`, registra modelos com `.model()`, decora com o serviço via `.decorate()`, referencia schemas pelo nome string (`body: 'reservation.CreateBody'`).

**Service (`service.ts`):** `abstract class` com métodos `static`. Nunca acessa Redis ou RabbitMQ de outros serviços — apenas o próprio banco SQLite e seus clientes de infra.

**Model (`model.ts`):** sempre exporta tanto o schema TypeBox quanto o tipo derivado (`type Foo = typeof FooSchema.static`).

**Erros:** service retorna `status(code, body)` do elysia (não `throw`). Controller usa `onError` para tratar erros de validação (code `'VALIDATION'`).

## Fluxo de reserva (ponto crítico de concorrência)

```
1. POST /api/reservations/ → reservation-service
2. Redis: SET lock:seat:<flight>:<seat> <token> NX EX 30   ← atômico
3. Se nil → 409 (outro usuário está reservando)
4. SQLite BEGIN IMMEDIATE:
   a. SELECT seat WHERE id=? AND flight_id=?  (verifica status)
   b. INSERT INTO reservations
   c. UPDATE seats SET status='reserved', version=version+1 WHERE id=? AND version=?
   d. Se changes=0 → rollback (lock otimista falhou)
5. RabbitMQ: publish payment.requested
6. Redis: EVAL lua_release (DEL só se owner do lock)
7. Retorna 202 com reservation_id
```

## Banco de dados

Cada serviço usa `bun:sqlite` (driver nativo, zero-config). Migrações são `CREATE TABLE IF NOT EXISTS` rodadas no startup — idempotentes. Seeds usam `INSERT OR IGNORE`.

**Pragmas ativos em todos:** `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.

**Tabela `seats` duplicada:** flight-catalog tem a visão canônica (número, classe, preço). reservation-service tem cópia local com apenas `{id, flight_id, status, version}` para o lock otimista. São sincronizados via RabbitMQ: `reservation.confirmed` → flight-catalog marca `sold`; `reservation.cancelled` / pagamento falho → reservation-service restaura `available` localmente e publica evento para flight-catalog.

## RabbitMQ — topologia

Exchange `airline.events` (topic). Configurada via assert no startup de cada serviço — não há arquivo de definições externo.

| Routing key | Produtor | Consumidor |
|---|---|---|
| `payment.requested` | reservation-service | payment-service |
| `payment.succeeded` | payment-service | reservation-service |
| `payment.failed` | payment-service | reservation-service |
| `reservation.confirmed` | reservation-service | flight-catalog |
| `reservation.cancelled` | reservation-service | flight-catalog |

Filas duráveis com Dead Letter Exchange. `prefetch(1)` em todos os consumers.

## Redis

- **Lock:** `SET lock:seat:<flight_id>:<seat_id> <uuid_token> NX EX 30`
- **Release:** script Lua (`EVAL`) — delete atômico somente se o token bater
- **Idempotência (payment-service):** `SET payment:idempotent:<key> 1 NX EX 86400`
- **Cache (flight-catalog):** buscas cacheadas com TTL 5 min, chave `flights:search:<params>`

## Eventos em tempo real

reservation-service grava eventos na tabela SQLite `events` (máx 500, com trigger de limpeza). O endpoint `GET /events?since=<id>&limit=<n>` é consumido pela página `architecture.html` via polling a cada 1,2s.

Tipos de evento: `lock.acquired`, `lock.failed`, `lock.released`, `db.transaction`, `rabbitmq.published`, `payment.succeeded`, `payment.failed`, `reservation.confirmed`, `reservation.cancelled`.

## Dados de seed (flight-catalog — voos disponíveis para teste)

| ID | Voo | Rota | Data |
|---|---|---|---|
| `flight-001` | LA3051 | GRU→GIG | 2026-08-15 08:00 UTC |
| `flight-002` | G3 1234 | GRU→BSB | 2026-08-15 10:00 UTC |
| `flight-003` | AD4567 | GIG→GRU | 2026-08-15 14:00 UTC |

IDs de assento seguem o padrão `seat-<flight_num>-<número>` (ex: `seat-001-20A`).

## Armadilhas conhecidas

- **Rebuild obrigatório após mudança em TypeScript.** Volumes de código-fonte não são montados em runtime — só os volumes de dados (`flights_db`, `reservations_db`, etc.).
- **SQLite não suporta múltiplos writers em containers diferentes.** Escalar `reservation-service` com `--scale` exige banco externo. flight-catalog pode ser escalado (só lê; writes vêm via consumer que tem `prefetch(1)`).
- **health checks dependem de `curl`** instalado via `RUN apk add --no-cache curl` em todos os Dockerfiles. Sem isso, `condition: service_healthy` nunca passa e nenhum serviço sobe.
- **ElysiaJS retorna `NOT_FOUND` (texto, não JSON)** para rotas inexistentes. Sempre checar `res.ok` antes de `res.json()` no frontend.
- **Seat seed duplicado:** `reservation-service/src/config/database.ts` tem cópia dos IDs de assento (`INSERT OR IGNORE`). Ao adicionar voos/assentos no `flight-catalog`, adicionar também lá — senão `SELECT ... FROM seats` retorna `null` e a reserva retorna 404.
- **Cancelamento de reserva deve restaurar assento em dois lugares:** em `ReservationService.cancel()` (cancelamento manual) e no consumer `q.payment.failed` (pagamento falho). Esquecer um deixa o assento preso como `reserved` para sempre.
- **`bun:sqlite` transactions:** o padrão é `db.transaction(() => { ... })()` — a função `.transaction()` retorna um wrapper que precisa ser chamado. Não chamar resulta em silêncio (a função é criada mas nunca executada).
- **Dashboard de polling + histórico:** ao inicializar uma página que faz polling de `/api/events`, carregar os eventos existentes silenciosamente (sem animar) e só disparar efeitos visuais em eventos que cheguem *depois* do carregamento. Usar um flag `initialized` para separar as duas fases — sem isso o refresh replaya animações antigas e parece falso.

## Frontend — preferências de UI

- Animações devem ser **limpas e mínimas**: 1 partícula por evento (não burst), sem efeito de tilt 3D no mouse, sem efeitos que distraiam do conteúdo.
