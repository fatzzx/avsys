# 2. Metodologia

## 2.1 Arquitetura do Sistema

O presente sistema foi projetado segundo o padrão arquitetural de microsserviços [Newman 2015], no qual uma aplicação monolítica tradicional é decomposta em um conjunto de serviços pequenos, independentes e implantáveis de forma autônoma. Cada microsserviço encapsula um subdomínio de negócio bem definido, mantém seu próprio estado persistente e se comunica com os demais por meio de interfaces padronizadas — chamadas HTTP REST síncronas para operações onde o cliente aguarda a resposta, e mensagens assíncronas via fila para efeitos colaterais entre serviços.

Essa abordagem confere ao sistema três propriedades fundamentais para um ambiente de alta concorrência: (i) **escalabilidade horizontal independente** — serviços com alta demanda podem ter múltiplas réplicas sem afetar os demais; (ii) **isolamento de falhas** — a indisponibilidade de um serviço não propaga falhas em cascata [Kleppmann 2017]; e (iii) **autonomia de dados** — cada serviço é proprietário exclusivo de seu banco de dados, eliminando a necessidade de transações distribuídas entre serviços [Richardson 2018].

A borda do sistema é composta por um API Gateway (NGINX), que recebe todas as requisições externas, roteia-as para o microsserviço correspondente com base no prefixo de caminho da URL, e aplica políticas de rate limiting. A comunicação entre serviços ocorre, quando necessária, de forma assíncrona por meio de um barramento de eventos baseado em RabbitMQ.

## 2.2 Tecnologias Utilizadas

### Bun e ElysiaJS

O runtime selecionado para a implementação dos microsserviços foi o **Bun** [OvenSH 2023], uma plataforma JavaScript/TypeScript de alto desempenho que executa código TypeScript nativamente, sem etapa de transpilação para JavaScript. Em benchmarks comparativos publicados pelo projeto TechEmpower [TechEmpower 2024], servidores construídos com Bun processam aproximadamente 2,5 a 3 vezes mais requisições por segundo do que equivalentes em Node.js, tornando-o particularmente adequado para microsserviços executados em contêineres com recursos limitados.

Sobre o Bun, o framework **ElysiaJS** [Saltyaom 2023] oferece uma abordagem de alto desempenho com validação de tipos de ponta a ponta. Os esquemas de validação de entrada e saída das rotas, definidos com TypeBox, não apenas validam payloads em tempo de execução, mas também geram automaticamente os tipos TypeScript correspondentes — eliminando divergência entre o contrato da API e sua implementação. O padrão arquitetural adotado é MVC orientado a domínios: cada módulo é composto por um *controller* (instância Elysia com as rotas), um *service* (lógica de negócio em classe abstrata) e um *model* (esquemas TypeBox e tipos exportados).

### SQLite via bun:sqlite

Para a persistência local de cada microsserviço, optou-se pelo **SQLite** acessado por meio do driver nativo `bun:sqlite`, embutido no próprio runtime Bun sem dependência de processo externo ou pacote adicional. O SQLite oferece propriedades ACID completas [Date 2003]: atomicidade, consistência, isolamento e durabilidade. A opção por `PRAGMA journal_mode=WAL` (Write-Ahead Logging) permite que múltiplas leituras ocorram concorrentemente mesmo durante uma escrita, aumentando o throughput em cenários de alta carga de leitura.

Para o controle de concorrência nas escritas, emprega-se **versionamento otimista de linhas** [Bernstein et al. 1987]: a tabela de assentos possui uma coluna `version` que é incrementada a cada atualização. Ao realizar uma reserva, a transação verifica se a versão lida ainda é a versão corrente no banco antes de atualizar — se outro processo tiver modificado o registro no intervalo, o `changes` do UPDATE será zero, e a operação é abortada.

### Redis

O **Redis** [Sanfilippo 2009] é empregado em dois papéis distintos no sistema. Primeiro, como **cache de resultados de busca**: os resultados da consulta de voos são armazenados em Redis com TTL de 5 minutos (chave no formato `flights:search:{origin}:{dest}:{date}:{class}`), reduzindo significativamente a carga sobre o banco de dados nos picos de tráfego. Segundo, e mais criticamente, como **mecanismo de lock distribuído** entre instâncias do serviço de reservas — papel detalhado na Seção 2.5.

### RabbitMQ

