# AVSYS — Sistema Distribuído de Reserva de Passagens Aéreas

Projeto final da disciplina de **Sistemas Distribuídos e Programação Paralela**.  
Implementa um sistema de reserva de passagens com alta concorrência, prevenção de double-booking e tolerância a falhas, documentado no formato de artigo SBC.

---

## Arquitetura

```
                        ┌──────────┐
                        │  CLIENT  │
                        └────┬─────┘
                             │ HTTP :80
                        ┌────▼─────────────┐
                        │   NGINX           │  API Gateway
                        │   rate limiting   │  load balancing
                        └──┬────┬────┬──────┘
                  /flights/ │    │ /reservations/  │ /payments/
              ┌─────────────┘    └───────┐  └──────────────┐
              ▼                          ▼                  ▼
   ┌──────────────────┐   ┌──────────────────┐  ┌──────────────────┐
   │  flight-catalog  │   │reservation-service│  │ payment-service  │
   │     :3001        │   │     :3002         │  │     :3003        │
   │   SQLite (WAL)   │   │   SQLite (WAL)    │  │   SQLite (WAL)   │
   └────────┬─────────┘   └────┬───────┬──────┘  └────────┬─────────┘
            │                  │       │                   │
            │     ┌────────────┘       └─────────────┐    │
            ▼     ▼                                   ▼    ▼
        ┌───────────┐                          ┌───────────────┐
        │   REDIS   │  lock distribuído        │   RABBITMQ    │
        │   :6379   │  cache de buscas         │   :5672       │
        └───────────┘                          │ airline.events│
                                               └───────────────┘
```

### Fluxo de uma reserva (prevenção de double-booking)

1. Cliente envia `POST /api/reservations/`
2. NGINX roteia para `reservation-service`
3. Redis: `SET lock:seat:<id> <token> NX EX 30` — lock atômico
4. Se lock falhou → `HTTP 409` (assento bloqueado por outro usuário)
5. SQLite: `BEGIN IMMEDIATE` → `SELECT` assento → `INSERT` reserva → `UPDATE` versão → `COMMIT`
6. Se versão mudou entre SELECT e UPDATE → rollback (lock otimista)
7. RabbitMQ: publica `payment.requested` no exchange `airline.events`
8. Redis: libera lock via Lua script (delete atômico por token)
9. `payment-service` consome a fila, processa pagamento (mock, 90% sucesso)
10. Publica `payment.succeeded` ou `payment.failed`
11. `reservation-service` atualiza status no SQLite e publica `reservation.confirmed`

---

