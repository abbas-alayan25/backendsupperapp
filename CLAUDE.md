# CLAUDE.md

White-label, multi-tenant fintech super app backend. `docs/backend-spec.md` is the source of truth. `docs/roadmap.md` is the build order and status, `docs/questions.md` lists open questions, `docs/decisions.md` records answers. Build one milestone at a time, following `docs/claude-code-build-prompts.md`.

## Source of truth

- Use the spec's table names, columns, types, keys, endpoint paths, methods, auth levels, error codes, Kafka topics, socket events, gRPC RPC names, Temporal workflow names, BullMQ queue names and Redis key patterns exactly as written.
- Do not invent columns, endpoints, codes, events or topics, and do not rename them.
- If the spec is missing something, is ambiguous or contradicts itself, stop and ask. Do not guess. Add it to `docs/questions.md`, and record each answer in `docs/decisions.md`.

## Stack (spec §1)

| Concern                        | Choice                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Language                       | TypeScript on Node.js active LTS for every service                                                                               |
| Go                             | Only for `ledger-service` (posting) and `cards-service/cards-auth` (card authorization). Nowhere else                            |
| API framework                  | NestJS on the Fastify adapter                                                                                                    |
| Internal RPC                   | gRPC, protobuf in `libs/proto`, linted and breaking-checked with buf                                                             |
| Database                       | PostgreSQL with PostGIS, pgcrypto, pg_partman; PgBouncer in transaction mode                                                     |
| Data access                    | Prisma for CRUD services; Kysely for reporting and heavy queries; Go data access for the ledger is open (`docs/questions.md` Q4) |
| Migrations                     | Prisma Migrate (TS), golang-migrate (Go); expand-and-contract only                                                               |
| Cache, locks, rate limits, GEO | Redis (cluster mode)                                                                                                             |
| Events                         | Kafka + Schema Registry (Avro, backward compatible); Debezium publishes outboxes                                                 |
| Long money workflows           | Temporal                                                                                                                         |
| Short background jobs          | BullMQ on Redis                                                                                                                  |
| Realtime                       | Socket.IO on `realtime-gateway` with the Redis adapter                                                                           |
| Monorepo                       | Nx with pnpm                                                                                                                     |
| Tests                          | Vitest, `go test`, Testcontainers, fast-check / Go fuzzing, Pact, k6                                                             |
| Contracts                      | OpenAPI 3.1 for REST, AsyncAPI 3 for Kafka and sockets                                                                           |
| Search                         | OpenSearch                                                                                                                       |
| Analytics                      | ClickHouse, fed by Debezium CDC                                                                                                  |
| Object storage                 | S3-compatible with SSE-KMS (RustFS locally)                                                                                      |
| Secrets and keys               | HashiCorp Vault + cloud KMS                                                                                                      |
| API gateway                    | Kong                                                                                                                             |
| Staff identity                 | Keycloak (OIDC + TOTP); customers use auth-service                                                                               |

Do not add a framework, ORM, queue, broker or datastore that is not in this table.

## Repository layout (spec §2)

- `apps/<service>/` for each service; `libs/{common,auth,db,kafka,temporal,adapters,proto,contracts,testing}` for shared code.
- Each service owns exactly one Postgres schema and never reads another service's tables. Cross-service data goes through gRPC or Kafka.
- Every service listens on HTTP `3000`, gRPC `50051`, metrics `9464`.

## Multi-tenancy (non-negotiable)