A comunicação assíncrona entre serviços é realizada por meio do **RabbitMQ** [Pivotal 2007], um broker de mensagens que implementa o protocolo AMQP 0-9-1. A topologia adotada é um *topic exchange* denominado `airline.events`, no qual as mensagens são roteadas para filas específicas com base em chaves de roteamento no formato `{agregado}.{evento}` (por exemplo, `payment.requested`, `reservation.confirmed`). As filas são declaradas como duráveis, garantindo persistência das mensagens em caso de reinicialização do broker. Cada consumidor utiliza `prefetch_count = 1`, processando uma mensagem por vez, e um *Dead Letter Exchange* (DLX) recebe mensagens que excedam o número máximo de tentativas, permitindo análise posterior de falhas sem perda de dados.

### NGINX

O **NGINX** [Reese 2008] atua como API Gateway na borda do sistema, provendo: roteamento baseado em prefixo de caminho (`/api/flights/`, `/api/reservations/`, `/api/payments/`); balanceamento de carga pelo algoritmo `least_conn` para serviços com múltiplas réplicas; e rate limiting via `limit_req_zone`, configurado para no máximo 20 requisições por segundo por endereço IP — protegendo os serviços contra sobrecarga intencional ou acidental.

### Docker e Docker Compose

A conteinerização de cada serviço via **Docker** garante portabilidade e reprodutibilidade do ambiente de execução. O **Docker Compose** orquestra o grafo completo de dependências mediante a diretiva `depends_on` com `condition: service_healthy`: o NGINX aguarda todos os microsserviços estarem saudáveis; os microsserviços aguardam Redis e RabbitMQ passarem em seus respectivos *health checks* antes de iniciar. Os dados persistentes são armazenados em volumes nomeados, sobrevivendo a reinicializações de contêiner.

## 2.3 Organização dos Microsserviços

O sistema é composto por três microsserviços, cada um com responsabilidade e fronteira de dados bem delimitadas:

### Serviço de Catálogo de Voos (`flight-catalog`, porta 3001)

Responsável por gerenciar o inventário de voos — companhias aéreas, aeroportos, horários, preços e mapas de assentos. Por ser o serviço com maior volume de leituras, mantém um cache Redis dos resultados de busca com TTL de 5 minutos. Expõe as rotas:

- `GET /api/flights/search?origin=GRU&destination=GIG&date=2026-08-15&class=economy`
- `GET /api/flights/:flightId`
- `GET /api/flights/:flightId/seats`
- `GET /api/flights/:flightId/seats/:seatId`

Consome os eventos `reservation.confirmed` e `reservation.cancelled` do RabbitMQ para manter o status dos assentos atualizado em seu banco local.

**Banco de dados (SQLite — `flights.db`):** tabelas `airlines`, `airports`, `flights`, `seats` (com coluna `version` para controle de concorrência otimista).

### Serviço de Reservas (`reservation-service`, porta 3002)

Orquestra o fluxo crítico de reserva de assento: aquisição de lock distribuído via Redis, verificação de disponibilidade e escrita atômica no banco local via transação SQLite, publicação do evento `payment.requested` via RabbitMQ e atualização do status da reserva após recebimento do resultado de pagamento. Expõe as rotas:

- `POST /api/reservations`
- `GET /api/reservations/:reservationId`
- `GET /api/reservations/user/:userId`
- `DELETE /api/reservations/:reservationId`

**Banco de dados (SQLite — `reservations.db`):** tabelas `reservations` e `reservation_history` (trilha de auditoria de mudanças de status).

**Redis keys:** `lock:seat:{flightId}:{seatId}` (lock distribuído, TTL: 30 s).

### Serviço de Pagamentos e Notificações (`payment-service`, porta 3003)

Consumidor assíncrono do evento `payment.requested`. Implementa **idempotência** via Redis (chave `payments:idempotency:{idempotency_key}` com TTL de 24 horas) para evitar processamento duplicado de mensagens em caso de reentrega pelo broker. Após a autorização de pagamento (simulada, com 90% de taxa de sucesso), publica `payment.succeeded` ou `payment.failed` de volta ao exchange, e registra a notificação enviada ao usuário (simulação por log). Expõe as rotas:

- `GET /api/payments/:paymentId`

**Banco de dados (SQLite — `payments.db`):** tabelas `payment_orders` e `notifications`.

## 2.4 Fluxo de Comunicação e Estrutura de Contêineres

