# White-Label Super App — Backend Engineering Spec

Sep 30, 2026 · @Abbas Alayan

This spec tells backend engineers exactly what to build: the chosen stack, every service, every database table with its columns, every endpoint, the socket events and the messaging topics. It complements the architecture document and uses the same white-label, multi-tenant model: every table, request, event and socket room is scoped by `tenant_id`.

## 1. Technology Stack

TypeScript on NestJS with PostgreSQL is the default for every service. Kafka carries events, Temporal runs long money workflows, Redis handles cache and sockets, and Go is reserved for the two latency-critical paths.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (Node.js active LTS) | One language across backend, admin web and tooling; large hiring pool |
| Hot paths | Go (latest stable) for ledger posting and card authorization | Predictable sub-10 ms latency and low GC pauses where card networks impose hard timeouts |
| API framework | NestJS on the Fastify adapter | Modular DI, guards, interceptors, OpenAPI generation, WebSocket and microservice support built in |
| Internal RPC | gRPC (protobuf, buf for schema lint and breaking-change checks) | Typed, fast service-to-service commands |
| Primary database | PostgreSQL (latest stable) with PostGIS, pgcrypto, pg\_partman | ACID for money, row-level security for tenancy, JSONB for config, geo for riders |
| Data access | Prisma for CRUD services; Kysely (typed SQL) for ledger, reporting and heavy queries | Productivity where it helps, full SQL control where correctness and speed matter |
| Connection pooling | PgBouncer (transaction mode) | Keeps Postgres connections bounded under many pods |
| Cache, locks, rate limits | Redis (or Valkey), cluster mode | Sub-ms reads, distributed locks, sliding-window limits, GEO for rider positions, Socket.IO adapter |
| Event streaming | Apache Kafka (managed, e.g. MSK or Confluent) + Schema Registry (Avro) | Durable, ordered, replayable domain events between services |
| Change data capture | Debezium | Outbox relay and warehouse feed without dual writes |
| Workflow orchestration | Temporal | Payment sagas, payouts, KYC reviews, disputes and card issuance with retries, timers and audit history |
| Background jobs | BullMQ on Redis | Short jobs: notifications, exports, webhooks delivery, scheduled tasks |
| Realtime | Socket.IO on a NestJS gateway service with the Redis adapter | Rooms, acks, reconnection and fallbacks; scales horizontally |
| Push, SMS, email | FCM (Android and iOS via APNs), SMS and email through tenant `MessagingAdapter`s | Tenant can bring local SMS providers |
| Search | OpenSearch | Admin search across users, transactions, merchants, logs |
| Analytics warehouse | ClickHouse, fed by Debezium CDC | Fast reports and dashboards without touching production |
| Object storage | S3-compatible with SSE-KMS | KYC documents, statements, exports, media |
| Secrets and keys | HashiCorp Vault + cloud KMS (HSM-backed for card and signing keys) | Per-tenant secret paths and keys |
| API gateway | Kong Gateway (or Envoy Gateway) | Tenant resolution, JWT validation, WAF plugins, rate limits, request logging |
| Identity | Custom auth service for customers (phone OTP, PIN, device binding, EdDSA JWTs); Keycloak for staff SSO/OIDC + TOTP | Customer auth needs fintech-specific flows; staff need enterprise SSO |
| Service mesh | Linkerd (or Istio) | mTLS between services, retries, traffic split for canaries |
| Runtime | Kubernetes (EKS or GKE), Helm, Terraform, Argo CD | Same deployment for shared and dedicated tenants |
| Monorepo | Nx with pnpm | Shared libraries, affected-only builds and tests |
| Observability | OpenTelemetry → Prometheus, Grafana, Loki, Tempo; Sentry for errors | One trace from app tap to ledger posting |
| Testing | Vitest, Testcontainers, Pact, k6 | Real Postgres/Kafka in integration tests, contract tests, load tests |
| API contracts | OpenAPI 3.1 + AsyncAPI 3 | Generated Dart (Flutter) and TypeScript (Next.js) clients; documented socket and Kafka events |

Use the latest stable version of every package at project start, pin exact versions in the lockfile, and upgrade through Renovate.

## 2. Service Map and Repository Structure

The platform is 20 deployable services. Each one owns exactly one Postgres schema, and none reads another service's tables. Inside the cluster every service listens on HTTP `3000`, gRPC `50051` and metrics `9464`.

| Service | Language | Owns schema | Exposes | Main responsibility |
| --- | --- | --- | --- | --- |
| auth-service | TS | `identity` | REST, gRPC | Registration, OTP, PIN, devices, sessions, JWT issuing, step-up |
| tenant-service | TS | `tenancy` | REST (console), gRPC | Tenant profiles, adapters registry, domains, deployments, app config per tenant |
| kyc-service | TS | `kyc` | REST, gRPC, Temporal worker | KYC/KYB applications, documents, provider checks, review cases, tiers |
| risk-service | TS | `risk` | gRPC, Kafka consumer | Real-time risk decisions, rules engine, AML alerts and cases, screening |
| ledger-service | Go | `ledger` | gRPC only | Accounts, journal entries, holds, balances, FX, reconciliation checks |
| wallet-service | TS | `wallet` | REST, gRPC | Wallets, limits and usage, beneficiaries, statements |
| payments-service | TS | `payments` | REST, gRPC, Temporal worker | P2P, requests, QR, top-ups, withdrawals, bill pay orchestration, fees |
| banking-service | TS | `banking` | gRPC, webhooks, Temporal worker | Bank adapters, linked accounts, transfers, statements, reconciliation |
| cards-service | TS + Go (auth path) | `cards` | REST, gRPC, webhooks | Card lifecycle, controls, JIT authorization, clearing, disputes, tokens |
| bills-service | TS | `bills` | REST, gRPC | Biller catalog, inquiry, payment via biller adapters |
| marketplace-service | TS | `marketplace` | REST, gRPC | Merchants, stores, catalog, carts, orders, promotions, commissions |
| delivery-service | TS | `delivery` | REST, gRPC, WS producer | Riders, dispatch, offers, tracking, earnings, COD |
| payouts-service | TS | `payouts` | gRPC, Temporal worker | Merchant and rider payout batches, reserves, statements |
| platform-service | TS | `platform` | REST, gRPC | Feature flags, SDUI screens, app versions, maintenance, content |
| notification-service | TS | `notify` | Kafka consumer, BullMQ | Push, SMS, email, in-app inbox, templates per tenant and language |
| realtime-gateway | TS | none (Redis) | Socket.IO | Authenticated sockets for apps, merchant, rider, admin |
| support-service | TS | `support` | REST | Tickets, messages, macros, escalations |
| reporting-service | TS | `reporting` + ClickHouse | REST, BullMQ | Regulatory and finance reports, scheduled exports |
| audit-service | TS | `audit` | Kafka consumer, REST (read) | Immutable admin audit log (WORM), approvals |
| file-service | TS | `files` | REST, gRPC | Pre-signed uploads, virus scan, file metadata, signed downloads |

The tenant admin portal and platform console are Next.js apps that call a thin **admin-bff** and **console-bff** (NestJS). These enforce staff auth, RBAC and maker-checker, then call services over gRPC.

### Monorepo layout

```text
super-app/
  apps/
    auth-service/          src/{modules,grpc,http,workers}, prisma/, test/
    tenant-service/
    kyc-service/
    risk-service/
    ledger-service/        Go module: cmd/, internal/{posting,holds,fx,recon}, migrations/
    wallet-service/
    payments-service/
    banking-service/
    cards-service/         + cards-auth/ (Go) for the authorization endpoint
    bills-service/
    marketplace-service/
    delivery-service/
    payouts-service/
    platform-service/
    notification-service/
    realtime-gateway/
    support-service/
    reporting-service/
    audit-service/
    file-service/
    admin-bff/
    console-bff/
    admin-web/             Next.js tenant admin portal
    console-web/           Next.js platform console
  libs/
    common/                errors, money, ids, pagination, tenant context
    auth/                  guards, JWT verify, step-up, RBAC decorators
    db/                    Prisma/Kysely helpers, RLS session setter, outbox
    kafka/                 producer, consumer, schema registry, idempotent handler
    temporal/              client, shared activities
    adapters/              bank/, card-issuer/, kyc/, acquirer/, biller/, messaging/ (interfaces + implementations + simulators)
    proto/                 gRPC .proto files (buf)
    contracts/             OpenAPI + AsyncAPI specs, generated clients
    testing/               Testcontainers fixtures, factories
  infra/
    terraform/             modules + one workspace per tenant deployment
    helm/                  charts + values/<tenant>.yaml
    argocd/
  tools/                   codegen, migration runner, seed data
```

## 3. Database Conventions

Every table follows the same rules, so the table lists in sections 4–8 show only each table's own columns.

### Standard columns (present on every table unless noted)

| Column | Type | Rule |
| --- | --- | --- |
| `id` | `uuid` | Primary key, UUIDv7 generated in the application |
| `tenant_id` | `uuid` | Not null, FK to `tenancy.tenants`; first column of every composite index |
| `created_at` | `timestamptz` | Default `now()` |
| `updated_at` | `timestamptz` | Set by trigger; omitted on append-only tables |
| `version` | `int` | Optimistic locking on mutable tables |

### Types and naming

- snake\_case tables and columns; plural table names; one Postgres schema per service.
- Money: `amount_minor bigint` + `currency char(3)`; never `numeric` floats in application code.
- Status fields: Postgres `text` with a `CHECK` constraint listing allowed values (easier to migrate than enums).
- Flexible data: `jsonb` only for configuration and provider payloads, never for fields you filter on.
- PII: encrypted at the application layer into `bytea` columns with a `_enc` suffix, plus a `_hash` column (HMAC-SHA256, per-tenant key) for exact-match lookup.
- Soft delete: `deleted_at timestamptz` only on master data (merchants, products, beneficiaries); never on money tables.

### Tenancy and security

- Row-level security is enabled on every table: `USING (tenant_id = current_setting('app.tenant_id')::uuid)`.
- The DB helper runs `SET LOCAL app.tenant_id` at the start of each transaction from the request context.
- Service roles get only `SELECT/INSERT/UPDATE` on their own schema; append-only tables (postings, audit) deny `UPDATE/DELETE`.

### Performance and lifecycle

- High-volume tables (`postings`, `journal_entries`, `payment_events`, `card_authorizations`, `rider_locations`, `audit_logs`, `notifications`) are range-partitioned by month with pg\_partman.
- Transactional outbox: each service has an `outbox_events` table written in the same transaction as its state change; Debezium publishes it to Kafka.
- Migrations: Prisma Migrate (TS services) and golang-migrate (ledger); expand-and-contract only, never destructive in one release.
- Read replicas serve admin lists and statements; the ledger primary serves posting and balance checks.

### Shared tables in every service schema

| Table | Columns |
| --- | --- |
| `outbox_events` | aggregate\_type text, aggregate\_id uuid, event\_type text, payload jsonb, headers jsonb, published\_at timestamptz |
| `idempotency_keys` | key text, request\_hash text, response\_code int, response\_body jsonb, locked\_until timestamptz, expires\_at timestamptz — unique (tenant\_id, key) |
| `inbox_events` | event\_id uuid, topic text, processed\_at timestamptz — unique (tenant\_id, event\_id) for idempotent consumers |

## 4. Tables — Tenancy, Identity, Admin

These tables define who the tenant is, who its users are and who its staff are. The standard columns from section 3 are omitted.