- `tenant_id` is on every table, request, gRPC call (`tenant-id` metadata), Kafka message (key `tenantId:ownerId`), outbox event, Temporal workflow (search attribute), BullMQ job, cache key (`t:{tid}:...`), socket room (`t:{tid}:...`), log line and trace span.
- Row-level security is enabled on every tenant-scoped table with `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. The DB helper runs `SET LOCAL app.tenant_id` at the start of every transaction. No query runs outside a tenant-scoped transaction unless it is a documented global table.
- `tenant_id` is the first column of every composite index.
- No per-tenant code branches. Tenant differences come only from tenant profile config, feature flags and adapters resolved through `TenantService.ResolveAdapter`.
- Every service's integration tests prove RLS isolation between two tenants.

## Database conventions (spec §3)

- Standard columns: `id uuid` (UUIDv7, generated in the application), `tenant_id`, `created_at`, `updated_at` (trigger; omitted on append-only tables), `version` (optimistic locking on mutable tables).
- snake_case, plural table names; status columns are `text` + `CHECK` with the spec's values.
- `jsonb` only for configuration and provider payloads, never for filtered fields.
- PII is encrypted at the application layer into `*_enc bytea` with a `*_hash` column (HMAC-SHA256, per-tenant key). Never log PII; logs are PII-masked.
- Soft delete (`deleted_at`) only on master data; never on money tables.
- Every service schema has `outbox_events`, `idempotency_keys` and `inbox_events` exactly as in spec §3.
- Service DB roles get only `SELECT/INSERT/UPDATE` on their own schema; append-only tables deny `UPDATE/DELETE`.

## Money

- Store money as `amount_minor bigint` + `currency char(3)`. Never floats, never `numeric` for amounts in application code. Use `bigint` in TS and `int64` in Go.
- APIs expose money as `{ "amount": "10.00", "currency": "USD" }` (decimal string). Convert only in `libs/common` money helpers.
- The ledger is the only place balances exist or change. No other service stores or caches a balance. Balances are never served from cache.
- Every ledger entry is balanced per currency at write time, in one transaction with its postings, balance updates and outbox event.

## Idempotency and events

- `Idempotency-Key` (client UUID) is required on every POST that moves money or creates a resource. Replays return the stored response for 24 h, using `idempotency_keys` plus the `t:{tid}:idem:{key}` Redis lock.
- gRPC calls are retried only when idempotent or carrying an idempotency key. Temporal activities always pass idempotency keys.
- Events are published only through the transactional outbox (`outbox_events` written in the same transaction as the state change, relayed by Debezium). Never publish to Kafka directly from request handlers.
- Consumers are idempotent through `inbox_events`. Every topic has `.retry.1m`, `.retry.10m` and `.dlq`.

## API conventions (spec §9)

- Base paths, headers, auth levels, cursor pagination, error envelope and error codes exactly as spec §9.
- Maker-checker endpoints return `202 Accepted` with `{ "approvalRequestId" }`.
- `Accept-Language` localizes errors and content.

## Dependencies

- Use the latest stable version of every package at the time it is added. Pin exact versions (no `^` or `~`) and commit `pnpm-lock.yaml` and `go.sum`.

## Code style

- No code comments of any kind in source files. Code must explain itself through naming and structure.
- Strict TypeScript. No `any`.

## Milestone workflow

- One milestone per session, using its prompt from `docs/claude-code-build-prompts.md`. Start in plan mode and get the plan approved before writing code.
- When a milestone's tests pass, set its status in `docs/roadmap.md`, then commit as `milestone N: <name>`.
- Local toolchain: Node 24 (`/opt/homebrew/opt/node@24/bin` first on `PATH`), pnpm via Corepack, Go from Homebrew, Docker Desktop.

## Tests and definition of done

- Every feature ships with unit tests (Vitest / `go test`) and integration tests using Testcontainers against real Postgres, Redis, Kafka and Temporal as needed. No mocking of the database in integration tests.
- Integration tests cover repositories, RLS isolation between two tenants, outbox writes and Kafka consumers for the feature.
- Ledger changes also need property tests: random flows always balance and balances equal the sum of postings.
- A milestone or PR is not done until lint, type-check, unit and integration tests all pass locally and in CI, and `docs/roadmap.md` is updated. Report failures honestly; never skip or disable a test to get green.