## Stack

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Runtime | [Bun 1.2](https://bun.sh) | TypeScript nativo, ~3× throughput vs Node.js |
| Framework | [ElysiaJS](https://elysiajs.com) | type-safe end-to-end via TypeBox, MVC pattern |
| Banco | SQLite via `bun:sqlite` | driver nativo, zero-config, ACID, WAL mode |
| Lock distribuído | Redis `SET NX EX` + Lua | atômica, single-threaded, TTL anti-deadlock |
| Mensageria | RabbitMQ topic exchange | filas duráveis, DLX, prefetch, desacoplamento |
| Gateway | NGINX | roteamento L7, `least_conn`, `limit_req_zone` |
| Containers | Docker Compose | health checks, redes isoladas, volumes nomeados |

---

## Estrutura do projeto

```
avfinalParalela/
├── docker-compose.yml
├── nginx.conf
├── docs/
│   └── metodologia.md          # Seção 2 do artigo SBC (PT-BR)
├── frontend/
│   ├── index.html              # UI de reservas (estética FIDS)
│   └── architecture.html       # Visualização da arquitetura em tempo real
└── services/
    ├── flight-catalog/          # Catálogo de voos e assentos
    │   └── src/
    │       ├── config/          # database.ts · redis.ts · rabbitmq.ts
    │       └── modules/
    │           ├── flights/     # controller · service · model
    │           └── seats/
    ├── reservation-service/     # Orquestração: lock → tx → publish
    │   └── src/
    │       ├── config/          # database.ts · event-logger.ts · redis.ts · rabbitmq.ts
    │       └── modules/
    │           ├── reservations/ # controller · service · model · lock.ts
    │           └── consumers/   # payment.consumer.ts
    └── payment-service/         # Processamento assíncrono de pagamentos
        └── src/
            ├── config/
            └── modules/
                ├── payments/
                └── consumers/   # payment-request.consumer.ts
```

---

## Como executar

### Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose v2
- Portas livres: **80** (NGINX), **15672** (RabbitMQ Management)

### Subir tudo

```bash
docker compose up --build -d
```

Aguarde todos os serviços ficarem `healthy` (~30–60s na primeira vez):

```bash
docker compose ps
```

### Acessar

| URL | Descrição |
|---|---|
| `http://localhost` | Interface de reservas |
| `http://localhost/architecture.html` | Arquitetura em tempo real |
| `http://localhost:15672` | RabbitMQ Management (guest/guest) |

### Parar

```bash
docker compose down
```

Para remover também os volumes (banco de dados):

```bash
docker compose down -v
```

---

## Endpoints da API

Todos os endpoints são expostos pelo NGINX em `http://localhost`.

### flight-catalog (`/api/flights/`)

```
GET  /api/flights/search?origin=GRU&destination=GIG&date=2026-08-15
GET  /api/flights/:flightId
GET  /api/flights/:flightId/seats
```

### reservation-service (`/api/reservations/`)

```
POST   /api/reservations/             body: { flight_id, seat_id, user_id, total_price }
GET    /api/reservations/:id
GET    /api/reservations/user/:userId
DELETE /api/reservations/:id
GET    /api/events?since=<id>&limit=<n>   # stream de eventos para o painel
```

### payment-service (`/api/payments/`)

```
GET /api/payments/:paymentId
GET /api/payments/reservation/:reservationId
```

### Health checks

```
GET /health                   # gateway NGINX
GET /api/catalog/health       # flight-catalog
GET /api/booking/health       # reservation-service
GET /api/payment/health       # payment-service
```

---

## Exemplo de uso (curl)

```bash
# 1. Buscar voos GRU → GIG
curl "http://localhost/api/flights/search?origin=GRU&destination=GIG&date=2026-08-15"

# 2. Ver assentos disponíveis
curl "http://localhost/api/flights/flight-001/seats"

# 3. Criar reserva (aciona lock Redis + transação SQLite)
curl -X POST http://localhost/api/reservations/ \
  -H "Content-Type: application/json" \
  -d '{"flight_id":"flight-001","seat_id":"seat-001-20A","user_id":"user-42","total_price":299.90}'

# 4. Testar double-booking (segunda requisição deve retornar 409)
curl -X POST http://localhost/api/reservations/ \
  -H "Content-Type: application/json" \
  -d '{"flight_id":"flight-001","seat_id":"seat-001-20A","user_id":"user-99","total_price":299.90}'

# 5. Acompanhar eventos em tempo real
curl "http://localhost/api/events?limit=20"
```

---

## Dados de seed

O `flight-catalog` inicializa o banco com dados de exemplo na primeira execução:

| ID | Voo | Rota | Horário (UTC) | Preço base |
|---|---|---|---|---|
| `flight-001` | LA3051 | GRU → GIG | 08:00 → 09:10 | R$ 299,90 |
| `flight-002` | G3 1234 | GRU → BSB | 10:00 → 11:30 | R$ 399,90 |
| `flight-003` | AD4567 | GIG → GRU | 14:00 → 15:10 | R$ 249,90 |

---

## Mecanismos de concorrência

### Lock distribuído (Redis)

```
reservation-service           redis
      │                         │
      │  SET lock:seat:X token  │
      │  NX EX 30               │
      │────────────────────────▶│
      │  OK / nil               │
      │◀────────────────────────│
      │                         │
      │  [transação SQLite]     │
      │                         │
      │  EVAL lua_release_script│
      │  KEYS[1]=lock  ARGV[1]=token
      │────────────────────────▶│
      │  DEL (apenas se owner)  │
      │◀────────────────────────│
```

- `SET NX EX` é atômica no Redis (single-threaded)
- O script Lua garante que apenas o dono do lock possa liberá-lo
- TTL de 30s previne deadlock em caso de crash

### Lock otimista (SQLite)

Cada assento tem uma coluna `version INTEGER`. O UPDATE só aplica se a versão não mudou desde o SELECT:

```sql
UPDATE seats SET status = 'reserved', version = version + 1
WHERE id = ? AND version = ?   -- falha silenciosa se version mudou
```

Se `changes = 0`, a transação é abortada com HTTP 409.  
Isso protege contra race conditions em cenários multi-instância onde Redis e SQLite compartilham o mesmo arquivo.

---

## Escalonamento horizontal

O NGINX está configurado para distribuir carga entre réplicas via DNS round-robin do Docker:

```bash
# Subir 3 réplicas do flight-catalog
docker compose up --scale flight-catalog=3 -d
```

> **Nota:** em produção, SQLite deve ser substituído por um banco externo (PostgreSQL, etc.) antes de escalar `reservation-service`, pois o arquivo `.db` não suporta múltiplos writers em containers distintos. O mecanismo de lock Redis está implementado exatamente para esse cenário.

---

## Documentação acadêmica

A seção **2. Metodologia** do artigo SBC está em [`docs/metodologia.md`](docs/metodologia.md), cobrindo:

- 2.1 Arquitetura do Sistema
- 2.2 Tecnologias Utilizadas (com justificativas técnicas)
- 2.3 Organização dos Microsserviços
- 2.4 Fluxo de Comunicação e Estrutura de Contêineres
- 2.5 Gerenciamento de Concorrência (fluxo passo a passo do lock distribuído)

---

## RabbitMQ — Topologia de filas

Exchange: `airline.events` (topic)

| Routing key | Fila | Consumidor |
|---|---|---|
| `payment.requested` | `q.payment.requested` | payment-service |
| `payment.succeeded` | `q.payment.succeeded` | reservation-service |
| `payment.failed` | `q.payment.failed` | reservation-service |
| `reservation.confirmed` | `q.reservation.confirmed` | flight-catalog |
| `reservation.cancelled` | `q.reservation.cancelled` | flight-catalog |

Todas as filas são duráveis (`durable: true`) com Dead Letter Exchange configurado para mensagens que falham após 3 tentativas.
# avsys