### Schema `tenancy` (tenant-service)

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `tenants` (no tenant\_id) | code text, legal\_name text, display\_name text, country char(2), status text (ONBOARDING, ACTIVE, SUSPENDED, OFFBOARDED), deployment\_model text (SHARED, DEDICATED), region text, current\_profile\_version int | unique(code) |
| `tenant_profiles` | profile\_version int, brand jsonb, market jsonb, compliance jsonb, products jsonb, fees\_ref text, status text (DRAFT, ACTIVE, ARCHIVED), approved\_by uuid, activated\_at timestamptz | unique(tenant\_id, profile\_version) |
| `tenant_adapters` | partner\_type text (BANK, CARD\_ISSUER, KYC, ACQUIRER, BILLER, SMS, EMAIL, PUSH), provider text, priority int, config jsonb, secret\_ref text, status text (ACTIVE, DISABLED) | unique(tenant\_id, partner\_type, provider) |
| `tenant_domains` | domain text, kind text (API, ADMIN, MERCHANT, WEB), tls\_status text | unique(domain) |
| `tenant_deployments` | environment text (STAGING, PROD), cluster text, region text, app\_version text, helm\_values\_ref text, status text, deployed\_at timestamptz | index(tenant\_id, environment) |
| `tenant_apps` | app\_type text (CONSUMER, MERCHANT, RIDER), platform text (IOS, ANDROID), bundle\_id text, store\_account\_ref text, min\_supported\_version text, latest\_version text | unique(tenant\_id, app\_type, platform) |
| `tenant_usage_daily` | usage\_date date, active\_users int, txn\_count int, txn\_volume\_minor bigint, currency char(3) | unique(tenant\_id, usage\_date, currency) |

### Schema `identity` (auth-service)

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `users` | user\_type text (CUSTOMER, MERCHANT\_STAFF, RIDER), phone\_enc bytea, phone\_hash text, email\_enc bytea, email\_hash text, first\_name text, last\_name text, dob\_enc bytea, locale text, status text (PENDING, ACTIVE, FROZEN, BLOCKED, CLOSED), kyc\_tier smallint, referral\_code text, last\_login\_at timestamptz | unique(tenant\_id, phone\_hash); unique(tenant\_id, referral\_code) |
| `credentials` | user\_id uuid, pin\_hash text (Argon2id), pin\_failed\_count smallint, pin\_locked\_until timestamptz, biometric\_enabled bool, password\_hash text (merchant web only) | unique(user\_id) |
| `devices` | user\_id uuid, device\_id text, platform text, model text, os\_version text, app\_version text, public\_key text (device binding), push\_token text, trusted bool, first\_seen\_at, last\_seen\_at, revoked\_at timestamptz | unique(tenant\_id, user\_id, device\_id) |
| `sessions` | user\_id uuid, device\_id text, refresh\_token\_hash text, ip inet, user\_agent text, expires\_at timestamptz, revoked\_at timestamptz | index(user\_id), unique(refresh\_token\_hash) |
| `otp_challenges` | phone\_hash text, purpose text (REGISTER, LOGIN, RESET\_PIN, NEW\_DEVICE, STEP\_UP), code\_hash text, channel text (SMS, WHATSAPP), attempts smallint, expires\_at, verified\_at timestamptz | index(tenant\_id, phone\_hash, purpose) |
| `login_events` (partitioned) | user\_id uuid, device\_id text, ip inet, geo\_country char(2), result text (SUCCESS, FAILED, BLOCKED), reason text | index(tenant\_id, user\_id, created\_at) |
| `user_addresses` | user\_id uuid, label text, line1\_enc bytea, line2\_enc bytea, city text, country char(2), location geography(Point), is\_default bool | index(user\_id) |
| `referrals` | referrer\_id uuid, referee\_id uuid, status text (PENDING, QUALIFIED, REWARDED), reward\_payment\_id uuid | unique(referee\_id) |

### Schemas `admin` and `audit` (admin-bff, audit-service)

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `admin_users` | scope text (PLATFORM, TENANT), tenant\_id nullable for PLATFORM, email text, name text, keycloak\_id text, status text (ACTIVE, DISABLED), last\_login\_at timestamptz | unique(scope, tenant\_id, email) |
| `permissions` (global) | code text (e.g. `kyc.case.approve`), module text, action text (VIEW, CREATE, EDIT, APPROVE, EXPORT, TOGGLE), description text | unique(code) |
| `roles` | name text, scope text, is\_system bool | unique(tenant\_id, name) |
| `role_permissions` | role\_id uuid, permission\_id uuid | pk(role\_id, permission\_id) |
| `admin_user_roles` | admin\_user\_id uuid, role\_id uuid | pk(admin\_user\_id, role\_id) |
| `approval_policies` | action\_type text, min\_approvers smallint, approver\_role\_id uuid, amount\_threshold\_minor bigint, currency char(3), enabled bool | unique(tenant\_id, action\_type) |
| `approval_requests` | action\_type text, target\_type text, target\_id uuid, payload jsonb, before jsonb, after jsonb, reason text, maker\_id uuid, status text (PENDING, APPROVED, REJECTED, EXPIRED, EXECUTED, FAILED), checker\_id uuid, decided\_at, expires\_at timestamptz, idempotency\_key text | index(tenant\_id, status, created\_at) |
| `audit_logs` (append-only, partitioned) | actor\_type text, actor\_id uuid, action text, target\_type text, target\_id uuid, before jsonb, after jsonb, reason text, ip inet, user\_agent text, request\_id text | index(tenant\_id, target\_type, target\_id), index(tenant\_id, actor\_id, created\_at) |
| `pii_reveal_logs` | admin\_user\_id uuid, subject\_type text, subject\_id uuid, field text, reason text | index(tenant\_id, subject\_id) |
| `api_keys` | owner\_type text (MERCHANT, TENANT), owner\_id uuid, key\_prefix text, key\_hash text, scopes text\[\], ip\_allowlist inet\[\], last\_used\_at, revoked\_at timestamptz | unique(key\_prefix) |

## 5. Tables — KYC, KYB, Risk and AML

KYC decides a user's tier, KYB decides whether a business can trade, and risk decides every transaction in real time. Velocity counters live in Redis; everything else is below.

### Schema `kyc` (kyc-service)

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `kyc_profiles` | user\_id uuid, current\_tier smallint, full\_name\_enc bytea, dob\_enc bytea, nationality char(2), id\_number\_hash text, address\_enc bytea, occupation text, source\_of\_funds text, pep bool, risk\_rating text (LOW, MEDIUM, HIGH), next\_review\_at timestamptz | unique(tenant\_id, user\_id); unique(tenant\_id, id\_number\_hash) |
| `kyc_applications` | user\_id uuid, target\_tier smallint, status text (DRAFT, SUBMITTED, IN\_PROGRESS, AUTO\_APPROVED, PENDING\_REVIEW, APPROVED, REJECTED, RESUBMIT\_REQUESTED), provider text, provider\_applicant\_id text, submitted\_at, decided\_at timestamptz, decision\_reason\_code text | index(tenant\_id, status, submitted\_at); index(user\_id) |
| `kyc_documents` | application\_id uuid, doc\_type text (NATIONAL\_ID, PASSPORT, DRIVING\_LICENCE, RESIDENCE\_PERMIT, PROOF\_OF\_ADDRESS, SELFIE, LIVENESS\_VIDEO), side text (FRONT, BACK), file\_id uuid, extracted jsonb, document\_number\_enc bytea, document\_number\_hash text, issuing\_country char(2), expiry\_date date, status text | index(application\_id) |
| `kyc_checks` | application\_id uuid, check\_type text (OCR, AUTHENTICITY, LIVENESS, FACE\_MATCH, SANCTIONS, PEP, ADVERSE\_MEDIA, ADDRESS), provider text, result text (PASS, FAIL, REVIEW), score numeric(5,2), raw\_file\_id uuid, completed\_at timestamptz | index(application\_id) |
| `kyc_cases` | application\_id uuid, flag\_reasons text\[\], priority smallint, assigned\_to uuid, sla\_due\_at timestamptz, status text (OPEN, IN\_REVIEW, AWAITING\_APPROVAL, CLOSED), decision text (APPROVE, REJECT, RESUBMIT), decision\_reason\_code text, notes text, approval\_request\_id uuid | index(tenant\_id, status, sla\_due\_at); index(assigned\_to) |
| `kyc_reason_codes` | code text, applies\_to text (REJECT, RESUBMIT, FLAG), label\_en text, label\_ar text, active bool | unique(tenant\_id, code) |
| `businesses` | owner\_user\_id uuid, legal\_name text, trade\_name text, registration\_number\_hash text, registration\_country char(2), legal\_form text, mcc char(4), website text, status text (DRAFT, SUBMITTED, PENDING\_REVIEW, APPROVED, REJECTED, SUSPENDED), risk\_rating text, approved\_at timestamptz | unique(tenant\_id, registration\_number\_hash) |
| `business_documents` | business\_id uuid, doc\_type text (REGISTRATION, TRADE\_LICENCE, ARTICLES, TAX\_CERTIFICATE, BANK\_LETTER), file\_id uuid, expiry\_date date, status text | index(business\_id) |
| `business_ubos` | business\_id uuid, user\_id uuid null, full\_name\_enc bytea, ownership\_pct numeric(5,2), is\_director bool, kyc\_application\_id uuid, screening\_status text | index(business\_id) |

### Schema `risk` (risk-service)

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `risk_rules` | code text, name text, stage text (ONBOARDING, LOGIN, PRE\_TXN, POST\_TXN), expression jsonb, action text (ALLOW, CHALLENGE, HOLD, BLOCK, ALERT), severity text, rule\_version int, status text (DRAFT, ACTIVE, DISABLED), approved\_by uuid | unique(tenant\_id, code, rule\_version) |
| `risk_decisions` (partitioned) | subject\_type text, subject\_id uuid, stage text, score smallint, decision text, matched\_rules text\[\], latency\_ms int, context jsonb | index(tenant\_id, subject\_id, created\_at) |
| `risk_scores` | entity\_type text (USER, MERCHANT, DEVICE), entity\_id text, score smallint, factors jsonb | unique(tenant\_id, entity\_type, entity\_id) |
| `aml_alerts` | rule\_code text, entity\_type text, entity\_id uuid, severity text, status text (NEW, TRIAGED, ESCALATED, CLOSED\_FALSE\_POSITIVE, CLOSED\_TO\_CASE), case\_id uuid, details jsonb, assigned\_to uuid | index(tenant\_id, status, severity) |
| `aml_cases` | title text, entity\_type text, entity\_id uuid, assigned\_to uuid, status text (OPEN, INVESTIGATING, PENDING\_DECISION, CLOSED), decision text (NO\_ACTION, FREEZE, EXIT, STR\_FILED), str\_reference text, closed\_at timestamptz | index(tenant\_id, status) |
| `aml_case_notes` | case\_id uuid, author\_id uuid, body text, file\_ids uuid\[\] | index(case\_id) |
| `sanctions_lists` (global) | source text (UN, OFAC, EU, UK, LOCAL), list\_version text, fetched\_at timestamptz, entries\_count int | unique(source, list\_version) |
| `sanctions_entries` (global) | list\_id uuid, name\_normalized text, aliases text\[\], dob date, nationality char(2), program text | GIN trigram index on name\_normalized |
| `screening_results` | subject\_type text, subject\_id uuid, entry\_id uuid, match\_score numeric(5,2), status text (POTENTIAL, CONFIRMED, FALSE\_POSITIVE), reviewed\_by uuid, reviewed\_at timestamptz | index(tenant\_id, status) |
| `blocklist_entries` | entry\_type text (PHONE\_HASH, EMAIL\_HASH, DEVICE\_ID, IBAN\_HASH, CARD\_BIN, IP, MERCHANT\_ID), value text, list text (BLOCK, ALLOW), reason text, expires\_at timestamptz | unique(tenant\_id, entry\_type, value) |

## 6. Tables — Ledger, Wallet, Payments, Bills

The ledger schema is the only place balances exist. Wallets and payments point to ledger accounts and journal entries; they never store balances of their own.

