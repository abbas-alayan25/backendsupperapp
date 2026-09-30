# Decisions

This file is binding: where `docs/backend-spec.md` is ambiguous or silent, the decisions here apply. Open questions are in `docs/questions.md`.

- **Decided questions** (below the log): the owner's answers, one section per question.
- **Decision log** (table): smaller answers and build decisions, each with its date and source.

## Decision log

| ID              | Date       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Source                                   |
| --------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Q4 (partial)    | 2026-09-30 | Go projects are wired into Nx with `nx:run-commands` targets (no third-party Nx Go plugin). A root `go.work` lists every Go module. Shared Go code lives under `libs/go/`. The Go data layer for the ledger is still open.                                                                                                                                                                                                                                                          | M0/M1 plan, approved                     |
| Q5              | 2026-09-30 | `libs/common` is framework-free. NestJS/Fastify bootstrap, exception filter, tenant-context hook and telemetry live in a new `libs/nest`.                                                                                                                                                                                                                                                                                                                                           | Owner                                    |
| Q9              | 2026-09-30 | The gateway injects the resolved tenant in `X-Tenant-Id` (UUID). A missing or malformed header returns `403 FORBIDDEN` with `details.reason = TENANT_UNRESOLVED`. From M6, the JWT `tid` must equal it. Paths that need no tenant (health probes) are listed explicitly per service.                                                                                                                                                                                                | Owner                                    |
| Q10             | 2026-09-30 | HTTP status per error code: VALIDATION_FAILED 400, UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404, CONFLICT 409, DUPLICATE_REQUEST 409, INSUFFICIENT_FUNDS 422, LIMIT_EXCEEDED 422, KYC_REQUIRED 403, STEP_UP_REQUIRED 403, RISK_DECLINED 422, RISK_REVIEW 422, ACCOUNT_FROZEN 403, SERVICE_DISABLED 403, UPDATE_REQUIRED 426, MAINTENANCE 503, RATE_LIMITED 429, PARTNER_UNAVAILABLE 503. `Retry-After` is sent when the error carries a retry hint.                            | M0/M1 plan, approved                     |
| Q34             | 2026-09-30 | New gap: spec §9 has no code for unexpected server errors. Added `INTERNAL_ERROR` → 500. Its envelope never includes details, messages or stack traces.                                                                                                                                                                                                                                                                                                                             | M0/M1 plan, approved                     |
| Q11             | 2026-09-30 | PII `_enc` columns: AES-256-GCM with a per-tenant data key, AAD = `tenant_id`, blob = `[format u8 = 1][key version u32 BE][iv 12][ciphertext][tag 16]`. `_hash` columns: HMAC-SHA256 hex with a per-tenant HMAC key over a normalized value (E.164 phone, trimmed lower-case email). Keys come from a `PiiKeyProvider`; local and test use an HKDF-derived in-memory provider; the Vault/KMS provider is still to be built.                                                         | M0/M1 plan, approved                     |
| Pagination      | 2026-09-30 | Default `limit` is 20, max 100; out-of-range or non-integer values return `VALIDATION_FAILED`. Cursors are base64url JSON signed with HMAC-SHA256; `nextCursor` is `null` on the last page.                                                                                                                                                                                                                                                                                         | M0/M1 plan, approved                     |
| Locale          | 2026-09-30 | `Accept-Language` resolves to `ar` or `en` by q-value; unsupported values fall back to a caller-supplied default (tenant default later), otherwise `en`.                                                                                                                                                                                                                                                                                                                            | M0/M1 plan, approved                     |
| Logging         | 2026-09-30 | pino JSON logs with `tenant_id`, `request_id` and `user_id` hashed with HMAC-SHA256 (truncated to 32 hex chars). Known PII and secret fields are redacted.                                                                                                                                                                                                                                                                                                                          | M0/M1 plan, approved                     |
| TS version      | 2026-09-30 | TypeScript is pinned to 6.0.3, not 7.0.2 (latest). typescript-eslint 8.x supports only `typescript <6.1.0`, so 7.x would break linting. Renovate will propose 7.x once the lint toolchain supports it.                                                                                                                                                                                                                                                                              | Build finding                            |
| Node version    | 2026-09-30 | Services target Node 24 (active LTS). Vitest 5 does not support odd-numbered Node releases.                                                                                                                                                                                                                                                                                                                                                                                         | Build finding                            |
| Local S3        | 2026-09-30 | MinIO no longer publishes community container images, so local S3 uses RustFS 1.0.0 (S3-compatible, Apache-2.0). Services use the S3 API only, so the provider is swappable.                                                                                                                                                                                                                                                                                                        | Build finding                            |
| Local Postgres  | 2026-09-30 | The project image is the official multi-arch `postgres:18.6` plus pinned PGDG packages PostGIS 3.6.4 and pg_partman 5.5.0 (`postgis/postgis` publishes no arm64 images), with `wal_level=logical` for Debezium. It is published on host port 55432 so it doesn't clash with a local Postgres on 5432.                                                                                                                                                                               | Build finding                            |
| Nx targets      | 2026-09-30 | Every project declares explicit `nx:run-commands` targets (`build`, `typecheck`, `lint`, `test`, `test-integration`) instead of plugin-inferred targets, so TS, Go and proto projects behave the same way.                                                                                                                                                                                                                                                                          | Build finding                            |
| Local Kafka     | 2026-09-30 | Local compose uses `apache/kafka-native:4.3.1` (official Apache Kafka, GraalVM native build) instead of `apache/kafka:4.3.1`. The JVM image's local copy was damaged when the dev machine's disk filled, and Docker Desktop kept reusing the damaged layer. The native image has the same Kafka version, starts faster and has no CLI tools, so its healthcheck is a port check; Schema Registry and Kafka Connect health prove the broker works. Revisit for Testcontainers in M4. | Build finding                            |
| Local Temporal  | 2026-09-30 | The Temporal dev server stores its SQLite DB at `/home/temporal/temporal.db` on a named volume, because the image runs as uid 1000 and cannot write to a root-owned mount.                                                                                                                                                                                                                                                                                                          | Build finding                            |
| Q8              | 2026-09-30 | I draft request/response messages for every RPC in §13 in `libs/proto` (M2) and submit them with the milestone plan for review.                                                                                                                                                                                                                                                                                                                                                     | Owner (build prompts, Prompt 2)          |
| Q13 (partial)   | 2026-09-30 | tenant-service exposes REST for tenants, profiles, adapters, domains and apps; console-bff serves `/console/v1` by calling it.                                                                                                                                                                                                                                                                                                                                                      | Owner (build prompts, Prompts 3 and 21)  |
| Q14 (partial)   | 2026-09-30 | Access JWT 10 min (EdDSA); refresh tokens rotate, are device-bound, last 30 days and are stored hashed; step-up tokens are single use, last 2 min and are bound to the request hash; PIN is Argon2id with lockout.                                                                                                                                                                                                                                                                  | Owner (build prompts, Prompt 5)          |
| Q20             | 2026-09-30 | Infra provisioning in `TenantOnboardingWorkflow` and white-label app builds call hooks that are stubbed locally.                                                                                                                                                                                                                                                                                                                                                                    | Owner (build prompts, Prompt 21)         |
| Q24 (partial)   | 2026-09-30 | marketplace-service runs the OpenSearch indexer for `marketplace.products`; `/admin/v1/search` uses OpenSearch filtered by permission.                                                                                                                                                                                                                                                                                                                                              | Owner (build prompts, Prompts 16 and 20) |
| Milestone order | 2026-09-30 | `docs/roadmap.md` follows the 24 milestones in `docs/claude-code-build-prompts.md`. The NestJS exception filter lives in `libs/nest` (Q5) rather than `libs/common` as Prompt 2 words it.                                                                                                                                                                                                                                                                                           | Owner                                    |
| Service apps    | 2026-09-30 | M1 creates 21 TS apps (the 19 TS services in §2 plus `admin-bff` and `console-bff`) and 2 Go apps (`apps/ledger-service`, `apps/cards-service/cards-auth`). `admin-web` and `console-web` are front ends, not backend services, so they are not built. New services are stamped with `node tools/generators/service.mjs <name>`.                                                                                                                                                    | M1 plan, approved                        |
| Service runtime | 2026-09-30 | Every service serves `GET /health` (liveness) and `GET /ready` (readiness checks) on HTTP 3000 without a tenant header, the standard `grpc.health.v1` service on gRPC 50051, and Prometheus `/metrics` on 9464. `PORT`, `GRPC_PORT` and `METRICS_PORT` override them for local runs. `runService` owns SIGTERM/SIGINT handling, so Nest's `enableShutdownHooks` is not used (it re-raises the signal and exits non-zero).                                                           | M1 plan, approved                        |
| Local tracing   | 2026-09-30 | Tempo 3.1.0 receives OTLP on 4317/4318; Grafana 13.2.3 on host port 3300 has Tempo provisioned as its default datasource. The Tempo image is distroless, so it has no container healthcheck; `/ready` on port 3200 is checked from the host.                                                                                                                                                                                                                                        | M1 plan, approved                        |
| Go lint         | 2026-09-30 | golangci-lint v2.14.0 is pinned as a Go tool dependency in `tools/go/go.mod` and run with `go tool`. revive's `exported` and `package-comments` rules are disabled because they require doc comments, which the no-comments rule forbids.                                                                                                                                                                                                                                           | M1 plan, approved                        |
| Local ports     | 2026-09-30 | Host ports: Postgres 55432, PgBouncer 6432, Redis 6379, Kafka 9092, Schema Registry 8081, Kafka Connect 8083, Temporal 7233 (UI 8233), Keycloak 8080, S3 9000 (console 9001), OpenSearch 9200, ClickHouse 8123 (native 19000), Mailpit 1025 (UI 8025), Tempo 3200 (OTLP 4317/4318), Grafana 3300.                                                                                                                                                                                   | M1 plan, approved                        |

