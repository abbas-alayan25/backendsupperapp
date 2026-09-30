# Open Questions

Gaps, ambiguities and contradictions found in `docs/backend-spec.md` and `docs/claude-code-build-prompts.md`. Answers are recorded in `docs/decisions.md`. The milestone column uses the numbering in `docs/roadmap.md`.

Status: **Open**, **Partial** (part answered), **Answered** (small answers in the decision log) or **Resolved** (owner's answer recorded as DECIDED in `docs/decisions.md`, which is binding).

## Summary

| ID  | Topic                                                   | Status   | Blocks     |
| --- | ------------------------------------------------------- | -------- | ---------- |
| Q1  | Global tables, RLS bypass, cross-schema FK              | Resolved | —          |
| Q2  | Partitioned tables vs unique keys and PKs               | Resolved | —          |
| Q3  | Ledger balance sign convention                          | Open     | M6         |
| Q4  | Go in the monorepo, ledger data layer                   | Partial  | M6         |
| Q5  | Home for NestJS bootstrap                               | Answered | —          |
| Q6  | Event type names and payloads                           | Partial  | M2         |
| Q7  | Outbox routing to topic and key                         | Resolved | —          |
| Q8  | gRPC message shapes                                     | Answered | —          |
| Q9  | Tenant header from the gateway                          | Answered | —          |
| Q10 | HTTP status per error code                              | Answered | —          |
| Q11 | PII crypto                                              | Answered | —          |
| Q12 | Idempotency scope and semantics                         | Resolved | —          |
| Q13 | BFF and schema ownership                                | Partial  | M20, M21   |
| Q14 | Auth parameters                                         | Partial  | M5         |
| Q15 | Tenant profile JSON shapes                              | Open     | M3         |
| Q16 | Device binding and JWKS                                 | Open     | M5         |
| Q17 | Merchant staff and rider identity                       | Open     | M5, M18    |
| Q18 | Partial and incremental hold capture                    | Partial  | M6, M15    |
| Q19 | Who runs `holds.expire`                                 | Open     | M6         |
| Q20 | Infra provisioning, app builds, deployments             | Answered | —          |
| Q21 | Who writes `tenant_usage_daily`                         | Open     | M21        |
| Q22 | `/me/close` balance check                               | Open     | M5         |
| Q23 | Wallet id in ledger events                              | Open     | M6, M14    |
| Q24 | OpenSearch indexer and loyalty consumer                 | Partial  | M16        |
| Q25 | Missing admin tables (notes, settings)                  | Open     | M20        |
| Q26 | Platform-level maker-checker                            | Open     | M21        |
| Q27 | Push token ownership                                    | Open     | M14        |
| Q28 | `/contacts/match` ownership                             | Open     | M7         |
| Q29 | Risk rule expression format                             | Partial  | M8         |
| Q30 | KYC tier source of truth                                | Partial  | M9         |
| Q31 | Cash-out code table                                     | Open     | M11        |
| Q32 | Missing merchant tables                                 | Open     | M18        |
| Q33 | Webhook tenant path secret                              | Open     | M4         |
| Q34 | Error code for unexpected errors                        | Answered | —          |
| Q35 | Architecture document referenced by the prompts         | Partial  | M2, M3     |
| Q36 | New-device cooling-period flag has no column            | Open     | M5         |
| Q37 | Kong JWT validation vs service JWT validation           | Open     | M4         |
| Q38 | Event naming convention beyond tenancy                  | Resolved | —          |
| Q39 | Cross-schema `tenant_id` FK, dedicated tenant databases | Open     | M2         |
| Q40 | Tables that declare their own primary key               | Open     | M2         |
| Q41 | Runtime writes to global tables                         | Open     | M2, M3, M8 |
| Q42 | PLATFORM-scoped rows in other admin tables              | Open     | M20, M21   |
| Q43 | Source of envelope `version`, `producer`, `traceId`     | Open     | M2         |
| Q44 | Avro schemas through the Debezium outbox relay          | Open     | M2         |
| Q45 | gRPC metadata key for idempotency                       | Open     | M2         |
| Q46 | Actor columns on `idempotency_keys`                     | Open     | M2         |
| Q47 | `notify.inbox` topic missing from §15                   | Open     | M2, M14    |
| Q48 | `delivery.locations` producer has no outbox             | Open     | M14        |
| Q49 | Topic and consumers for KYB decisions                   | Open     | M9, M16    |
| Q50 | Merchant signature encoding and signing key             | Resolved | —          |

## Data model and tenancy

- **Q1. — RESOLVED.** Owner's answer recorded in `docs/decisions.md` (Q1). The cross-schema FK and dedicated-database part continues as Q39.
- **Q2. — RESOLVED.** Owner's answer recorded in `docs/decisions.md` (Q2). The own-primary-key part continues as Q40.
- **Q3. Ledger balance semantics.** Sign convention for `posted_minor` on DEBIT-normal vs CREDIT-normal accounts. Is `available_minor = posted_minor - held_minor` for all accounts? `ledger_accounts unique(tenant_id, owner_type, owner_id, account_type, currency)` allows duplicate SYSTEM accounts because `owner_id` is null; use `NULLS NOT DISTINCT`?
- **Q15. Tenant profile JSON shapes.** `tenant_profiles.brand/market/compliance/products` and `fees_ref` have no defined structure, but `/app/config`, `/kyc/requirements`, limit rules (`source = PROFILE`) and enabled services depend on them. Prompt 3 adds `adapters` and `deployment` sections to profile validation, which are not columns of `tenant_profiles`. §9 restricts `Accept-Language` to `ar`/`en`. Is the locale set fixed or per tenant?
- **Q21.** Who writes `tenancy.tenant_usage_daily`? tenant-service does not own the transaction data. Prompt 21 reads it for `/usage` but does not say who fills it.
- **Q25.** `/admin/v1/users/{id}/notes` and `/admin/v1/settings` have no backing table.
- **Q31.** `POST /cash-out/codes` has no table for one-time codes.
- **Q32.** No tables for merchant webhook endpoints, webhook delivery log, the `/merchant/v1/events?since=` event log, payment intents, or merchant staff invites. Prompt 18 requires a "delivery log visible via API". Are payment intents `payments` rows or a separate table?
- **Q36.** Prompt 5 asks for "a configurable cooling period flag on the user" for new devices, but `identity.users` has no such column. Should it be derived from `devices.first_seen_at` plus a tenant profile setting, or does `users` get a new column?

## Services and ownership

- **Q4. Go in the monorepo.** Partial: Go is wired into Nx with run-commands targets and shared Go code lives under `libs/go/` (decision recorded). Still open: §1 and Prompt 0 list Kysely "for ledger", but the ledger is Go. Which Go data layer should it use: pgx + sqlc, or plain pgx?
- **Q13. BFF and schema ownership.** Partial: Prompt 3 says tenant-service exposes REST that console-bff calls, and Prompt 21 says console-bff backs `/console/v1`. Still open: the `admin` schema belongs to admin-bff, which is not one of the 20 services. Does console-bff share it for platform admins? Which schema holds `api_keys`, and does Kong or a service validate merchant API keys?
- **Q17. Merchant staff and rider identity.** No login or registration endpoints exist for `/mobile/v1/merchant` or `/mobile/v1/rider`. Do they use `/mobile/v1/auth/*` with `user_type`? How does a staff invite become a user? `credentials.password_hash` is "merchant web only", but no merchant web app or endpoints exist.
- **Q19.** `holds.expire` is a BullMQ queue, but holds belong to the Go ledger. Should a Go ticker run it, or a TS worker that calls `ReleaseHold`?
- **Q22.** `/me/close` requires a zero balance, and auth-service has no ledger access. Should auth-service call wallet-service over gRPC, or should the flow move?
- **Q24.** Partial: Prompt 16 puts the OpenSearch indexer in marketplace-service (consuming `marketplace.products`) and Prompt 20 backs `/admin/v1/search` with OpenSearch. Still open: who indexes users, transactions and merchants for admin search, and which service is the "loyalty" consumer of `payments.payments`?
- **Q26.** Console profile activation is maker-checker, but `approval_requests` are tenant-scoped with RBAC in admin-bff. How do platform-level approvals work?
- **Q27.** `POST /notifications/token` is owned by notification-service, but `push_token` lives in `identity.devices`. Which is authoritative?
- **Q28.** `POST /contacts/match` is listed under wallet-service but needs `identity.users.phone_hash`. Should it call auth-service or move there?
- **Q30.** Partial: Prompt 9 makes kyc-service the source and updates auth-service after a decision. Still open: it says "via AuthService.SetUserStatus/kyc tier", but `SetUserStatus` only changes status and §13 has no RPC to set the tier. Add an RPC (not in the spec), or let auth-service consume `kyc.applications`?

## Contracts and events

- **Q6 — RESOLVED (catalogue approved under delegation).** Names are in `docs/events.md`; each event's `data` schema is written with its producing service. Names are resolved by Q38 and drafted in `docs/events.md`. Still open: owner review of `docs/events.md`, and the `data` schema of each event type (drafted per milestone with the producing service).
- **Q7. — RESOLVED.** Owner's answer recorded in `docs/decisions.md` (Q7). Follow-ups: Q43, Q44.
- **Q23.** `wallet.balance_updated` needs `walletId`, but its source `ledger.entries` knows only the ledger `account_id`. Should ledger events carry `owner_type/owner_id`, or should the gateway map accounts to wallets?
- **Q29.** Partial: Prompt 8 calls for a JSON rule expression engine with named conditions and actions. Still open: the exact JSON grammar (JSONLogic or a custom tree).
- **Q33.** §13 resolves the webhook tenant "from the webhook domain or a tenant-scoped path secret", but the path is `/webhooks/{partnerType}/{provider}` with no secret segment. What is the path format?
- **Q35. Architecture document — PARTIAL.** Decided: it lives at `docs/architecture.md`, `docs/backend-spec.md` wins on implementation details, and conflicts are listed here. Still open: the file is not in the repository (checked 2026-09-30), so the conflict review and the adapter interface methods for M3 are waiting on it.
- **Q38. — RESOLVED.** Owner's answer recorded in `docs/decisions.md` (Q38). The full catalogue is drafted in `docs/events.md` for review.

## API behaviour and security

- **Q12. — RESOLVED.** Owner's answer recorded in `docs/decisions.md` (Q12). Follow-ups: Q45, Q46.
- **Q14. Auth parameters.** Partial: Prompt 5 sets access tokens to 10 min, refresh tokens to 30 days (rotating, device-bound, stored hashed) and step-up tokens to 2 min, single use. Still open: OTP length, TTL, max attempts and resend cooldown; PIN length and lockout threshold and duration; registration-token format and TTL; rate-limit windows per endpoint.
- **Q16. Device binding.** Key algorithm for `devices.public_key`; what the device signs at login and step-up (there is no challenge or nonce endpoint); how the client computes the step-up request hash; where auth-service publishes its JWKS and how EdDSA keys rotate.
- **Q18.** Partial: Prompt 15 says clearing captures holds at the final amount. Still open: capture above the held amount, partial capture of ledger holds, and whether the remainder is released.
- **Q37.** Prompt 4 has Kong validate JWTs and pass verified claims as headers, while Prompt 2's `libs/auth` verifies JWTs in services. Should services verify the JWT again (defence in depth, planned default), or trust the gateway headers over mTLS?

## Follow-ups raised by the owner's answers (2026-09-30)

- **Q39 — RESOLVED (delegated; see `docs/decisions.md`).** Cross-schema `tenant_id` FK (rest of Q1).** §3 makes every `tenant_id` an FK to `tenancy.tenants`. With one schema per service, that needs all schemas in one database and a cross-schema reference. Is it a real FK, or a logical reference checked by the application? For DEDICATED tenants, is there one database per tenant stack? My suggestion: a logical reference only, so services stay independently deployable.
- **Q40 — RESOLVED (delegated; see `docs/decisions.md`).** Tables with their own primary key (rest of Q2).** `ledger_balances pk(account_id)`, `role_permissions pk(role_id, permission_id)`, `admin_user_roles pk(admin_user_id, role_id)` and `card_controls pk(card_id)` declare their own PK. Do they also get the standard `id uuid` column? My suggestion: no `id` column; they keep the spec's PK plus `tenant_id` and the timestamps.
- **Q41 — RESOLVED (delegated; see `docs/decisions.md`).** Runtime writes to global tables.** Q1 gives service roles `SELECT` only on global tables. But tenant-service writes `tenancy.tenants` at runtime (`POST /tenants`, suspend, reactivate, `current_profile_version`), and risk-service's `sanctions.sync` job writes `sanctions_lists` and `sanctions_entries`. Should the owning service's runtime role get `INSERT/UPDATE` on its own global table, or should these writes go through a separate role, such as a sync-worker process for sanctions?
- **Q42 — RESOLVED (delegated; see `docs/decisions.md`).** PLATFORM-scoped rows in other admin tables.** Q1 defines the `app.scope` policy for `admin_users`. `roles` has a `scope` column too, so platform roles would have a `NULL` `tenant_id`. `role_permissions`, `admin_user_roles`, platform `approval_requests` (Q26) and platform `audit_logs` would need the same treatment. Should they all use the same `tenant_id = current OR (PLATFORM AND app.scope = 'platform')` policy?
- **Q43 — RESOLVED (delegated; see `docs/decisions.md`).** Where `version`, `producer` and `traceId` come from.** The Q7 envelope needs them, but `outbox_events` has no columns for them. Debezium's Outbox Event Router emits one column as the value and cannot build the nested envelope (`data` next to `subject` and the others). Options:
  - (a) Add `event_version int` and `producer text` columns, take `traceId` from `headers`, and have the relay build the envelope.
  - (b) Have the writer store the complete envelope in `payload`, so the relay emits it unchanged. `data` then sits inside `payload` instead of being `payload`.

  My suggestion: (b) if Debezium stays the relay, (a) if the polling relay becomes the production relay (see Q44).

- **Q44 — RESOLVED (delegated; see `docs/decisions.md`).** Avro schemas through the Debezium outbox relay.** Q38 registers one hand-written Avro schema per event type (`TopicRecordNameStrategy`). Debezium reads `payload` as JSON and generates its own Connect schema, so it would not serialize against those registered schemas or record names. Options:
  - (a) The `libs/kafka` polling relay becomes the production relay. It validates each event against its registered Avro schema before producing. Debezium stays for CDC to ClickHouse only, and Q1 already allows a non-Debezium relay role.
  - (b) The writer serializes Avro into a `bytea` column, and Debezium passes the bytes through with `ByteArrayConverter`.
  - (c) Use JSON Schema instead of Avro.

  My suggestion: (a).

- **Q45 — RESOLVED (delegated; see `docs/decisions.md`).** gRPC idempotency metadata key.** Which metadata key carries the idempotency key on gRPC calls and Temporal activities? My suggestion: `idempotency-key`, next to `tenant-id`, `request-id` and `traceparent`.
- **Q46 — RESOLVED (delegated; see `docs/decisions.md`).** Actor columns on `idempotency_keys`.** Q12 stores the actor with each key, but the spec's table has no actor column. My suggestion: `actor_type text CHECK (USER, API_KEY, ADMIN, SERVICE)` and `actor_id text`, with `SERVICE` plus the service name for internal callers.
- **Q47 — RESOLVED (delegated; see `docs/decisions.md`).** `notify.inbox` is missing from §15.** §14 lists `notify.inbox` as the source topic of the `notification.new` socket event, but §15 has no such topic. Q7 validates topics against the §15 list. Add `notify.inbox` (producer notification-service, consumer realtime-gateway)?
- **Q48 — RESOLVED (delegated; see `docs/decisions.md`).** `delivery.locations` has no outbox.** §15 makes realtime-gateway the producer of `delivery.locations`, but the gateway owns no database schema, so it cannot use the transactional outbox. Allow a direct idempotent producer for this one telemetry topic?
- **Q49 — RESOLVED (delegated; see `docs/decisions.md`).** KYB decisions.** §15 lists no topic for business (KYB) decisions, and marketplace-service is not a consumer of `kyc.applications`, yet merchants become active after KYB approval. Publish `business.approved` / `business.rejected` on `kyc.applications` and add marketplace-service as a consumer?

- **Q50 — RESOLVED (delegated; see `docs/decisions.md`).** `api_keys` has only `key_hash`, but HMAC verification needs the signing key on the server. The signing key is `sha256(api key)`. The owner should confirm the risk noted in the decision.

## Answered

Q5, Q8, Q9, Q10, Q11, Q20 and Q34 are answered in the decision log. Q1, Q2, Q7, Q12 and Q38 are resolved as DECIDED sections. All are in `docs/decisions.md`.