### Schema `ledger` (ledger-service, Go)

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `ledger_accounts` | code text, owner\_type text (USER, MERCHANT, RIDER, AGENT, SYSTEM), owner\_id uuid null, account\_type text (CUSTOMER\_WALLET, MERCHANT\_WALLET, RIDER\_WALLET, AGENT\_FLOAT, SAFEGUARDING, BANK\_CLEARING, CARD\_SETTLEMENT, FEE\_INCOME, COMMISSION\_INCOME, INTERCHANGE\_INCOME, FX\_POSITION, REWARDS\_EXPENSE, PAYOUT\_PAYABLE, BILLER\_PAYABLE, COD\_PAYABLE, SUSPENSE), currency char(3), normal\_balance text (DEBIT, CREDIT), allow\_negative bool, status text | unique(tenant\_id, owner\_type, owner\_id, account\_type, currency); unique(tenant\_id, code) |
| `journal_entries` (append-only, partitioned) | entry\_type text (P2P, TOPUP, WITHDRAWAL, BILL\_PAY, QR\_PAY, ORDER\_CAPTURE, CARD\_CAPTURE, FEE, REFUND, REVERSAL, ADJUSTMENT, PAYOUT, FX, COD), reference\_type text, reference\_id uuid, description text, idempotency\_key text, reverses\_entry\_id uuid, effective\_at timestamptz, posted\_by text, approval\_request\_id uuid | unique(tenant\_id, idempotency\_key); index(tenant\_id, reference\_type, reference\_id) |
| `postings` (append-only, partitioned) | entry\_id uuid, account\_id uuid, direction text (DEBIT, CREDIT), amount\_minor bigint CHECK > 0, currency char(3), balance\_after\_minor bigint | index(account\_id, created\_at); index(entry\_id) |
| `ledger_balances` | account\_id uuid, posted\_minor bigint, held\_minor bigint, available\_minor bigint (generated), last\_entry\_id uuid | pk(account\_id) |
| `holds` | account\_id uuid, amount\_minor bigint, currency char(3), reason\_type text (CARD\_AUTH, ORDER, WITHDRAWAL, PAYMENT), reference\_id uuid, status text (ACTIVE, CAPTURED, RELEASED, EXPIRED), expires\_at timestamptz, captured\_entry\_id uuid | index(account\_id, status); index(tenant\_id, status, expires\_at) |
| `fx_rates` | base char(3), quote char(3), rate numeric(18,8), margin\_bps int, source text, valid\_from, valid\_to timestamptz | index(tenant\_id, base, quote, valid\_from) |
| `recon_runs` | run\_type text (INTERNAL, BANK, CARD, SAFEGUARDING), run\_date date, status text, matched int, mismatches int, report\_file\_id uuid | unique(tenant\_id, run\_type, run\_date) |

The entry is balanced at write time: in one transaction the service locks the affected `ledger_balances` rows (ordered by account\_id to avoid deadlocks), inserts the entry and postings, checks that debits equal credits per currency, updates balances and writes the outbox event.

### Schema `wallet` (wallet-service)

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `wallets` | owner\_type text, owner\_id uuid, currency char(3), ledger\_account\_id uuid, status text (ACTIVE, FROZEN, CLOSED), is\_default bool, frozen\_reason text | unique(tenant\_id, owner\_type, owner\_id, currency) |
| `limit_rules` | scope text (TIER, SEGMENT, USER, MERCHANT), scope\_value text, service text (P2P, TOPUP, WITHDRAWAL, BILL, QR, CARD, CASH\_OUT, ALL), period text (PER\_TXN, DAILY, MONTHLY), max\_amount\_minor bigint, max\_count int, currency char(3), source text (PROFILE, OVERRIDE), approval\_request\_id uuid, valid\_to timestamptz | index(tenant\_id, scope, scope\_value, service) |
| `limit_usage` | wallet\_id uuid, service text, period text, period\_start date, amount\_minor bigint, txn\_count int | unique(wallet\_id, service, period, period\_start) |
| `beneficiaries` | user\_id uuid, type text (WALLET, BANK), counterparty\_user\_id uuid, bank\_account\_id uuid, nickname text, last\_used\_at, deleted\_at timestamptz | index(user\_id) |
| `statements` | wallet\_id uuid, period\_start date, period\_end date, file\_id uuid, status text | unique(wallet\_id, period\_start) |

### Schema `payments` (payments-service)

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `payments` | type text (P2P, REQUEST, QR\_MERCHANT, TOPUP\_CARD, TOPUP\_BANK, CASH\_IN, CASH\_OUT, WITHDRAWAL, BILL, ORDER, REFUND), status text (CREATED, RISK\_CHECK, PENDING\_USER, PENDING\_REVIEW, AUTHORIZED, PROCESSING, COMPLETED, FAILED, DECLINED, REVERSED, PARTIALLY\_REFUNDED, REFUNDED), payer\_wallet\_id uuid, payee\_wallet\_id uuid, amount\_minor bigint, currency char(3), fee\_minor bigint, fx\_rate numeric(18,8), payee\_amount\_minor bigint, payee\_currency char(3), rail text (INTERNAL, CARD, BANK, BILLER, AGENT), adapter text, external\_ref text, reference\_code text, note text, risk\_decision\_id uuid, hold\_id uuid, journal\_entry\_id uuid, failure\_code text, idempotency\_key text, device\_id text, completed\_at timestamptz | unique(tenant\_id, idempotency\_key); unique(tenant\_id, reference\_code); index(payer\_wallet\_id, created\_at); index(payee\_wallet\_id, created\_at); index(tenant\_id, status, created\_at) |
| `payment_events` (partitioned) | payment\_id uuid, from\_status text, to\_status text, event text, actor text, data jsonb | index(payment\_id, created\_at) |
| `payment_requests` | requester\_user\_id uuid, payer\_user\_id uuid, amount\_minor bigint, currency char(3), note text, status text (PENDING, PAID, DECLINED, EXPIRED, CANCELLED), payment\_id uuid, expires\_at timestamptz | index(payer\_user\_id, status) |
| `qr_codes` | owner\_type text (MERCHANT, USER), owner\_id uuid, store\_id uuid, kind text (STATIC, DYNAMIC), payload text (EMVCo), amount\_minor bigint null, currency char(3), status text, expires\_at timestamptz | unique(tenant\_id, payload) |
| `fee_rules` | service text, scope text (TIER, SEGMENT, MERCHANT, DEFAULT), scope\_value text, fixed\_minor bigint, percent\_bps int, min\_minor bigint, max\_minor bigint, currency char(3), payer text (SENDER, RECEIVER, MERCHANT), valid\_from, valid\_to timestamptz | index(tenant\_id, service, scope) |
| `funding_cards` | user\_id uuid, acquirer text, token text, brand text, last4 char(4), expiry\_month smallint, expiry\_year smallint, status text | index(user\_id) |
| `cash_agents` | business\_id uuid, name text, location geography(Point), float\_wallet\_id uuid, opening\_hours jsonb, status text | GIST(location) |
| `payment_disputes` | payment\_id uuid, raised\_by uuid, reason\_code text, description text, status text (OPEN, INVESTIGATING, RESOLVED\_REFUND, RESOLVED\_NO\_ACTION), resolution\_payment\_id uuid | index(tenant\_id, status) |

### Schema `bills` (bills-service)

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `billers` | category text (TELECOM, ELECTRICITY, WATER, INTERNET, GOVERNMENT, EDUCATION, OTHER), name\_en text, name\_ar text, logo\_file\_id uuid, adapter text, provider\_biller\_code text, inquiry\_supported bool, sort\_order int, status text | unique(tenant\_id, adapter, provider\_biller\_code) |
| `biller_fields` | biller\_id uuid, field\_key text, label\_en text, label\_ar text, input\_type text, regex text, required bool, sort\_order int | index(biller\_id) |
| `bill_payments` | payment\_id uuid, biller\_id uuid, account\_ref text, inquiry\_ref text, due\_amount\_minor bigint, paid\_amount\_minor bigint, currency char(3), status text, provider\_ref text, receipt jsonb | unique(payment\_id) |
| `saved_bills` | user\_id uuid, biller\_id uuid, account\_ref text, nickname text, remind\_day smallint | unique(user\_id, biller\_id, account\_ref) |

## 7. Tables — Banking and Cards

These tables record every movement across external rails and match it back to the ledger. Only processor tokens and last four digits of cards are stored, never full card numbers.

### Schema `banking` (banking-service)

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `bank_partners` | adapter text, bank\_name text, swift\_bic text, country char(2), capabilities text\[\] (PAYOUT, VIRTUAL\_ACCOUNT, NAME\_ENQUIRY, STATEMENT\_API, INSTANT), cutoff\_times jsonb, holiday\_calendar text, status text | unique(tenant\_id, adapter) |
| `internal_bank_accounts` | partner\_id uuid, purpose text (SAFEGUARDING, SETTLEMENT, FEES), iban\_enc bytea, account\_number\_enc bytea, currency char(3), ledger\_account\_id uuid, status text | unique(tenant\_id, partner\_id, purpose, currency) |
| `linked_bank_accounts` | owner\_type text (USER, MERCHANT, RIDER), owner\_id uuid, bank\_name text, iban\_enc bytea, iban\_hash text, account\_number\_enc bytea, holder\_name text, currency char(3), verification\_status text (PENDING, VERIFIED, FAILED), verification\_method text (NAME\_ENQUIRY, PENNY\_TEST, DOCUMENT), is\_default bool, cooling\_until timestamptz, deleted\_at timestamptz | unique(tenant\_id, owner\_id, iban\_hash) |
| `virtual_accounts` | owner\_type text, owner\_id uuid, partner\_id uuid, iban\_enc bytea, iban\_hash text, reference text, currency char(3), status text | unique(tenant\_id, iban\_hash); unique(tenant\_id, reference) |
| `bank_transfers` | direction text (INBOUND, OUTBOUND), payment\_id uuid, partner\_id uuid, linked\_account\_id uuid, virtual\_account\_id uuid, amount\_minor bigint, currency char(3), status text (CREATED, SUBMITTED, ACCEPTED, SETTLED, REJECTED, RETURNED, UNMATCHED), rail text (INSTANT, ACH, SWIFT, BOOK), rail\_ref text, batch\_id uuid, value\_date date, failure\_code text | unique(tenant\_id, partner\_id, rail\_ref); index(tenant\_id, status, created\_at) |
| `bank_file_batches` | partner\_id uuid, direction text (OUT, IN), file\_type text (PAIN001, PAIN002, CAMT053, MT940), file\_id uuid, records int, status text (CREATED, SENT, ACKED, FAILED, PROCESSED) | index(tenant\_id, partner\_id, created\_at) |
| `bank_statements` | partner\_id uuid, internal\_account\_id uuid, statement\_date date, opening\_minor bigint, closing\_minor bigint, currency char(3), file\_id uuid, status text | unique(internal\_account\_id, statement\_date) |
| `statement_lines` | statement\_id uuid, value\_date date, amount\_minor bigint, direction text (CREDIT, DEBIT), reference text, counterparty\_name text, counterparty\_iban\_hash text, match\_status text (UNMATCHED, MATCHED, SUSPENSE, IGNORED), matched\_transfer\_id uuid | index(statement\_id); index(tenant\_id, match\_status) |
| `recon_exceptions` | source text (BANK, CARD, INTERNAL), reference\_type text, reference\_id uuid, exception\_type text (UNMATCHED\_CREDIT, AMOUNT\_MISMATCH, MISSING\_IN\_BANK, MISSING\_IN\_LEDGER, DUPLICATE), amount\_minor bigint, currency char(3), status text (OPEN, RESOLVED), resolved\_by uuid, resolution text | index(tenant\_id, status, source) |