## Decided questions

### Q1 — Tables without `tenant_id` and cross-tenant jobs — DECIDED

Decided 2026-09-30 by the owner.

- **Global tables** have no `tenant_id` and no RLS: `tenancy.tenants`, `admin.permissions`, `risk.sanctions_lists`, `risk.sanctions_entries`. Service roles have `SELECT` only; writes come only from the owning service's migration or sync role.
- **`admin.admin_users`:** `tenant_id` is `NULL` when `scope = 'PLATFORM'`. Policy: `tenant_id = current tenant OR (scope = 'PLATFORM' AND current_setting('app.scope', true) = 'platform')`.
- **Every other table:** `ENABLE` and `FORCE ROW LEVEL SECURITY`. Service DB roles never own tables. The policy uses `current_setting('app.tenant_id', true)`; if it is not set, no rows are visible (fail closed).
- **Cross-tenant jobs** (`recon.daily`, `holds.expire`, sanctions re-screening, payout batches, usage aggregation) never bypass RLS. They call `TenantService.ListActiveTenants` and process one tenant per transaction with `SET LOCAL app.tenant_id`.
- **`BYPASSRLS`** is allowed only for three process types, each with its own role: the migration runner, Debezium CDC, and the outbox relay when it is not Debezium. Request-serving code never gets this role.
- **Test:** a test fails if any service's runtime role has `BYPASSRLS`.
- **Follow-ups:** Q39 (cross-schema `tenant_id` FK), Q41 (writes to global tables at runtime), Q42 (other PLATFORM-scoped admin rows).