### Topologia de Rede

O sistema utiliza duas redes Docker isoladas: `airline-public`, conectando o NGINX aos três microsserviços; e `airline-internal`, conectando os microsserviços ao Redis e RabbitMQ — sem que a infraestrutura seja diretamente acessível do gateway.

### Fluxo de uma Requisição de Reserva

O fluxo completo de uma reserva de passagem ilustra a interação entre todos os componentes:

1. O cliente envia `POST /api/reservations` ao NGINX (porta 80).
2. O NGINX encaminha a requisição ao `reservation-service` (porta 3002).
3. O `reservation-service` tenta adquirir o lock Redis para o assento (`SET lock:seat:F1:S22 <token> NX EX 30`). Se o lock já estiver tomado, retorna imediatamente `HTTP 409 Conflict`.
4. Com o lock adquirido, abre uma transação SQLite: verifica disponibilidade do assento (com versionamento otimista), insere a reserva em status `pending`, e atualiza o assento para `reserved`.
5. Publica o evento `payment.requested` no RabbitMQ e retorna `HTTP 202 Accepted` ao cliente.
6. O lock Redis é liberado via script Lua atômico.
7. O `payment-service`, em paralelo, consome o evento `payment.requested` da fila `q.payment.requested`, processa o pagamento (com verificação de idempotência) e publica `payment.succeeded` ou `payment.failed`.
8. O `reservation-service` consome o resultado e atualiza o status da reserva (`confirmed` ou `cancelled`), publicando um evento correspondente para o `flight-catalog`.
9. O `flight-catalog` consome o evento e atualiza o status do assento em seu banco local (`sold` ou `available`).

A separação entre camada síncrona (REST) e assíncrona (RabbitMQ) garante que o cliente receba confirmação imediata — a latência percebida é da etapa de lock + transação, não do processamento do pagamento.

### Roteamento NGINX

```
Cliente (HTTP :80)
    │
    ▼
┌─────────────────────────────────────────────────────┐
│                        NGINX                        │
│  /api/flights/  ──►  upstream flight_catalog        │
│  /api/reservations/ ──► upstream reservation        │
│  /api/payments/  ──►  upstream payment              │
└─────────────────────────────────────────────────────┘
         │                   │                  │
         ▼                   ▼                  ▼
   flight-catalog    reservation-service  payment-service
      :3001               :3002               :3003
         │                   │                  │
         └──────────┬────────┘                  │
                    │         ┌─────────────────┘
                    ▼         ▼
               ┌─────────────────┐    ┌──────────────┐
               │     Redis       │    │   RabbitMQ   │
               │  :6379          │    │   :5672      │
               └─────────────────┘    └──────────────┘
```

## 2.5 Gerenciamento de Concorrência

### O Problema do Double-Booking

Em sistemas de reserva com alta concorrência, dois usuários podem enviar simultaneamente uma requisição para reservar o mesmo assento. Na ausência de mecanismo de coordenação, ambos os processos leriam o assento como `available`, passariam pela validação e concluiriam a escrita — resultando em duas reservas válidas para um único assento, fenômeno denominado *double-booking* [Gray & Reuter 1992]. Este é um caso clássico de *lost update*, uma anomalia de concorrência em que atualizações de múltiplos processos são silenciosamente sobrescritas.

### Lock Distribuído com Redis

A solução adotada utiliza o Redis como **mutex distribuído**, baseando-se na atomicidade do comando `SET key value NX EX ttl` [Antirez 2016]. O sufixo `NX` (*Not eXists*) instrui o Redis a realizar a atribuição somente se a chave ainda não existir; o sufixo `EX ttl` define um tempo de expiração automático. Como o Redis é executado em thread única, esta operação é **garantidamente atômica** — não pode haver condição de corrida entre dois processos que a executem simultaneamente.

```
Redis (single-threaded):

  Processo A: SET lock:seat:F1:S22 "token-a" NX EX 30  →  OK   (lock adquirido)
  Processo B: SET lock:seat:F1:S22 "token-b" NX EX 30  →  nil  (lock recusado)
```

### Fluxo Detalhado de Reserva com Lock

Considere dois usuários (A e B) enviando **simultaneamente** uma requisição para reservar o assento `S22` do voo `F1`:

```
Passo 1 — Geração de token único por requisição
  Usuário A: token = "token-a1b2c3"
  Usuário B: token = "token-x9y8z7"

Passo 2 — Tentativa de aquisição do lock (atomicamente no Redis)
  A: SET lock:seat:F1:S22 "token-a1b2c3" NX EX 30  →  OK
  B: SET lock:seat:F1:S22 "token-x9y8z7" NX EX 30  →  nil

Passo 3 — Usuário B recebe HTTP 409 imediatamente (sem acessar banco)

Passo 4 — Usuário A abre transação SQLite
  SELECT status, version FROM seats WHERE id='S22' AND flight_id='F1'
  → status='available', version=7

Passo 5 — Usuário A insere a reserva
  INSERT INTO reservations (id, user_id, ...) VALUES (...)

Passo 6 — Usuário A atualiza assento (lock otimista na versão)
  UPDATE seats SET status='reserved', version=8
  WHERE id='S22' AND version=7
  → changes = 1 (sucesso)

Passo 7 — COMMIT da transação

Passo 8 — Publicação do evento (assíncrono, após COMMIT)
  RabbitMQ.publish('airline.events', 'payment.requested', { ... })

Passo 9 — Liberação do lock via Lua (atômica)
  -- Garante que só o dono do lock pode liberá-lo
  if redis.call("GET", key) == token then
    redis.call("DEL", key)
  end

Passo 10 — Usuário A recebe HTTP 202 Accepted
  { reservation_id: "...", status: "pending", expires_at: "..." }
```

### Mecanismo Anti-Deadlock

O TTL de 30 segundos configurado no lock Redis garante que, em caso de falha do processo durante a seção crítica (travamento, crash ou desconexão), o lock seja automaticamente liberado após 30 segundos, sem necessidade de intervenção manual. Reservas que permaneçam em status `pending` além do prazo `expires_at` (15 minutos) são elegíveis para cancelamento automático, com liberação do assento correspondente.

### Dupla Camada de Proteção

A combinação do **lock Redis** (camada de aplicação) com o **versionamento otimista do SQLite** (camada de banco de dados) forma uma defesa em profundidade contra anomalias de concorrência:

| Camada          | Mecanismo                        | Protege contra                          |
|-----------------|----------------------------------|-----------------------------------------|
| Aplicação       | Redis `SET NX EX` (mutex)        | Requisições concorrentes ao mesmo assento |
| Banco de dados  | `version` otimista + `changes`   | Atualizações simultâneas na mesma linha |

O lock Redis elimina a contenção em praticamente todos os casos antes de qualquer acesso ao banco de dados. O versionamento otimista é uma segunda barreira de segurança para casos extremos, como expiração do TTL durante uma seção crítica longa. Essa estratégia de *defense in depth* é uma prática estabelecida em sistemas distribuídos de alta disponibilidade [Kleppmann 2017].

---

## Referências

ANTIREZ, S. **Distributed locks with Redis**. Redis Blog, 2016. Disponível em: https://redis.io/docs/manual/patterns/distributed-locks/

BERNSTEIN, P. A.; HADZILACOS, V.; GOODMAN, N. **Concurrency Control and Recovery in Database Systems**. Addison-Wesley, 1987.

DATE, C. J. **An Introduction to Database Systems**. 8. ed. Pearson, 2003.

GRAY, J.; REUTER, A. **Transaction Processing: Concepts and Techniques**. Morgan Kaufmann, 1992.

KLEPPMANN, M. **Designing Data-Intensive Applications**. O'Reilly Media, 2017.

NEWMAN, S. **Building Microservices**. O'Reilly Media, 2015.

OVENS H (BUN). **Bun — A fast all-in-one JavaScript runtime**. 2023. Disponível em: https://bun.sh

PIVOTAL SOFTWARE. **RabbitMQ — Messaging that just works**. 2007. Disponível em: https://www.rabbitmq.com

REESE, W. **Nginx: the High-Performance Web Server and Reverse Proxy**. Linux Journal, 2008.

RICHARDSON, C. **Microservices Patterns**. Manning Publications, 2018.

SALTYAOM. **ElysiaJS — Ergonomic Framework for Humans**. 2023. Disponível em: https://elysiajs.com

SANFILIPPO, S. **Redis — Remote Dictionary Server**. 2009. Disponível em: https://redis.io

TECHEMPOWER. **TechEmpower Framework Benchmarks**. 2024. Disponível em: https://www.techempower.com/benchmarks/