### Schema `cards` (cards-service)

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `card_programs` | issuer\_adapter text, name text, bin text, network text (VISA, MASTERCARD), form text (VIRTUAL, PHYSICAL), product text (PREPAID, DEBIT), currency char(3), design\_ref text, min\_kyc\_tier smallint, fees jsonb, status text | unique(tenant\_id, issuer\_adapter, bin, form) |
| `cards` | user\_id uuid, wallet\_id uuid, program\_id uuid, processor\_card\_token text, last4 char(4), expiry\_month smallint, expiry\_year smallint, cardholder\_name text, status text (REQUESTED, ISSUED, SHIPPED, ACTIVE, FROZEN, BLOCKED, EXPIRED, REPLACED, CLOSED), block\_reason text (LOST, STOLEN, FRAUD, DAMAGED, ADMIN), replaced\_by\_card\_id uuid, activated\_at timestamptz | unique(tenant\_id, processor\_card\_token); index(user\_id) |
| `card_controls` | card\_id uuid, ecommerce bool, atm bool, contactless bool, international bool, mcc\_blocklist text\[\], country\_allowlist text\[\], per\_txn\_limit\_minor bigint, daily\_limit\_minor bigint, monthly\_limit\_minor bigint | pk(card\_id) |
| `card_shipments` | card\_id uuid, address\_id uuid, carrier text, tracking\_number text, status text (PENDING, PRINTED, SHIPPED, DELIVERED, RETURNED), shipped\_at, delivered\_at timestamptz | index(card\_id) |
| `card_authorizations` (partitioned) | card\_id uuid, processor\_auth\_id text, auth\_type text (AUTH, INCREMENTAL, REVERSAL, PARTIAL\_REVERSAL, ADVICE, FORCE\_POST), amount\_minor bigint, currency char(3), billing\_amount\_minor bigint, billing\_currency char(3), mcc char(4), merchant\_name text, merchant\_city text, merchant\_country char(2), entry\_mode text, is\_ecommerce bool, three\_ds bool, decision text (APPROVED, DECLINED), decline\_code text, auth\_code text, stan text, rrn text, hold\_id uuid, risk\_decision\_id uuid, latency\_ms int | unique(tenant\_id, processor\_auth\_id, auth\_type); index(card\_id, created\_at) |
| `card_transactions` | card\_id uuid, authorization\_id uuid, clearing\_ref text, cleared\_amount\_minor bigint, currency char(3), fx\_rate numeric(18,8), fee\_minor bigint, journal\_entry\_id uuid, status text (PENDING, CLEARED, REVERSED, REFUNDED), cleared\_at timestamptz | unique(tenant\_id, clearing\_ref); index(card\_id, created\_at) |
| `card_disputes` | card\_transaction\_id uuid, reason\_code text, amount\_minor bigint, status text (DRAFT, SUBMITTED, PROVISIONAL\_CREDIT, WON, LOST, WITHDRAWN), processor\_dispute\_id text, provisional\_payment\_id uuid, deadline\_at timestamptz, evidence\_file\_ids uuid\[\] | index(tenant\_id, status, deadline\_at) |
| `card_tokens` | card\_id uuid, wallet\_provider text (APPLE\_PAY, GOOGLE\_PAY, SAMSUNG\_PAY), token\_ref text, device\_name text, status text (ACTIVE, SUSPENDED, DELETED) | unique(tenant\_id, token\_ref) |
| `card_settlements` | settlement\_date date, network text, currency char(3), gross\_minor bigint, interchange\_minor bigint, scheme\_fees\_minor bigint, net\_minor bigint, file\_id uuid, journal\_entry\_id uuid | unique(tenant\_id, settlement\_date, network, currency) |

## 8. Tables — Marketplace, Delivery, Payouts, Platform, Notifications, Support, Files, Reporting

These are the commerce and operations tables. Money still settles only through ledger entries, which these tables reference by `journal_entry_id` or `payment_id`.

### Schema `marketplace` (marketplace-service)

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `merchants` | business\_id uuid, owner\_user\_id uuid, display\_name text, category\_id uuid, commission\_bps int, settlement\_wallet\_id uuid, payout\_schedule text (DAILY, WEEKLY, ON\_DEMAND), reserve\_bps int, rating numeric(3,2), status text (PENDING, ACTIVE, SUSPENDED, CLOSED) | unique(tenant\_id, business\_id) |
| `merchant_staff` | merchant\_id uuid, user\_id uuid, role text (OWNER, MANAGER, CASHIER), store\_ids uuid\[\] | unique(merchant\_id, user\_id) |
| `stores` | merchant\_id uuid, name\_en text, name\_ar text, location geography(Point), address text, phone text, opening\_hours jsonb, delivery\_radius\_m int, min\_order\_minor bigint, prep\_time\_min smallint, is\_open bool, status text | GIST(location); index(merchant\_id) |
| `categories` | parent\_id uuid, name\_en text, name\_ar text, icon\_file\_id uuid, sort\_order int, status text | index(tenant\_id, parent\_id) |
| `products` | merchant\_id uuid, store\_id uuid, category\_id uuid, sku text, name\_en text, name\_ar text, description\_en text, description\_ar text, price\_minor bigint, compare\_at\_minor bigint, currency char(3), track\_stock bool, stock\_qty int, image\_file\_ids uuid\[\], status text (DRAFT, PENDING\_REVIEW, ACTIVE, REJECTED, ARCHIVED), deleted\_at timestamptz | unique(store\_id, sku); index(tenant\_id, category\_id, status) |
| `product_options` | product\_id uuid, group\_name text, name text, price\_delta\_minor bigint, required bool, sort\_order int | index(product\_id) |
| `carts` | user\_id uuid, store\_id uuid, items jsonb, expires\_at timestamptz | unique(user\_id, store\_id) |
| `orders` | order\_number text, user\_id uuid, store\_id uuid, merchant\_id uuid, status text (PLACED, ACCEPTED, PREPARING, READY, PICKED\_UP, DELIVERED, CANCELLED, REJECTED), fulfilment text (DELIVERY, PICKUP), subtotal\_minor, delivery\_fee\_minor, service\_fee\_minor, discount\_minor, total\_minor bigint, currency char(3), payment\_method text (WALLET, CARD, COD), payment\_id uuid, hold\_id uuid, delivery\_address\_id uuid, promotion\_id uuid, notes text, cancel\_reason text, placed\_at, delivered\_at timestamptz | unique(tenant\_id, order\_number); index(user\_id, created\_at); index(store\_id, status) |
| `order_items` | order\_id uuid, product\_id uuid, name\_snapshot text, quantity int, unit\_price\_minor bigint, options jsonb, total\_minor bigint | index(order\_id) |
| `order_events` | order\_id uuid, from\_status text, to\_status text, actor\_type text, actor\_id uuid | index(order\_id, created\_at) |
| `promotions` | code text, promo\_type text (PERCENT, FIXED, FREE\_DELIVERY, CASHBACK), value int, max\_discount\_minor bigint, min\_order\_minor bigint, funded\_by text (PLATFORM, MERCHANT), merchant\_id uuid, budget\_minor bigint, used\_minor bigint, per\_user\_limit int, target jsonb, starts\_at, ends\_at timestamptz, status text | unique(tenant\_id, code) |
| `promotion_redemptions` | promotion\_id uuid, user\_id uuid, order\_id uuid, payment\_id uuid, discount\_minor bigint | index(promotion\_id, user\_id) |
| `commissions` | order\_id uuid, merchant\_id uuid, gross\_minor bigint, commission\_minor bigint, rider\_share\_minor bigint, platform\_delivery\_minor bigint, journal\_entry\_id uuid | unique(order\_id) |
| `reviews` | order\_id uuid, user\_id uuid, target\_type text (STORE, RIDER), target\_id uuid, rating smallint, comment text, status text (VISIBLE, HIDDEN) | unique(order\_id, target\_type) |

### Schemas `delivery` and `payouts`

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `riders` | user\_id uuid, vehicle\_type text (BICYCLE, MOTORBIKE, CAR), vehicle\_plate text, licence\_expiry date, zone\_id uuid, wallet\_id uuid, rating numeric(3,2), availability text (OFFLINE, ONLINE, BUSY), status text (ONBOARDING, ACTIVE, SUSPENDED, OFFBOARDED) | unique(tenant\_id, user\_id) |
| `rider_documents` | rider\_id uuid, doc\_type text, file\_id uuid, expiry\_date date, status text | index(rider\_id) |
| `zones` | name text, area geography(Polygon), delivery\_fee\_rules jsonb, status text | GIST(area) |
| `deliveries` | order\_id uuid, rider\_id uuid, status text (PENDING\_ASSIGNMENT, OFFERED, ASSIGNED, AT\_PICKUP, PICKED\_UP, AT\_DROPOFF, DELIVERED, FAILED, CANCELLED), pickup\_location, dropoff\_location geography(Point), distance\_m int, eta\_at, assigned\_at, picked\_up\_at, delivered\_at timestamptz, proof\_file\_id uuid, cod\_amount\_minor bigint | unique(order\_id); index(rider\_id, status) |
| `delivery_offers` | delivery\_id uuid, rider\_id uuid, status text (SENT, ACCEPTED, REJECTED, EXPIRED), expires\_at timestamptz | index(delivery\_id); index(rider\_id, status) |
| `rider_locations` (partitioned, 90-day retention) | rider\_id uuid, location geography(Point), heading smallint, speed\_kmh smallint, accuracy\_m smallint, recorded\_at timestamptz | index(rider\_id, recorded\_at) |
| `rider_earnings` | rider\_id uuid, delivery\_id uuid, earning\_type text (DELIVERY\_FEE, TIP, BONUS, PENALTY), amount\_minor bigint, currency char(3), journal\_entry\_id uuid | index(rider\_id, created\_at) |
| `cod_collections` | rider\_id uuid, delivery\_id uuid, amount\_minor bigint, currency char(3), status text (COLLECTED, DEPOSITED, NETTED), deposit\_ref text | index(rider\_id, status) |
| `payout_batches` | owner\_type text (MERCHANT, RIDER), run\_at timestamptz, currency char(3), payout\_count int, total\_minor bigint, status text | index(tenant\_id, run\_at) |
| `payouts` | batch\_id uuid, owner\_type text, owner\_id uuid, wallet\_id uuid, linked\_bank\_account\_id uuid, amount\_minor bigint, reserve\_minor bigint, currency char(3), status text (PENDING, SENT, PAID, FAILED, RETURNED), bank\_transfer\_id uuid, statement\_file\_id uuid | index(tenant\_id, owner\_id, created\_at) |