### Q2 — Unique keys on monthly-partitioned tables — DECIDED

Decided 2026-09-30 by the owner.

- **Partitioned tables** use `PRIMARY KEY (id, created_at)` and are range-partitioned by `created_at` monthly.
- **Uniqueness across all time** lives in a small non-partitioned key table, inserted in the same transaction as the main row:

  | Key table                  | Primary key                                 | Points to          | Retention |
  | -------------------------- | ------------------------------------------- | ------------------ | --------- |
  | `ledger.entry_keys`        | `(tenant_id, idempotency_key)`              | `entry_id`         | permanent |
  | `cards.authorization_keys` | `(tenant_id, processor_auth_id, auth_type)` | `authorization_id` | 13 months |
  | `notify.notification_keys` | `(tenant_id, event_id, channel)`            | `notification_id`  | 90 days   |

- **No global uniqueness needed:** `identity.login_events`, `risk.risk_decisions`, `payment_events`, `rider_locations`, `audit_logs`.
- **`idempotency_keys`, `outbox_events` and `inbox_events` are not partitioned.** A daily job purges them by `expires_at`, `published_at` and `processed_at` respectively.
- **Helper:** `libs/db` provides `insertWithKey(keyTable, keyColumns, mainInsert)`, which returns the existing row on a key conflict.
- **Follow-up:** Q40 (tables that declare their own PK).

### Q7 — Outbox routing to Kafka — DECIDED

Decided 2026-09-30 by the owner.