### Schemas `platform`, `notify`, `support`, `files`, `reporting`

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `feature_flags` | flag\_key text, description text, enabled bool, kill\_switch bool, disabled\_message jsonb (per locale), updated\_by uuid | unique(tenant\_id, flag\_key) |
| `flag_targets` | flag\_id uuid, rule\_order smallint, conditions jsonb (country, platform, app version range, KYC tier, segment, user list), rollout\_pct smallint, starts\_at, ends\_at timestamptz, enabled bool | index(flag\_id, rule\_order) |
| `segments` | name text, definition jsonb, estimated\_size int, refreshed\_at timestamptz | unique(tenant\_id, name) |
| `sdui_screens` | screen\_key text (home, services, marketplace\_home, wallet), description text | unique(tenant\_id, screen\_key) |
| `sdui_versions` | screen\_id uuid, version int, schema\_version int, content jsonb, segment\_id uuid, status text (DRAFT, PENDING\_APPROVAL, SCHEDULED, PUBLISHED, ARCHIVED), publish\_at timestamptz, published\_by uuid, approval\_request\_id uuid | unique(screen\_id, version) |
| `app_versions` | app\_type text, platform text, version text, build int, force\_update bool, soft\_update bool, release\_notes jsonb | unique(tenant\_id, app\_type, platform, version) |
| `maintenance_windows` | scope text (ALL, SERVICE), service\_key text, message jsonb, starts\_at, ends\_at timestamptz | index(tenant\_id, starts\_at) |
| `translations` | namespace text, key text, locale text, value text | unique(tenant\_id, namespace, key, locale) |
| `notification_templates` | event\_type text, channel text (PUSH, SMS, EMAIL, IN\_APP), locale text, title text, body text, variables text\[\], template\_version int, active bool | unique(tenant\_id, event\_type, channel, locale, template\_version) |
| `notifications` (partitioned) | user\_id uuid, channel text, template\_id uuid, event\_id uuid, title text, body text, data jsonb, status text (QUEUED, SENT, DELIVERED, FAILED, READ), provider text, provider\_message\_id text, sent\_at, read\_at timestamptz | index(user\_id, created\_at); unique(tenant\_id, event\_id, channel) |
| `notification_preferences` | user\_id uuid, category text (TRANSACTIONS, SECURITY, MARKETING, ORDERS), channel text, enabled bool | unique(user\_id, category, channel) |
| `campaigns` | name text, segment\_id uuid, channel text, template\_id uuid, schedule\_at timestamptz, status text (DRAFT, PENDING\_APPROVAL, SCHEDULED, SENDING, SENT, CANCELLED), sent\_count int, approval\_request\_id uuid | index(tenant\_id, status) |
| `tickets` | ticket\_number text, requester\_type text, requester\_id uuid, category text, subject text, status text (OPEN, PENDING, ON\_HOLD, RESOLVED, CLOSED), priority text, assigned\_to uuid, linked\_payment\_id uuid, linked\_order\_id uuid, sla\_due\_at timestamptz | unique(tenant\_id, ticket\_number); index(tenant\_id, status, priority) |
| `ticket_messages` | ticket\_id uuid, author\_type text (CUSTOMER, AGENT, SYSTEM), author\_id uuid, body text, file\_ids uuid\[\], internal bool | index(ticket\_id, created\_at) |
| `support_macros` | name text, body\_en text, body\_ar text, category text | unique(tenant\_id, name) |
| `files` | owner\_type text, owner\_id uuid, purpose text (KYC, KYB, PRODUCT\_IMAGE, DELIVERY\_PROOF, EXPORT, STATEMENT, EVIDENCE, BRAND), bucket text, object\_key text, mime text, size\_bytes bigint, sha256 text, scan\_status text (PENDING, CLEAN, INFECTED), retention\_until date | unique(bucket, object\_key); index(tenant\_id, owner\_id) |
| `report_definitions` | code text, name text, format text (CSV, XLSX, PDF), query\_ref text, params\_schema jsonb, is\_regulatory bool | unique(tenant\_id, code) |
| `report_schedules` | definition\_id uuid, cron text, params jsonb, recipients jsonb, active bool | index(definition\_id) |
| `report_runs` | definition\_id uuid, params jsonb, status text (QUEUED, RUNNING, DONE, FAILED), file\_id uuid, requested\_by uuid, schedule\_id uuid, completed\_at timestamptz | index(tenant\_id, definition\_id, created\_at) |

## 9. API Conventions

All external APIs are REST/JSON over HTTPS through Kong. The gateway resolves the tenant, validates the token, applies rate limits and forwards to the owning service. Every endpoint in sections 10–12 follows these rules.

| Base path | Consumers | Auth |
| --- | --- | --- |
| `/mobile/v1` | Consumer app | User JWT (EdDSA, 10 min) + device binding |
| `/mobile/v1/merchant` | Merchant app | Merchant staff JWT |
| `/mobile/v1/rider` | Rider app | Rider JWT |
| `/merchant/v1` | Merchant servers (integrations) | API key + HMAC-SHA256 request signature |
| `/admin/v1` | Tenant admin portal (via admin-bff) | Keycloak OIDC session + TOTP, RBAC permission per endpoint |
| `/console/v1` | Platform console (via console-bff) | Keycloak OIDC (platform realm) + TOTP |
| `/webhooks/{partnerType}/{provider}` | Banks, processors, KYC, billers | Partner signature or mTLS |

### Headers

| Header | Required on | Purpose |
| --- | --- | --- |
| `Authorization: Bearer <jwt>` | All authenticated calls | Identity; the JWT carries `tid` (tenant), `sub`, `dev`, `typ` |
| `X-Device-Id` | Mobile | Must match the device bound to the token |
| `X-App-Version`, `X-Platform` | Mobile | Force-update checks, flag targeting |
| `Accept-Language` | All | `ar` or `en`; localizes errors and content |
| `Idempotency-Key` | Every POST that moves money or creates a resource | UUID from the client; replay returns the stored response for 24 h |
| `X-Step-Up-Token` | Endpoints marked Step-up | Short-lived token from PIN/biometric verification, bound to the request hash |
| `X-Request-Id` | Optional | Echoed back; used as trace correlation |
| `X-Signature`, `X-Timestamp`, `X-Key-Id` | Merchant API | HMAC over `method + path + timestamp + sha256(body)`; 5-minute skew |

### Responses

- Success: resource or `{ "data": [...], "nextCursor": "..." }` for lists; cursor pagination with `?limit=` (max 100) and `?cursor=`.
- Money in APIs: `{ "amount": "10.00", "currency": "USD" }` (decimal string).
- Time: ISO 8601 UTC.
- Errors: `{ "error": { "code", "message", "details", "requestId" } }` with stable codes: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `DUPLICATE_REQUEST`, `INSUFFICIENT_FUNDS`, `LIMIT_EXCEEDED`, `KYC_REQUIRED`, `STEP_UP_REQUIRED`, `RISK_DECLINED`, `RISK_REVIEW`, `ACCOUNT_FROZEN`, `SERVICE_DISABLED`, `UPDATE_REQUIRED`, `MAINTENANCE`, `RATE_LIMITED`, `PARTNER_UNAVAILABLE`.
- Maker-checker endpoints return `202 Accepted` with `{ "approvalRequestId" }` instead of applying the change.

### Auth legend used in the endpoint tables

| Code | Meaning |
| --- | --- |
| Public | No token (tenant still resolved from domain) |
| Reg | Registration/OTP token only |
| User | Consumer JWT |
| Step-up | User JWT + `X-Step-Up-Token` |
| Staff | Merchant staff JWT (role checked) |
| Rider | Rider JWT |
| Key | Merchant API key + signature |
| Admin:perm | Tenant staff with the named permission |
| MC | Maker-checker: returns 202 and needs approval |

## 10. Endpoints — Mobile Consumer API (`/mobile/v1`)

The consumer app needs 116 endpoints, grouped below by owning service. Paths are relative to `/mobile/v1`.

### App config and files (platform-service, file-service)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/app/config` | Public | Tenant brand, enabled services, flags, min/latest version, maintenance status |
| GET | `/app/screens/{screenKey}` | User | SDUI screen JSON for the user's segment (ETag) |
| GET | `/app/translations?ns=` | Public | Server-managed strings per locale |
| POST | `/files/upload-url` | User | Pre-signed upload URL + `fileId` for a given purpose |

### Auth and devices (auth-service)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/otp/request` | Public | Send OTP for REGISTER, LOGIN, NEW\_DEVICE or RESET\_PIN |
| POST | `/auth/otp/verify` | Public | Verify OTP; returns a registration token or login continuation |
| POST | `/auth/register` | Reg | Create user with name, PIN and device public key; returns tokens |
| POST | `/auth/login` | Public | Phone + PIN + device signature; returns tokens or requires OTP for new device |
| POST | `/auth/token/refresh` | Public | Rotate access and refresh tokens |
| POST | `/auth/logout` | User | Revoke the current session |
| POST | `/auth/step-up` | User | Verify PIN or biometric signature; returns a step-up token for one action |
| POST | `/auth/pin/change` | Step-up | Change PIN |
| POST | `/auth/pin/reset` | Reg | Reset PIN after OTP (with new-device cooling rules) |
| GET | `/devices` | User | List devices |
| DELETE | `/devices/{deviceId}` | Step-up | Revoke a device and its sessions |

### Profile (auth-service)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/me` | User | Profile, KYC tier, status, locale |
| PATCH | `/me` | User | Update editable profile fields |
| GET | `/me/addresses` | User | List addresses |
| POST | `/me/addresses` | User | Add address |
| PATCH | `/me/addresses/{id}` | User | Edit address |
| DELETE | `/me/addresses/{id}` | User | Remove address |
| GET | `/me/referrals` | User | Referral code and status of referees |
| POST | `/me/close` | Step-up | Request account closure (balance must be zero) |

### KYC (kyc-service)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/kyc/status` | User | Current tier, open application, required actions |
| GET | `/kyc/requirements?tier=` | User | Documents and checks needed for a tier (from tenant profile) |
| POST | `/kyc/applications` | User | Start an application for a target tier |
| POST | `/kyc/applications/{id}/documents` | User | Attach an uploaded file as a document (type, side) |
| POST | `/kyc/applications/{id}/liveness-session` | User | Provider SDK token for liveness and selfie |
| POST | `/kyc/applications/{id}/submit` | User | Submit for checks |

### Wallet and beneficiaries (wallet-service)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/wallets` | User | Wallets with posted and available balances |
| POST | `/wallets` | User | Open a wallet in another enabled currency |
| GET | `/wallets/{id}/transactions` | User | History with filters (type, date, status) |
| GET | `/transactions/{id}` | User | Transaction detail |
| GET | `/limits` | User | Limits and remaining usage per service |
| GET | `/statements` | User | Generated statements |
| POST | `/statements` | User | Generate a statement for a period (PDF) |
| GET | `/beneficiaries` | User | Saved recipients |
| POST | `/beneficiaries` | User | Save a wallet or bank recipient |
| DELETE | `/beneficiaries/{id}` | User | Remove recipient |
| POST | `/contacts/match` | User | Hashed phone numbers in, registered wallets out (for P2P picker) |

### Payments, top-up, cash (payments-service)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/payments/quote` | User | Fee, FX rate and total before confirming |
| POST | `/payments/p2p` | Step-up | Send money to a wallet |
| POST | `/payments/requests` | User | Request money |
| GET | `/payments/requests?role=payer` or `?role=requester` | User | List requests I must pay or I sent |
| POST | `/payments/requests/{id}/pay` | Step-up | Pay a request |
| POST | `/payments/requests/{id}/decline` | User | Decline a request |
| DELETE | `/payments/requests/{id}` | User | Cancel own request |
| GET | `/qr/me` | User | User's static receive QR |
| POST | `/payments/qr/parse` | User | Decode a QR into payee, amount and currency |
| POST | `/payments/qr/pay` | Step-up | Pay a merchant or user QR |
| GET | `/payments/{id}` | User | Payment status |
| GET | `/payments/{id}/receipt` | User | Receipt (JSON, PDF link) |
| POST | `/payments/{id}/disputes` | User | Raise a dispute on a wallet payment |
| GET | `/funding-cards` | User | Saved top-up cards |
| POST | `/funding-cards/session` | User | Acquirer tokenization session (card never touches backend) |
| DELETE | `/funding-cards/{id}` | User | Remove saved card |
| POST | `/topups/card` | Step-up | Top up by card; returns 3DS action if needed |
| GET | `/topups/bank-details` | User | Virtual IBAN or reference for bank top-up |
| GET | `/cash-agents?lat=&lng=` | User | Nearby cash-in/out agents |
| POST | `/cash-out/codes` | Step-up | One-time code for cash-out at an agent |

### Bank accounts and withdrawals (banking-service)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/bank-accounts` | User | Linked accounts |
| POST | `/bank-accounts` | Step-up | Link an account (name enquiry runs automatically) |
| DELETE | `/bank-accounts/{id}` | Step-up | Unlink |
| POST | `/withdrawals` | Step-up | Withdraw to a verified linked account |
| GET | `/withdrawals/{id}` | User | Withdrawal status |

### Bills (bills-service)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/billers/categories` | User | Categories |
| GET | `/billers?category=` | User | Billers |
| GET | `/billers/{id}` | User | Biller with input fields |
| POST | `/bills/inquiry` | User | Fetch due amount |
| POST | `/bills/pay` | Step-up | Pay a bill |
| GET | `/saved-bills` | User | Saved bills |
| POST | `/saved-bills` | User | Save a bill |
| DELETE | `/saved-bills/{id}` | User | Remove |

### Cards (cards-service)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/card-programs` | User | Card products available to this user |
| POST | `/cards` | Step-up | Request a virtual or physical card |
| GET | `/cards` | User | Cards |
| GET | `/cards/{id}` | User | Card detail (last4, status, controls) |
| POST | `/cards/{id}/activate` | Step-up | Activate a physical card |
| POST | `/cards/{id}/freeze` | User | Freeze |
| POST | `/cards/{id}/unfreeze` | Step-up | Unfreeze |
| POST | `/cards/{id}/block` | Step-up | Block as lost, stolen or damaged |
| POST | `/cards/{id}/replace` | Step-up | Replace a blocked or expired card |
| GET | `/cards/{id}/controls` | User | Controls |
| PATCH | `/cards/{id}/controls` | Step-up | Update e-com, ATM, contactless, international, limits |
| POST | `/cards/{id}/reveal-session` | Step-up | Token for processor secure display of PAN/CVV |
| POST | `/cards/{id}/pin-session` | Step-up | Token for processor PIN set/change SDK |
| POST | `/cards/{id}/provisioning` | Step-up | Apple Pay / Google Pay push-provisioning data |
| GET | `/cards/{id}/transactions` | User | Card transactions |
| POST | `/cards/{id}/disputes` | User | Raise a card dispute |
| GET | `/cards/{id}/disputes` | User | Dispute status |

### Marketplace (marketplace-service, delivery-service)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/marketplace/home` | User | SDUI marketplace home |
| GET | `/categories` | User | Categories tree |
| GET | `/stores?lat=&lng=&category=&q=` | User | Nearby stores |
| GET | `/stores/{id}` | User | Store detail |
| GET | `/stores/{id}/products` | User | Store catalog |
| GET | `/products/{id}` | User | Product with options |
| GET | `/search?q=` | User | Search stores and products |
| GET | `/carts/{storeId}` | User | Cart |
| PUT | `/carts/{storeId}` | User | Replace cart items |
| DELETE | `/carts/{storeId}` | User | Clear cart |
| POST | `/promotions/validate` | User | Validate a promo code against the cart |
| POST | `/orders` | Step-up | Checkout: create order, hold funds (or COD) |
| GET | `/orders` | User | Orders |
| GET | `/orders/{id}` | User | Order detail |
| POST | `/orders/{id}/cancel` | User | Cancel before acceptance |
| GET | `/orders/{id}/tracking` | User | Rider position and ETA snapshot (live updates by socket) |
| POST | `/orders/{id}/reviews` | User | Rate store and rider |

### Notifications and support (notification-service, support-service)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/notifications/token` | User | Register FCM token for the device |
| GET | `/notifications` | User | In-app inbox |
| POST | `/notifications/read` | User | Mark as read (ids or all) |
| GET | `/notification-preferences` | User | Preferences |
| PUT | `/notification-preferences` | User | Update preferences |
| GET | `/support/tickets` | User | Tickets |
| POST | `/support/tickets` | User | Open a ticket (optionally linked to payment or order) |
| GET | `/support/tickets/{id}` | User | Ticket with messages |
| POST | `/support/tickets/{id}/messages` | User | Reply |

## 11. Endpoints — Merchant and Rider APIs

Merchants use two surfaces: the merchant app for staff, and a signed server API for integrated merchants. Riders have their own app API; live location goes over the socket (section 14), with a REST fallback.

### Merchant app (`/mobile/v1/merchant`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/onboarding` | Staff | KYB progress and required items |
| POST | `/onboarding/business` | Staff | Submit business details and UBOs |
| POST | `/onboarding/documents` | Staff | Attach uploaded KYB documents |
| POST | `/onboarding/submit` | Staff | Submit KYB for review |
| GET | `/me` | Staff | Merchant profile, role, stores |
| GET | `/dashboard?storeId=&period=` | Staff | Sales, orders, average ticket |
| GET | `/balance` | Staff (Owner, Manager) | Settlement wallet balance |
| GET | `/transactions` | Staff | Payments received, refunds |
| GET | `/qr/static?storeId=` | Staff | Store static QR |
| POST | `/qr/dynamic` | Staff | Dynamic QR for an amount |
| POST | `/refunds` | Step-up (Owner, Manager) | Full or partial refund |
| GET | `/stores` | Staff | Stores |
| PATCH | `/stores/{id}` | Staff (Manager) | Hours, open/closed, prep time |
| GET | `/products?storeId=` | Staff | Catalog |
| POST | `/products` | Staff (Manager) | Create product (goes to moderation if required) |
| PATCH | `/products/{id}` | Staff (Manager) | Edit product |
| PATCH | `/products/{id}/stock` | Staff | Update stock or availability |
| DELETE | `/products/{id}` | Staff (Manager) | Archive product |
| GET | `/orders?status=` | Staff | Incoming and active orders |
| POST | `/orders/{id}/accept` | Staff | Accept with prep time |
| POST | `/orders/{id}/reject` | Staff | Reject with reason (releases hold) |
| POST | `/orders/{id}/ready` | Staff | Mark ready for pickup (triggers dispatch) |
| GET | `/staff` | Staff (Owner) | Staff list |
| POST | `/staff` | Step-up (Owner) | Invite staff with role and stores |
| DELETE | `/staff/{id}` | Step-up (Owner) | Remove staff |
| GET | `/payouts` | Staff (Owner) | Payout history |
| POST | `/payouts/instant` | Step-up (Owner) | On-demand payout (if enabled) |
| GET | `/reports/settlement?date=` | Staff (Owner, Manager) | Daily settlement report |

### Merchant server API (`/merchant/v1`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/payment-intents` | Key | Create a payment for checkout or dynamic QR |
| GET | `/payment-intents/{id}` | Key | Status |
| POST | `/payment-intents/{id}/cancel` | Key | Cancel an unpaid intent |
| POST | `/refunds` | Key | Refund a payment |
| GET | `/refunds/{id}` | Key | Refund status |
| GET | `/orders` | Key | Orders |
| GET | `/orders/{id}` | Key | Order |
| PATCH | `/orders/{id}/status` | Key | Accept, reject, ready |
| GET | `/products` | Key | Catalog |
| POST | `/products` | Key | Create product |
| PATCH | `/products/{id}` | Key | Update product |
| PATCH | `/products/{id}/stock` | Key | Stock sync |
| DELETE | `/products/{id}` | Key | Archive |
| GET | `/stores` | Key | Stores |
| PATCH | `/stores/{id}` | Key | Store status and hours |
| GET | `/balance` | Key | Balance |
| GET | `/transactions` | Key | Transactions |
| GET | `/payouts` | Key | Payouts |
| GET | `/reports/settlement?date=` | Key | Settlement report (CSV) |
| GET | `/webhook-endpoints` | Key | Webhook endpoints |
| POST | `/webhook-endpoints` | Key | Register an endpoint and event types |
| DELETE | `/webhook-endpoints/{id}` | Key | Remove endpoint |
| POST | `/webhook-endpoints/{id}/test` | Key | Send a test event |
| GET | `/events?since=` | Key | Replay missed events |

Outbound merchant webhook events: `payment_intent.succeeded`, `payment_intent.failed`, `refund.succeeded`, `refund.failed`, `order.placed`, `order.cancelled`, `payout.paid`, `payout.failed`. Each is signed with HMAC-SHA256, retried with backoff for 72 hours, and deduplicated by `eventId`.

### Rider app (`/mobile/v1/rider`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/onboarding` | User | Rider profile and vehicle |
| POST | `/documents` | Rider | Attach licence and vehicle documents |
| GET | `/me` | Rider | Status, zone, rating, today's stats |
| PATCH | `/availability` | Rider | Go online or offline |
| GET | `/offers` | Rider | Pending delivery offers |
| POST | `/offers/{id}/accept` | Rider | Accept offer |
| POST | `/offers/{id}/reject` | Rider | Reject offer |
| GET | `/deliveries/active` | Rider | Current delivery |
| GET | `/deliveries/{id}` | Rider | Delivery detail |
| POST | `/deliveries/{id}/arrived-pickup` | Rider | Arrived at store |
| POST | `/deliveries/{id}/picked-up` | Rider | Picked up |
| POST | `/deliveries/{id}/arrived-dropoff` | Rider | Arrived at customer |
| POST | `/deliveries/{id}/delivered` | Rider | Delivered with proof file and COD amount |
| POST | `/deliveries/{id}/failed` | Rider | Failed with reason |
| POST | `/location` | Rider | Batched location fallback when the socket is down |
| GET | `/earnings?period=` | Rider | Earnings and tips |
| GET | `/cod` | Rider | COD collected and owed |
| POST | `/cod/deposits` | Rider | Record a COD cash deposit |
| POST | `/withdrawals` | Step-up | Withdraw earnings to wallet or bank |

## 12. Endpoints — Tenant Admin API and Platform Console API

The admin-bff checks the listed permission on every call. Endpoints marked MC create an approval request and return `202` instead of applying the change.

### Tenant admin API (`/admin/v1`)