- **Columns:** `outbox_events` gains `topic text NOT NULL` and `message_key text NOT NULL`. The writer sets both; nothing is inferred at relay time.
- **Topic:** must be one of the topics in spec §15, validated against a constant list in `libs/kafka`.
- **Key:** `message_key = "<tenantId>:<ownerId>"`, where `ownerId` is the user, merchant, rider or aggregate owner that needs ordering.
- **Relay:** Debezium Outbox Event Router, routing by `topic` with the key from `message_key`.
  - Value = the envelope: `eventId` = outbox `id`, `tenantId`, `type` = `event_type`, `version`, `occurredAt`, `producer`, `traceId`, `subject {type: aggregate_type, id: aggregate_id}`, `data` = `payload`.
  - Kafka headers: `eventId`, `tenantId`, `type`, `traceparent`.
- **Local dev and tests without Debezium:** a polling relay in `libs/kafka` with the same behaviour (`FOR UPDATE SKIP LOCKED`, batch of 500, sets `published_at`).
- **Follow-ups:** Q43 (source of `version`, `producer`, `traceId`), Q44 (Avro through the Debezium relay).

### Q12 — Idempotency — DECIDED

Decided 2026-09-30 by the owner.

- **Required** (`VALIDATION_FAILED` if missing) on every POST that moves money or holds funds: payments, top-ups, withdrawals, bill pay, cash-out codes, orders, refunds, payouts, card requests, ledger adjustments, and every maker-checker execution.
- **Optional but honoured** on all other POSTs. Not used on GET, PUT, PATCH or DELETE.
- **Scope:** `(tenant_id, key)` is unique, and the actor (user id, API key id or admin id) is stored with it. The same key from a different actor → `409 CONFLICT`.
- **Same key, same request hash:** replay the stored status code and body, with header `Idempotent-Replayed: true`.
- **Same key, different request hash:** `409 DUPLICATE_REQUEST`.
- **Same key while the first request is in flight:** `409 CONFLICT` with `Retry-After: 1`, using the Redis lock `t:{tid}:idem:{key}` (60 s).
- **What is stored:** responses for 2xx and 4xx business errors. 5xx responses and timeouts are not stored; the lock is released so the client can retry safely.
- **Retention:** 24 hours for API idempotency keys. The ledger keeps its own permanent `entry_keys` (Q2), so internal retries stay safe forever.
- **Follow-ups:** Q45 (gRPC metadata key), Q46 (actor columns on `idempotency_keys`).

### Q35 — Architecture document — DECIDED (file pending)

Decided 2026-09-30 by the owner.

- The architecture document lives at `docs/architecture.md`.
- For implementation details, `docs/backend-spec.md` wins when the two differ.
- Conflicts between them go into `docs/questions.md` instead of being guessed.
- **Status:** `docs/architecture.md` is not in the repository yet (checked 2026-09-30), so the conflict review has not been done. See Q35 in `docs/questions.md`.

### Q38 — Event naming — DECIDED

Decided 2026-09-30 by the owner.

- **Topics:** `<domain>.<entity_plural>`, exactly as spec §15 (e.g. `payments.payments`, `cards.authorizations`).
- **Event types:** `<aggregate>.<past_tense_verb>` in snake_case, with a singular aggregate. Owner's examples:
  - identity and KYC: `user.registered`, `user.frozen`, `session.revoked`, `kyc_application.submitted`, `kyc_application.approved`, `kyc_tier.changed`
  - payments and ledger: `payment.created`, `payment.completed`, `payment.failed`, `payment.reversed`, `payment.refunded`, `hold.created`, `hold.captured`, `hold.released`, `ledger_entry.posted`
  - cards: `card.issued`, `card.status_changed`, `card_authorization.decided`, `card_transaction.cleared`
  - commerce and payouts: `order.placed`, `order.accepted`, `order.delivered`, `order.cancelled`, `delivery.assigned`, `delivery.completed`, `payout.paid`
  - platform and admin: `flag.changed`, `screen.published`, `approval.requested`, `approval.decided`
  - tenancy: `tenant.created`, `tenant.profile_changed`, `tenant.adapter_changed`
- **Topics carry several event types.** Avro schemas are registered with `TopicRecordNameStrategy`, one record per event type, backward compatible. The envelope field `version` is the schema version of that event type.
- **Catalogue:** `docs/events.md` lists every topic with its event types, producer, consumers and key. It is a draft for the owner's review; M2 code does not use it until it is approved.