| Area | Method | Path | Permission | MC |
| --- | --- | --- | --- | --- |
| Session | GET | `/me` | any |  |
| Session | GET | `/search?q=` | any (results filtered by permission) |  |
| Dashboard | GET | `/dashboard/overview` | dashboard.view |  |
| Dashboard | GET | `/dashboard/timeseries?metric=&from=&to=` | dashboard.view |  |
| Users | GET | `/users` | users.view |  |
| Users | GET | `/users/{id}` | users.view |  |
| Users | GET | `/users/{id}/wallets`, `/users/{id}/ledger`, `/users/{id}/devices`, `/users/{id}/logins` | users.view |  |
| Users | POST | `/users/{id}/reveal` (field, reason) | users.pii.reveal |  |
| Users | GET, POST | `/users/{id}/notes` | users.edit |  |
| Users | POST | `/users/{id}/freeze`, `/users/{id}/unfreeze`, `/users/{id}/block` | users.status | MC |
| Users | POST | `/users/{id}/devices/{deviceId}/revoke` | users.edit |  |
| Users | POST | `/users/{id}/limits` (override) | limits.edit | MC |
| Wallets | POST | `/wallets/{id}/adjustments` | ledger.adjust | MC |
| KYC | GET | `/kyc/cases?status=&assignee=` | kyc.view |  |
| KYC | GET | `/kyc/cases/{id}` | kyc.view |  |
| KYC | GET | `/kyc/documents/{id}/url` | kyc.view (logged) |  |
| KYC | POST | `/kyc/cases/{id}/assign` | kyc.assign |  |
| KYC | POST | `/kyc/cases/{id}/decision` | kyc.decide | MC when flagged |
| KYC | GET, POST, PATCH | `/kyc/reason-codes` | kyc.config |  |
| KYB | GET | `/businesses`, `/businesses/{id}` | kyb.view |  |
| KYB | POST | `/businesses/{id}/decision` | kyb.decide | MC |
| Transactions | GET | `/transactions`, `/transactions/{id}` | txn.view |  |
| Transactions | POST | `/transactions/{id}/hold`, `/transactions/{id}/release` | txn.hold |  |
| Transactions | POST | `/transactions/{id}/reverse`, `/transactions/{id}/refund` | txn.reverse | MC |
| Transactions | GET | `/disputes` | txn.view |  |
| Transactions | POST | `/disputes/{id}/decision` | txn.dispute | MC above threshold |
| Compliance | GET | `/aml/alerts` | aml.view |  |
| Compliance | POST | `/aml/alerts/{id}/triage` | aml.triage |  |
| Compliance | GET, POST | `/aml/cases`, `/aml/cases/{id}` | aml.view, aml.case |  |
| Compliance | POST | `/aml/cases/{id}/notes` | aml.case |  |
| Compliance | POST | `/aml/cases/{id}/decision` | aml.decide | MC |
| Compliance | POST | `/aml/cases/{id}/str` | aml.str | MC |
| Compliance | GET, POST | `/risk/rules` | risk.view, risk.edit |  |
| Compliance | PATCH | `/risk/rules/{id}` | risk.edit |  |
| Compliance | POST | `/risk/rules/{id}/simulate` | risk.edit |  |
| Compliance | POST | `/risk/rules/{id}/activate`, `/risk/rules/{id}/disable` | risk.activate | MC |
| Compliance | GET, POST, DELETE | `/blocklists` | risk.blocklist |  |
| Compliance | GET | `/screening/results`, `/sanctions/status` | aml.view |  |
| Compliance | POST | `/screening/results/{id}/decision` | aml.decide |  |
| Cards | GET | `/cards`, `/cards/{id}`, `/card-authorizations` | cards.view |  |
| Cards | POST | `/cards/{id}/block` | cards.block |  |
| Cards | GET | `/card-disputes` | cards.view |  |
| Cards | POST | `/card-disputes/{id}/submit` | cards.dispute |  |
| Cards | GET, POST, PATCH | `/card-programs` | cards.config | MC |
| Finance | GET | `/treasury/positions` | finance.view |  |
| Finance | GET | `/bank-transfers` | finance.view |  |
| Finance | POST | `/bank-transfers/{id}/retry` | finance.ops |  |
| Finance | GET | `/recon/runs`, `/recon/exceptions`, `/statement-lines?matchStatus=` | finance.view |  |
| Finance | POST | `/statement-lines/{id}/match` | finance.recon |  |
| Finance | POST | `/recon/exceptions/{id}/resolve` | finance.recon | MC |
| Reports | GET | `/reports/definitions` | reports.view |  |
| Reports | POST | `/reports/runs` | reports.run |  |
| Reports | GET | `/reports/runs/{id}` | reports.view |  |
| Reports | GET, POST, DELETE | `/reports/schedules` | reports.schedule |  |
| Marketplace | GET, POST, PATCH | `/merchants`, `/merchants/{id}` | merchants.view, merchants.edit |  |
| Marketplace | PATCH | `/merchants/{id}/commercials` | merchants.commercials | MC |
| Marketplace | POST | `/merchants/{id}/suspend`, `/merchants/{id}/reactivate` | merchants.status | MC |
| Marketplace | GET, POST, PATCH, DELETE | `/categories` | catalog.edit |  |
| Marketplace | GET | `/products?status=PENDING_REVIEW` | catalog.view |  |
| Marketplace | POST | `/products/{id}/moderate` | catalog.moderate |  |
| Marketplace | GET | `/orders`, `/orders/{id}` | orders.view |  |
| Marketplace | POST | `/orders/{id}/cancel` | orders.cancel |  |
| Marketplace | GET, POST, PATCH | `/promotions` | promotions.edit | MC above budget limit |
| Riders | GET | `/riders`, `/riders/{id}` | riders.view |  |
| Riders | POST | `/riders/{id}/approve`, `/riders/{id}/suspend` | riders.status |  |
| Riders | GET | `/deliveries` | riders.view |  |
| Riders | POST | `/deliveries/{id}/reassign` | riders.dispatch |  |
| Riders | GET, POST, PATCH | `/zones` | riders.zones |  |
| Payouts | GET | `/payout-batches`, `/payouts` | payouts.view |  |
| Payouts | POST | `/payout-batches/{id}/hold`, `/payouts/{id}/retry` | payouts.ops | MC |
| Limits & fees | GET, POST, PATCH | `/limit-rules` | limits.edit | MC |
| Limits & fees | GET, POST, PATCH | `/fee-rules` | fees.edit | MC |
| App control | GET, POST, PATCH | `/flags` | app.flags |  |
| App control | POST | `/flags/{id}/toggle` | app.flags | MC for kill switches |
| App control | GET, POST | `/segments` | app.segments |  |
| App control | GET | `/screens` | app.sdui |  |
| App control | POST, PATCH | `/screens/{id}/versions`, `/screens/{id}/versions/{v}` | app.sdui |  |
| App control | POST | `/screens/{id}/versions/{v}/publish`, `/screens/{id}/rollback` | app.sdui.publish | MC |
| App control | GET, POST | `/app-versions`, `/maintenance-windows` | app.release | MC for force update |
| App control | GET, POST, PATCH | `/notification-templates` | app.content |  |
| App control | GET, POST, PATCH | `/campaigns` | app.campaigns |  |
| App control | POST | `/campaigns/{id}/schedule` | app.campaigns | MC |
| App control | GET, POST, PATCH | `/billers` | app.billers |  |
| Support | GET | `/tickets`, `/tickets/{id}` | support.view |  |
| Support | PATCH | `/tickets/{id}` (status, assignee, priority) | support.edit |  |
| Support | POST | `/tickets/{id}/messages` | support.reply |  |
| Support | GET, POST, PATCH | `/macros` | support.config |  |
| Admin | GET, POST, PATCH | `/admin-users` | admin.users |  |
| Admin | POST | `/admin-users/{id}/disable` | admin.users |  |
| Admin | GET, POST, PATCH | `/roles` | admin.roles | MC |
| Admin | GET | `/permissions` | admin.roles |  |
| Admin | GET | `/approvals`, `/approvals/{id}` | approvals.view |  |
| Admin | POST | `/approvals/{id}/approve`, `/approvals/{id}/reject` | approvals.decide (not the maker) |  |
| Admin | GET, PATCH | `/approval-policies` | admin.policies | MC |
| Admin | GET | `/audit-logs` | audit.view |  |
| Admin | GET, POST, DELETE | `/api-keys` | admin.integrations |  |
| Admin | GET, PATCH | `/settings` | admin.settings |  |

### Platform console API (`/console/v1`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET, POST | `/tenants` | List and create tenants |
| GET, PATCH | `/tenants/{id}` | Tenant detail and basic fields |
| POST | `/tenants/{id}/suspend`, `/tenants/{id}/reactivate` | Change tenant status |
| GET, POST | `/tenants/{id}/profiles` | Profile versions; create a draft |
| POST | `/tenants/{id}/profiles/{version}/activate` | Activate a profile version (maker-checker) |
| GET | `/adapters/catalog` | Available adapters and their config schema |
| GET, POST, PATCH, DELETE | `/tenants/{id}/adapters` | Assign adapters and secret references |
| POST | `/tenants/{id}/adapters/{adapterId}/test` | Connectivity test against the partner sandbox |
| GET, POST, DELETE | `/tenants/{id}/domains` | Domains and TLS status |
| GET, POST | `/tenants/{id}/apps` | App flavors per platform |
| POST | `/tenants/{id}/apps/{appId}/builds` | Trigger a white-label app build in CI |
| GET | `/tenants/{id}/deployments` | Deployments and versions |
| POST | `/tenants/{id}/deployments` | Deploy a version to an environment |
| POST | `/deployments/{id}/rollback` | Roll back a deployment |
| POST | `/tenants/{id}/admins` | Invite the tenant's first Super Admin |
| GET | `/health/tenants` | Cross-tenant health and SLOs |
| GET | `/usage?month=` | Usage per tenant for billing |
| GET, POST, PATCH | `/platform-admins` | Platform staff |
| GET | `/audit-logs` | Platform audit log |

## 13. Endpoints — Partner Webhooks and Internal gRPC

Partners call these webhooks; services call each other through the gRPC contracts below. Webhooks verify the signature (or mTLS) first and store the raw payload. Except for card authorization, they acknowledge within 200 ms and process asynchronously.

### Inbound partner webhooks

| Method | Path | Handler | Notes |
| --- | --- | --- | --- |
| POST | `/webhooks/card-issuer/{provider}/authorizations` | cards-auth (Go) | Synchronous approve/decline; p99 < 500 ms, hard budget 1.5 s; idempotent on processor auth ID |
| POST | `/webhooks/card-issuer/{provider}/events` | cards-service | Clearing, reversals, card status, token lifecycle, dispute updates |
| POST | `/webhooks/bank/{provider}` | banking-service | Inbound credits, payout results, returns, virtual account events |
| POST | `/webhooks/kyc/{provider}` | kyc-service | Check results, applicant status |
| POST | `/webhooks/acquirer/{provider}` | payments-service | Card top-up 3DS results, captures, refunds, chargebacks |
| POST | `/webhooks/biller/{provider}` | bills-service | Asynchronous bill payment status |
| POST | `/webhooks/messaging/{provider}` | notification-service | SMS and email delivery receipts |

The tenant is resolved from the webhook domain or a tenant-scoped path secret. Files that arrive by SFTP (bank statements, pain.002, card clearing and settlement files) are picked up by scheduled BullMQ jobs, not webhooks.

### Internal gRPC services

| Service | RPCs |
| --- | --- |
| `ledger.v1.LedgerService` | CreateAccount, PostEntry, ReverseEntry, CreateHold, CaptureHold, ReleaseHold, GetBalance, BatchGetBalances, ListPostings, GetEntry |
| `wallet.v1.WalletService` | GetWallet, GetWalletByOwner, ReserveLimit, CommitLimit, ReleaseLimit, SetWalletStatus |
| `risk.v1.RiskService` | Evaluate (stage, subject, amount, device, counterparty) → ALLOW, CHALLENGE, HOLD or BLOCK with matched rules |
| `auth.v1.AuthService` | GetUser, BatchGetUsers, VerifyStepUpToken, SetUserStatus, RevokeSessions |
| `kyc.v1.KycService` | GetTier, GetProfile, RequireTier |
| `tenant.v1.TenantService` | GetProfile, ResolveAdapter (partnerType), ResolveDomain, ListActiveTenants |
| `platform.v1.PlatformService` | EvaluateFlags (user context), IsServiceEnabled, GetScreen |
| `payments.v1.PaymentsService` | CreatePayment, GetPayment, RefundPayment, CapturePayment |
| `banking.v1.BankingService` | VerifyAccount, InitiatePayout, GetTransfer |
| `cards.v1.CardsService` | GetCard, BlockCard, GetAuthorization |
| `delivery.v1.DeliveryService` | CreateDelivery, CancelDelivery, GetDelivery |
| `files.v1.FileService` | CreateUploadUrl, GetDownloadUrl, GetFileMeta |

Every RPC carries `tenant-id`, `request-id` and `traceparent` metadata. Deadlines are set by the caller (default 2 s; ledger and risk 300 ms). Retries apply only to idempotent RPCs or those carrying an idempotency key.

## 14. Realtime — WebSocket Gateway

All live updates go through one realtime-gateway service running Socket.IO with the Redis adapter. Domain services never hold sockets. They publish Kafka events; the gateway consumes the relevant topics and emits them to rooms. Rider location is the one exception: it flows client → gateway → Redis → subscribers.

### Connection

- URL: `wss://<tenant api domain>/socket` with WebSocket-only transport (no long-polling, so no sticky sessions needed).
- Handshake: `auth: { token: <JWT> }`; the gateway verifies the token, tenant and device, then joins the socket to its rooms. Admin sockets use the admin-bff session token.
- Heartbeat every 25 s; on token expiry the server emits `session.expired` and the client reconnects with a fresh token.
- Events carry `eventId` and a resource `version`; after reconnecting, the client refetches over REST anything newer than the last version it saw. Sockets are a fast path, never the only source of truth.
- Limits: 5 sockets per user, rider location at most one message every 3 s, payloads under 4 KB.

### Namespaces and rooms

| Namespace | Who | Rooms joined |
| --- | --- | --- |
| `/app` | Consumers | `t:{tid}:user:{userId}`; `t:{tid}:order:{orderId}` on subscribe |
| `/merchant` | Merchant staff | `t:{tid}:merchant:{merchantId}`, `t:{tid}:store:{storeId}` for each allowed store |
| `/rider` | Riders | `t:{tid}:rider:{riderId}`, `t:{tid}:zone:{zoneId}` |
| `/admin` | Tenant staff | `t:{tid}:admin`, plus `t:{tid}:admin:{module}` for each module the staff member can view |

### Server → client events