## Delegated decisions

On 2026-09-30 the owner delegated the remaining M2 follow-ups ("do the best from your side and go ahead"). These are Claude's decisions under that delegation. They are binding until the owner overrides one.

### Q39 — Cross-schema `tenant_id` FK — DECIDED (delegated)

- `tenant_id` is a **logical** reference to `tenancy.tenants`, not a database FK. Services validate tenants through `TenantService`, which keeps every service schema independently deployable.
- A shared deployment runs one Postgres cluster with one schema per service. A DEDICATED tenant runs its own full stack with its own cluster.

### Q40 — Tables with their own primary key — DECIDED (delegated)

- `ledger_balances`, `role_permissions`, `admin_user_roles` and `card_controls` keep the primary key the spec declares and get **no** `id` column.
- They still get `tenant_id`, `created_at`, `updated_at`, `version` where mutable, and RLS.

### Q41 — Runtime writes to global tables — DECIDED (delegated)

- To honour Q1 ("service roles have SELECT only; writes only by the owning service's migration or sync role"), each owning service gets a separate **sync** DB role that is the only role with `INSERT/UPDATE` on its global tables:
  - `tenancy_sync` for `tenancy.tenants`
  - `risk_sync` for the sanctions tables
  - `admin.permissions` is written only by migrations
- The service's runtime role keeps `SELECT` only on global tables.
- The sync role has no `BYPASSRLS`: global tables have no RLS, so it doesn't need it.
- `libs/db` supports opening a second, separately credentialed pool for the sync role, used only by the code paths that write global tables.

### Q42 — PLATFORM-scoped rows in admin tables — DECIDED (delegated)

- `roles`, `role_permissions`, `admin_user_roles`, `approval_requests` and `audit_logs` use the same policy as `admin_users`: `tenant_id = current tenant OR (tenant_id IS NULL AND current_setting('app.scope', true) = 'platform')`.

### Q43 — Envelope `version`, `producer`, `traceId` — DECIDED (delegated)

- `outbox_events` gains `event_version int NOT NULL` and `producer text NOT NULL`.
- `traceId` and `traceparent` are taken from `headers` (`headers.traceparent`), which the writer fills from the active trace context.
- The relay builds the envelope (Q44).

### Q44 — Avro through the outbox relay — DECIDED (delegated)

- The `libs/kafka` **polling relay is the production outbox relay.** It validates and serializes each event against its registered Avro schema (`TopicRecordNameStrategy`), produces with the Q7 key and headers, and sets `published_at`.
- It runs as its own process per service under a dedicated relay role with `BYPASSRLS`, as Q1 allows.
- Debezium is used only for CDC into ClickHouse (spec §1), not as the outbox relay.

### Q45 — gRPC idempotency metadata — DECIDED (delegated)

- The idempotency key travels in gRPC metadata as `idempotency-key`, next to `tenant-id`, `request-id` and `traceparent`.

### Q46 — Actor on `idempotency_keys` — DECIDED (delegated)

- `idempotency_keys` gains `actor_type text CHECK (actor_type IN ('USER','API_KEY','ADMIN','SERVICE'))` and `actor_id text NOT NULL`.
- Internal callers use `SERVICE` plus the service name.

### Q47 — `notify.inbox` topic — DECIDED (delegated)

- `notify.inbox` is added to the topic list: producer notification-service, consumer realtime-gateway, 24 partitions, 3 days.

### Q48 — `delivery.locations` without an outbox — DECIDED (delegated)

- realtime-gateway owns no schema, so it produces `delivery.locations` directly with an idempotent producer (`acks=all`, batched).
- This is the only topic exempt from the outbox rule.

### Q49 — KYB decisions — DECIDED (delegated)

- `business.submitted`, `business.approved`, `business.rejected` and `business.suspended` are published on `kyc.applications`, keyed `<tenantId>:<businessId>`.
- marketplace-service consumes them.

### Step-up request hash (part of Q16) — DECIDED (delegated)

- The step-up token is bound to `sha256_hex(METHOD + "\n" + PATH + "\n" + sha256_hex(raw body))`, where PATH includes the query string.
- The client computes the same value when requesting the token. `libs/auth` implements this.

### Event catalogue — APPROVED (delegated)

- `docs/events.md` is approved as drafted, including the _(proposed)_ event types.
- New event types are added there first, in the same convention, before code emits them.