| Namespace | Event | Payload | Source topic |
| --- | --- | --- | --- |
| `/app` | `wallet.balance_updated` | walletId, available, posted, currency, version | ledger.entries |
| `/app` | `payment.status_changed` | paymentId, status, amount, counterparty | payments.payments |
| `/app` | `payment_request.received` | requestId, from, amount, note | payments.requests |
| `/app` | `card.transaction` | cardId, amount, merchant, decision | cards.authorizations |
| `/app` | `order.status_changed` | orderId, status, eta | marketplace.orders |
| `/app` | `delivery.location` | orderId, lat, lng, heading, eta | Redis `rider:loc` channel |
| `/app` | `kyc.status_changed` | tier, status, requiredActions | kyc.applications |
| `/app` | `notification.new` | id, title, body, deeplink | notify.inbox |
| `/app` | `config.changed` | scope (flags, screen:{key}) | platform.config |
| `/app` | `session.revoked` | reason | identity.sessions |
| `/merchant` | `order.new`, `order.cancelled` | order summary | marketplace.orders |
| `/merchant` | `payment.received` | paymentId, amount, storeId, payer masked | payments.payments |
| `/merchant` | `rider.assigned`, `rider.arriving` | orderId, rider name, eta | delivery.deliveries |
| `/merchant` | `payout.status_changed` | payoutId, status, amount | payouts.payouts |
| `/rider` | `offer.new` | offerId, pickup, dropoff, fee, expiresAt | delivery.offers |
| `/rider` | `offer.expired`, `delivery.cancelled` | offerId or deliveryId | delivery.offers, delivery.deliveries |
| `/rider` | `order.ready` | deliveryId | marketplace.orders |
| `/admin` | `txn.feed` | masked transaction summary (sampled for high volume) | payments.payments |
| `/admin` | `kyc.case_created` | caseId, priority, slaDueAt | kyc.cases |
| `/admin` | `aml.alert_created` | alertId, severity, rule | risk.alerts |
| `/admin` | `approval.requested`, `approval.decided` | approvalId, actionType, maker | admin.approvals |
| `/admin` | `riders.positions` | riderId, lat, lng, status (per zone) | Redis `rider:loc` channel |
| `/admin` | `system.alert` | severity, message | ops.alerts |

### Client → server events

| Namespace | Event | Payload | Ack |
| --- | --- | --- | --- |
| `/app` | `order.subscribe`, `order.unsubscribe` | orderId (ownership checked) | ok or error |
| `/rider` | `rider.location` | lat, lng, heading, speed, accuracy, recordedAt | ok; the gateway writes Redis GEO, publishes `rider:loc`, and batches to Kafka `delivery.locations` |
| `/rider` | `rider.availability` | ONLINE or OFFLINE | new status |
| `/admin` | `zone.subscribe` | zoneId | ok |

## 15. Messaging — Kafka, Temporal, Job Queues, Notifications

Each kind of asynchronous work gets its own tool. Kafka carries facts that other services react to. Temporal runs multi-step money workflows that must survive crashes. BullMQ runs short background jobs. Everything is idempotent and keyed by tenant.

### Kafka topics

Cluster settings: replication 3, `min.insync.replicas` 2, producers with `acks=all` and idempotence on, Avro schemas in Schema Registry with backward compatibility. The message key is `tenantId:ownerId` for per-owner ordering. Each topic has a retry topic (`<topic>.retry.1m`, `<topic>.retry.10m`) and a dead-letter topic (`<topic>.dlq`) with alerting.

| Topic | Producer | Main consumers | Partitions | Retention |
| --- | --- | --- | --- | --- |
| `tenancy.tenants` | tenant-service | all services (cache invalidation) | 6 | 30 days, compacted |
| `identity.users`, `identity.sessions` | auth-service | risk, notification, realtime, reporting | 24 | 7 days |
| `kyc.applications`, `kyc.cases` | kyc-service | wallet (limits), cards, realtime, notification, audit | 24 | 7 days |
| `risk.decisions`, `risk.alerts` | risk-service | admin realtime, reporting | 24 | 7 days |
| `ledger.entries`, `ledger.holds` | ledger-service | realtime (balances), risk (post-txn), reporting, notification | 48 | 14 days |
| `payments.payments`, `payments.requests` | payments-service | risk, notification, realtime, loyalty, reporting | 48 | 14 days |
| `banking.transfers`, `banking.recon` | banking-service | payments, payouts, finance alerts, reporting | 24 | 14 days |
| `cards.cards`, `cards.authorizations`, `cards.transactions` | cards-service | risk, notification, realtime, reporting | 48 | 14 days |
| `bills.payments` | bills-service | notification, reporting | 12 | 7 days |
| `marketplace.orders`, `marketplace.products` | marketplace-service | payments, delivery, notification, realtime, search indexer | 24 | 7 days |
| `delivery.deliveries`, `delivery.offers` | delivery-service | marketplace, notification, realtime | 24 | 7 days |
| `delivery.locations` | realtime-gateway (batched) | delivery (history), reporting | 24 | 3 days |
| `payouts.payouts` | payouts-service | notification, realtime, reporting | 12 | 14 days |
| `platform.config` | platform-service | realtime (`config.changed`), gateway caches | 6 | 7 days |
| `admin.approvals`, `admin.actions` | admin-bff | audit-service, realtime, target services | 12 | 30 days |
| `notify.requests` | any service | notification-service | 24 | 3 days |
| `ops.alerts` | recon jobs, monitors | realtime `/admin`, on-call paging | 3 | 7 days |

### Temporal workflows

| Workflow | Owner | Steps |
| --- | --- | --- |
| `CardTopUpWorkflow` | payments | Create acquirer payment → wait for 3DS/webhook (timeout) → post ledger entry → notify |
| `BankWithdrawalWorkflow` | payments + banking | Hold → risk → payout via BankAdapter → poll or await webhook → capture or release → notify |
| `InboundCreditWorkflow` | banking | Match credit → post to wallet or suspense → notify or raise exception |
| `BillPaymentWorkflow` | bills | Hold → biller pay → await status → capture or release → receipt |
| `OrderPaymentWorkflow` | marketplace | Hold at checkout → await delivered or cancelled (days) → capture and split, or release |
| `PayoutBatchWorkflow` | payouts | Build batch → net reserves and disputes → bank payouts → reconcile → statements |
| `KycReviewWorkflow` | kyc | Provider checks → decision engine → manual case with SLA timer → tier change |
| `CardIssuanceWorkflow` | cards | Eligibility → CardIssuerAdapter create → physical shipment tracking → activation |
| `CardDisputeWorkflow` | cards | Submit → provisional credit → await outcome before scheme deadline → final posting |
| `ApprovalExecutionWorkflow` | admin-bff | Await checker decision (expiry) → execute the original call with its idempotency key |
| `TenantOnboardingWorkflow` | tenant-service | Create profile → provision infra → seed ledger accounts and roles → adapter tests → activate |

Workflows run in one Temporal namespace per deployment, carry `tenantId` as a search attribute, and call services only through activities that pass idempotency keys.

### BullMQ queues

| Queue | Type | Purpose |
| --- | --- | --- |
| `notify.push`, `notify.sms`, `notify.email` | On demand | Send through the tenant's MessagingAdapter with retries |
| `webhooks.merchant` | On demand | Deliver signed merchant webhooks with backoff for 72 h |
| `reports.run` | On demand + scheduled | Generate reports and exports to S3 |
| `statements.generate` | On demand + monthly | Wallet and merchant statements (PDF) |
| `files.scan` | On demand | Virus scan uploaded files before use |
| `sftp.ingest` | Repeatable (per bank, per processor) | Pull statements, pain.002 and clearing files |
| `recon.daily` | Repeatable (daily) | Internal, bank, card and safeguarding reconciliation |
| `holds.expire` | Repeatable (every 5 min) | Release expired holds |
| `sanctions.sync` | Repeatable (daily) | Refresh sanctions lists and re-screen |
| `segments.refresh` | Repeatable (hourly) | Recompute segment membership |
| `campaigns.send` | Scheduled | Fan out approved campaigns in batches |

### Notification pipeline

1. A service publishes a domain event (for example `payments.payments` with status COMPLETED) or an explicit `notify.requests` message.
2. notification-service maps the event type to the tenant's templates per channel and the user's locale.
3. It applies preferences and quiet hours; security and transaction messages ignore marketing opt-outs.
4. It writes a `notifications` row (deduplicated by event ID and channel) and enqueues the channel job.
5. The channel worker sends through the tenant's MessagingAdapter (FCM for push, the local SMS provider, email provider).
6. Delivery receipts update the row; in-app messages also emit `notification.new` on the socket.

OTP messages skip the queue: auth-service calls the MessagingAdapter directly, with provider failover, to keep delivery under a few seconds.

## 16. Caching, Observability, Testing and CI/CD

Balances are never served from cache. Everything else that is read-heavy and tenant-scoped is cached in Redis, and every release passes the same automated gates.

### Redis keys

| Key pattern | Content | TTL |
| --- | --- | --- |
| `t:{tid}:profile` | Tenant profile | 5 min + invalidated on `tenancy.tenants` |
| `t:{tid}:flags` | Compiled feature flags | 60 s + invalidated on `platform.config` |
| `t:{tid}:screen:{key}:{segment}` | Resolved SDUI JSON + ETag | 5 min + invalidated on publish |
| `t:{tid}:idem:{key}` | In-flight idempotency lock | 60 s |
| `t:{tid}:rl:{scope}:{id}` | Rate-limit sliding window | window length |
| `t:{tid}:vel:{userId}:{service}` | Risk velocity counters | 1 h / 24 h |
| `t:{tid}:otp:{phoneHash}` | OTP attempt counter | 15 min |
| `t:{tid}:riders:geo` | GEO set of online riders | live, removed when offline |
| `t:{tid}:stepup:{tokenId}` | One-time step-up token | 2 min |

### Observability

- OpenTelemetry SDK in every service; traces to Tempo, metrics to Prometheus, logs (JSON, PII-masked) to Loki; Grafana dashboards per service and per tenant.
- Every log line and span carries `tenant_id`, `request_id`, `user_id` (hashed) and `payment_id` when present.
- Business SLIs: payment success rate per flow and rail, card approval rate and auth latency, KYC auto-approval rate, OTP delivery time, recon exceptions, socket connections.
- Alerts: SLO burn rate, ledger imbalance (any non-zero is P1), DLQ growth, webhook backlog, partner error rate per adapter per tenant.

### Testing

| Level | Tooling | Required coverage |
| --- | --- | --- |
| Unit | Vitest (TS), `go test` (Go) | Domain logic, fee and limit calculation, state machines |
| Integration | Testcontainers (Postgres, Redis, Kafka, Temporal) | Repositories, RLS isolation between two tenants, outbox, consumers |
| Ledger properties | fast-check / Go fuzzing | Random flows always balance; balances equal the sum of postings |
| Contract | Pact (REST), buf breaking checks (gRPC), AsyncAPI schema checks | Every consumer–provider pair and every adapter |
| Adapter | Partner simulators | Timeouts, duplicates, out-of-order webhooks, partial failures |
| End to end | Playwright (admin web), Patrol or Maestro (Flutter) | Onboarding, P2P, top-up, card auth, order to delivery, maker-checker |
| Load | k6 | 3× forecast peak; card authorization p99 under 500 ms |
| Security | Semgrep, Trivy, OWASP ZAP, annual penetration test | No high findings at release |

### CI/CD

1. Pull request: lint, type-check, unit and integration tests for affected Nx projects, contract checks, SAST and dependency scan.
2. Merge to main: build signed container images (one per service), generate OpenAPI and AsyncAPI clients, publish to the registry.
3. Deploy to dev and staging automatically through Argo CD; run end-to-end and adapter simulator suites.
4. Release: tag a platform version; Argo CD rolls it out to tenant stacks in waves (internal → pilot tenants → all) with canary analysis and automatic rollback.
5. Mobile: Codemagic builds one flavor per tenant from the same commit and uploads to each tenant's store accounts.
