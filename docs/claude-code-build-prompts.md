# Claude Code Build Prompts — White-Label Super App Backend

Source of truth: `docs/backend-spec.md` (the Backend Engineering Spec).
Run the prompts in order, one per Claude Code session. Do not start the next prompt until the current one's tests pass and you have reviewed and committed it.

## How to use

1. Create an empty folder and put the spec at `docs/backend-spec.md`.
2. Open Claude Code in that folder.
3. Paste Prompt 0. Review what it creates.
4. Paste each next prompt in a new session. Each one starts in plan mode, so review the plan before letting it build.
5. After each prompt, commit with a message like `milestone N: <name>`.

Reusable prompts for resuming work, fixing failures and reviewing are at the end.

---

## Prompt 0 — Project rules and roadmap (no code)

```text
Read docs/backend-spec.md completely. It is the single source of truth for this project.

Do not write application code in this session. Do these three things:

1. Create CLAUDE.md at the repo root with these permanent rules:
   - Stack exactly as spec section 1: TypeScript on Node.js LTS, NestJS on the Fastify adapter, Go only for ledger-service and the card authorization path, PostgreSQL with PostGIS, Prisma for CRUD services and Kysely for ledger/reporting/heavy queries, PgBouncer, Redis, Kafka + Schema Registry (Avro), Debezium, Temporal, BullMQ, Socket.IO with Redis adapter, OpenSearch, ClickHouse, S3-compatible storage, Vault, Kong, Keycloak for staff, Nx + pnpm monorepo, Vitest, Testcontainers, Pact, k6, OpenAPI 3.1 and AsyncAPI 3.
   - Service list, schemas and monorepo layout exactly as spec section 2.
   - Database conventions exactly as spec section 3: standard columns, UUIDv7, tenant_id first in every composite index, row-level security on every table, money as bigint minor units + char(3) currency, status as text + CHECK, PII as _enc bytea + _hash, outbox_events / idempotency_keys / inbox_events in every schema, monthly partitions for high-volume tables, expand-and-contract migrations.
   - White-label multi-tenant: tenant_id on every table, request, gRPC call, Kafka message, cache key, socket room and log line. No per-tenant code branches; tenant differences come only from tenant profile, feature flags, SDUI or adapters.
   - The ledger is the only place balances change. No service stores balances.
   - Every money-moving POST requires Idempotency-Key. Events are written through the transactional outbox.
   - API conventions, headers, error codes and auth levels exactly as spec section 9.
   - Use the exact table names, column names, endpoint paths, event names, topic names and queue names from the spec. If the spec is missing something or contradicts itself, stop and ask me.
   - Latest stable package versions, pinned in the lockfile.
   - No code comments.
   - A milestone is done only when lint, type-check, unit tests and Testcontainers integration tests all pass, and docs/roadmap.md is updated.

2. Create docs/roadmap.md listing these milestones in order, each with: spec sections covered, tables, endpoints, gRPC services, Kafka topics, queues/workflows, and the tests that prove it is done. Status column: TODO / IN PROGRESS / DONE.
   M1 Monorepo and local infrastructure
   M2 Shared libraries
   M3 tenant-service and adapter framework
   M4 API gateway
   M5 auth-service
   M6 ledger-service (Go)
   M7 wallet-service
   M8 risk-service
   M9 file-service and kyc-service
   M10 platform-service
   M11 payments-service
   M12 banking-service
   M13 bills-service
   M14 notification-service and realtime-gateway
   M15 cards-service and cards-auth (Go)
   M16 marketplace-service
   M17 delivery-service and payouts-service
   M18 merchant app API, merchant server API and merchant webhooks
   M19 support-service, reporting-service and audit-service
   M20 admin-bff with RBAC and maker-checker
   M21 console-bff and tenant onboarding
   M22 observability, security and load testing
   M23 deployment: Docker, Helm, Terraform, Argo CD, CI/CD
   M24 end-to-end flows and hardening

3. Write docs/questions.md with every gap, ambiguity or contradiction you found in the spec.

Stop and wait for my review.
```

---

## Prompt 1 — Monorepo and local infrastructure

```text
Follow CLAUDE.md. Milestone M1 from docs/roadmap.md. Spec sections 1 and 2.

Build:
- Nx + pnpm monorepo with the exact folder layout from spec section 2 (apps/, libs/, infra/, tools/). Create empty but runnable NestJS (Fastify) apps for every TypeScript service, and an empty Go module for ledger-service and cards-auth.
- Shared TS config, ESLint, Prettier, Vitest config, and a Go lint config (golangci-lint).
- docker-compose.yml for local development: PostgreSQL (with PostGIS and pgcrypto), PgBouncer, Redis, Kafka (KRaft) + Schema Registry, Debezium Connect, Temporal + Temporal UI, Keycloak, MinIO (S3), OpenSearch, ClickHouse, Mailpit, Jaeger or Tempo for local traces.
- Makefile or Nx targets: dev:up, dev:down, db:migrate, test, test:integration, lint.
- Every service exposes GET /health and /ready, listens on HTTP 3000, gRPC 50051, metrics 9464 inside containers.
- GitHub Actions workflow: install, lint, type-check, affected unit tests, affected integration tests.

Done when: `dev:up` starts all infrastructure, every service boots and returns 200 on /health, CI passes on a clean clone.

Start in plan mode and show me the plan first.
```

---

## Prompt 2 — Shared libraries

```text
Follow CLAUDE.md. Milestone M2. Spec sections 3, 9, 13, 15, 16.

Build these libs with full tests:

libs/common
- Tenant context (AsyncLocalStorage) holding tenantId, requestId, userId, deviceId, locale.
- Money type (bigint minor + currency), formatting to/from API decimal strings.
- UUIDv7 generator.
- Cursor pagination helpers (limit max 100, nextCursor).
- Error class and NestJS exception filter producing the exact error JSON and the full error code list from spec section 9.
- Header parsing for Accept-Language, X-Request-Id, X-Device-Id, X-App-Version, X-Platform.

libs/db
- Prisma and Kysely helpers that run SET LOCAL app.tenant_id in every transaction.
- SQL templates for RLS policies and the standard columns.
- outbox_events, idempotency_keys, inbox_events tables (spec section 3) as a reusable migration.
- Outbox writer (same transaction as the state change).
- Idempotency interceptor: Idempotency-Key header, request hash, 24h stored response, in-flight lock in Redis key t:{tid}:idem:{key}.

libs/kafka
- Event envelope exactly as the architecture: eventId, tenantId, type, version, occurredAt, producer, traceId, subject, data.
- Producer (acks=all, idempotent), Avro + Schema Registry.
- Consumer base with inbox dedupe, retry topics <topic>.retry.1m and <topic>.retry.10m, and <topic>.dlq.
- Message key tenantId:ownerId.

libs/auth
- JWT verification (EdDSA), claims tid, sub, dev, typ.
- Guards for the auth levels in spec section 9: Public, Reg, User, Step-up, Staff, Rider, Key, Admin:perm.
- Step-up token check bound to request hash.
- HMAC-SHA256 merchant signature verifier (method + path + timestamp + sha256(body), 5-minute skew).

libs/proto
- buf setup and .proto files for every gRPC service and RPC listed in spec section 13, with tenant-id, request-id and traceparent metadata interceptors (client and server) and default deadlines (2s, ledger and risk 300ms).

libs/temporal
- Client factory, worker bootstrap, tenantId search attribute, activity helper that always passes idempotency keys.

libs/testing
- Testcontainers fixtures for Postgres, Redis, Kafka, Temporal; data factories; a helper that creates two tenants.

Done when: every lib has unit tests; integration tests prove RLS blocks tenant B from reading tenant A rows, outbox writes are atomic, idempotent replay returns the same response, consumers dedupe duplicate events.

Plan mode first.
```

---

## Prompt 3 — tenant-service and adapter framework

```text
Follow CLAUDE.md. Milestone M3. Spec sections 2, 4 (schema tenancy), 12 (console endpoints for tenants, profiles, adapters, domains, apps), 13 (TenantService gRPC), 16 (Redis keys).

Build tenant-service:
- Prisma schema and migrations for tenants, tenant_profiles, tenant_adapters, tenant_domains, tenant_deployments, tenant_apps, tenant_usage_daily with the exact columns, keys and indexes.
- REST endpoints (to be called later by console-bff): tenants CRUD, suspend/reactivate, profiles list/create draft/activate, adapters CRUD and test, domains, apps.
- gRPC TenantService: GetProfile, ResolveAdapter, ResolveDomain, ListActiveTenants.
- Redis cache t:{tid}:profile (5 min) invalidated by tenancy.tenants events.
- Kafka topic tenancy.tenants events: tenant.created, tenant.profile_changed, tenant.adapter_changed.
- Tenant profile JSON validation (brand, market, compliance, products, adapters, deployment).

Build libs/adapters:
- TypeScript interfaces for BankAdapter, CardIssuerAdapter, KycProviderAdapter, AcquirerAdapter, BillerAdapter, MessagingAdapter with the methods listed in the architecture.
- Adapter registry that resolves the implementation by tenantId + partnerType using TenantService.ResolveAdapter, and loads credentials from Vault by secret_ref.
- A simulator implementation for every adapter type (configurable success, failure, timeout, duplicate and out-of-order webhooks) used in tests and local dev.
- A contract test suite per adapter interface that any real implementation must pass.

Seed script: two demo tenants with different countries, currencies, locales and adapter selections.

Done when: integration tests cover profile versioning and activation, adapter resolution per tenant, cache invalidation, and the simulator contract tests pass.

Plan mode first.
```

---

## Prompt 4 — API gateway

```text
Follow CLAUDE.md. Milestone M4. Spec sections 9 and 16.

Configure Kong (declarative config in infra/, running in docker-compose):
- Routes for /mobile/v1, /mobile/v1/merchant, /mobile/v1/rider, /merchant/v1, /admin/v1, /console/v1, /webhooks/{partnerType}/{provider}, and /socket (WebSocket) to the right upstream service.
- Tenant resolution from the request domain via tenant-service (cached); reject mismatch between domain tenant and JWT tid claim.
- JWT validation for mobile routes; pass-through of verified claims as headers to services.
- Rate limits per tenant, per user and per API key (Redis), returning 429 with Retry-After and the RATE_LIMITED error body.
- X-Request-Id generation/propagation and W3C traceparent.
- Request size limits and basic WAF/bot plugins.

Done when: integration tests with two tenant domains prove correct routing, tenant mismatch rejection, rate limiting and header propagation.

Plan mode first.
```

---

## Prompt 5 — auth-service

```text
Follow CLAUDE.md. Milestone M5. Spec sections 4 (schema identity), 9, 10 (Auth and devices, Profile), 13 (AuthService), 15 (identity topics), 16 (otp, stepup Redis keys).

Build auth-service:
- Migrations for users, credentials, devices, sessions, otp_challenges, login_events (partitioned), user_addresses, referrals.
- Endpoints: /auth/otp/request, /auth/otp/verify, /auth/register, /auth/login, /auth/token/refresh, /auth/logout, /auth/step-up, /auth/pin/change, /auth/pin/reset, /devices, DELETE /devices/{deviceId}, /me GET and PATCH, /me/addresses CRUD, /me/referrals, /me/close.
- EdDSA JWT access tokens (10 min) with tid, sub, dev, typ; rotating refresh tokens (30 days, device-bound, stored hashed).
- PIN hashing with Argon2id, lockout after failed attempts.
- Device binding: device public key registered at signup; login and step-up verify a device signature.
- New-device rule: OTP required plus a configurable cooling period flag on the user.
- OTP sent directly through the tenant MessagingAdapter (simulator locally), attempt counters in Redis.
- Step-up tokens: single use, 2 minutes, bound to request hash, stored at t:{tid}:stepup:{tokenId}.
- PII encryption (_enc + _hash) for phone, email, dob, addresses using a per-tenant key.
- gRPC AuthService: GetUser, BatchGetUsers, VerifyStepUpToken, SetUserStatus, RevokeSessions.
- Kafka events on identity.users and identity.sessions through the outbox.

Done when: tests cover full registration, login on known and new device, refresh rotation and reuse detection, PIN lockout, step-up single use, tenant isolation of phone numbers (same phone in two tenants is allowed).

Plan mode first.
```

---

## Prompt 6 — ledger-service (Go)

```text
Follow CLAUDE.md. Milestone M6. Spec sections 3, 6 (schema ledger and the balancing rule), 13 (LedgerService), 15 (ledger topics).

Build ledger-service in Go:
- golang-migrate migrations for ledger_accounts, journal_entries (partitioned, append-only), postings (partitioned, append-only), ledger_balances, holds, fx_rates, recon_runs, plus outbox_events and idempotency_keys. Deny UPDATE/DELETE on append-only tables at the DB role level. RLS on all tables.
- gRPC LedgerService: CreateAccount, PostEntry, ReverseEntry, CreateHold, CaptureHold, ReleaseHold, GetBalance, BatchGetBalances, ListPostings, GetEntry.
- PostEntry in one transaction: lock affected ledger_balances rows ordered by account_id, insert entry and postings, verify debits equal credits per currency, reject negative balances unless allow_negative, update balances, write outbox event.
- Holds reduce available balance; capture posts the entry and closes the hold atomically; release and expire restore it.
- Idempotency on idempotency_key per tenant.
- Reversal entries reference reverses_entry_id; never edit postings.
- FX entries use FX_POSITION accounts with the rate stored.
- Internal reconciliation job: sum of postings per currency is zero; cached balances equal recomputed balances; writes recon_runs and publishes ops.alerts on mismatch.
- Seed system accounts per tenant (FEE_INCOME, SAFEGUARDING, BANK_CLEARING, CARD_SETTLEMENT, SUSPENSE, etc.).

Tests: unit, Testcontainers integration, property/fuzz tests with random concurrent flows proving the ledger always balances and never deadlocks, idempotent replay, hold lifecycle, p99 PostEntry latency benchmark.

Plan mode first.
```

---

## Prompt 7 — wallet-service

```text
Follow CLAUDE.md. Milestone M7. Spec sections 6 (schema wallet), 10 (Wallet and beneficiaries), 13 (WalletService).

Build wallet-service:
- Migrations for wallets, limit_rules, limit_usage, beneficiaries, statements.
- Wallet creation also creates the ledger account through LedgerService.
- Endpoints: GET/POST /wallets, /wallets/{id}/transactions, /transactions/{id}, /limits, /statements GET and POST, /beneficiaries CRUD, /contacts/match.
- Balances always read from LedgerService (never cached).
- Transaction history built from ledger postings joined with payment references.
- Limits: resolve rules from tenant profile KYC tier defaults plus overrides (scope TIER, SEGMENT, USER, MERCHANT; periods PER_TXN, DAILY, MONTHLY). gRPC ReserveLimit, CommitLimit, ReleaseLimit are atomic with limit_usage.
- gRPC WalletService: GetWallet, GetWalletByOwner, ReserveLimit, CommitLimit, ReleaseLimit, SetWalletStatus.
- Statement generation as a BullMQ job statements.generate producing a PDF in S3.

Done when: tests prove limit reservation under concurrency, frozen wallets reject debits, and statements match ledger postings.

Plan mode first.
```

---

## Prompt 8 — risk-service

```text
Follow CLAUDE.md. Milestone M8. Spec sections 5 (schema risk), 13 (RiskService), 15 (risk topics), 16 (velocity keys).

Build risk-service:
- Migrations for risk_rules, risk_decisions (partitioned), risk_scores, aml_alerts, aml_cases, aml_case_notes, sanctions_lists, sanctions_entries (trigram index), screening_results, blocklist_entries.
- JSON rule expression engine (conditions on amount, currency, velocity counters, device age, new beneficiary, geo mismatch, KYC tier, merchant MCC, blocklists) with actions ALLOW, CHALLENGE, HOLD, BLOCK, ALERT and rule versioning.
- gRPC Evaluate for stages ONBOARDING, LOGIN, PRE_TXN with a 50 ms budget; velocity counters in Redis t:{tid}:vel:{userId}:{service}; writes risk_decisions.
- POST_TXN consumer on payments.payments, ledger.entries and cards.authorizations producing aml_alerts for patterns: structuring, rapid in-out, many-to-one funnels, dormant account spikes.
- Sanctions sync BullMQ job sanctions.sync and name screening with fuzzy matching.
- Rule simulation function (run a draft rule against the last N days of decisions) for the admin API later.

Done when: tests cover each action type, latency benchmark under 50 ms p99, alert generation from event streams, sanctions fuzzy matching.

Plan mode first.
```

---

## Prompt 9 — file-service and kyc-service

```text
Follow CLAUDE.md. Milestone M9. Spec sections 5 (schema kyc), 8 (files table), 10 (KYC endpoints, /files/upload-url), 11 (merchant onboarding endpoints), 13 (FileService, KycService), 15 (KycReviewWorkflow).

Build file-service:
- files table, pre-signed upload URLs (S3/MinIO) per purpose, virus scan job files.scan, signed 5-minute download URLs with access logging, retention_until.
- gRPC FileService: CreateUploadUrl, GetDownloadUrl, GetFileMeta. Endpoint POST /files/upload-url.

Build kyc-service:
- Migrations for kyc_profiles, kyc_applications, kyc_documents, kyc_checks, kyc_cases, kyc_reason_codes, businesses, business_documents, business_ubos.
- Consumer endpoints: /kyc/status, /kyc/requirements, /kyc/applications, /kyc/applications/{id}/documents, /kyc/applications/{id}/liveness-session, /kyc/applications/{id}/submit.
- Merchant onboarding (KYB): /mobile/v1/merchant/onboarding, /onboarding/business, /onboarding/documents, /onboarding/submit.
- Tier requirements come from the tenant compliance profile.
- KycReviewWorkflow (Temporal): provider checks through KycProviderAdapter (simulator) + sanctions screening via risk-service → auto-approve when all pass → otherwise open kyc_cases with SLA timer → on decision update tier via AuthService.SetUserStatus/kyc tier and publish kyc.applications.
- Webhook POST /webhooks/kyc/{provider}.
- gRPC KycService: GetTier, GetProfile, RequireTier.

Done when: tests cover auto-approval, flagged path to a case, resubmission, KYB with UBOs, duplicate ID number detection per tenant.

Plan mode first.
```

---

## Prompt 10 — platform-service

```text
Follow CLAUDE.md. Milestone M10. Spec sections 8 (platform tables), 10 (App config), 13 (PlatformService), 16 (flags and screen cache keys).

Build platform-service:
- Migrations for feature_flags, flag_targets, segments, sdui_screens, sdui_versions, app_versions, maintenance_windows, translations.
- Endpoints: /app/config (tenant brand from profile, enabled services, flags, min/latest app version, maintenance), /app/screens/{screenKey} with ETag, /app/translations.
- Flag evaluation: tenant scope always, then conditions (country, platform, app version range, KYC tier, segment, user list), stable-hash rollout percentage, schedules, kill switch, localized disabled message.
- SDUI: versioned JSON per screen and segment, schema_version compatibility with the app's declared version, sections removed when their feature flag is off, statuses DRAFT → PENDING_APPROVAL → SCHEDULED → PUBLISHED → ARCHIVED, rollback.
- Force/soft update and maintenance responses (UPDATE_REQUIRED, MAINTENANCE errors).
- gRPC PlatformService: EvaluateFlags, IsServiceEnabled, GetScreen.
- Publish platform.config events; cache t:{tid}:flags and t:{tid}:screen:{key}:{segment}.
- Define the SDUI section types JSON schema: balance_card, service_grid, banner_carousel, promo_tile, store_list, recent_transactions.

Done when: tests cover flag targeting and rollout determinism, SDUI resolution per segment, flag-off section removal, cache invalidation.

Plan mode first.
```

---

## Prompt 11 — payments-service

```text
Follow CLAUDE.md. Milestone M11. Spec sections 6 (schema payments), 10 (Payments, top-up, cash), 13 (PaymentsService), 15 (payments topics, CardTopUpWorkflow).

Build payments-service:
- Migrations for payments, payment_events (partitioned), payment_requests, qr_codes, fee_rules, funding_cards, cash_agents, payment_disputes.
- Payment state machine exactly: CREATED, RISK_CHECK, PENDING_USER, PENDING_REVIEW, AUTHORIZED, PROCESSING, COMPLETED, FAILED, DECLINED, REVERSED, PARTIALLY_REFUNDED, REFUNDED, with every transition recorded in payment_events.
- Common pipeline: IsServiceEnabled → validate → ReserveLimit → Risk Evaluate → ledger hold or post → rail if any → final posting → CommitLimit → outbox event.
- Fee and FX calculation from fee_rules and fx_rates; /payments/quote.
- Endpoints: /payments/quote, /payments/p2p, /payments/requests (create, list, pay, decline, cancel), /qr/me, /payments/qr/parse, /payments/qr/pay (EMVCo payloads), /payments/{id}, /payments/{id}/receipt, /payments/{id}/disputes, /funding-cards, /funding-cards/session, /topups/card, /topups/bank-details, /cash-agents, /cash-out/codes.
- CardTopUpWorkflow with AcquirerAdapter (simulator) and webhook POST /webhooks/acquirer/{provider}.
- Human-readable reference_code per payment.
- gRPC PaymentsService: CreatePayment, GetPayment, RefundPayment, CapturePayment.

Done when: tests cover P2P with fees, insufficient funds, limit exceeded, risk CHALLENGE/HOLD/BLOCK, idempotent replay, request-to-pay, QR pay, card top-up success/failure/timeout, refunds and reversals, and the ledger stays balanced across all of them.

Plan mode first.
```

---

## Prompt 12 — banking-service

```text
Follow CLAUDE.md. Milestone M12. Spec sections 7 (schema banking), 10 (Bank accounts and withdrawals), 13 (BankingService, bank webhook), 15 (BankWithdrawalWorkflow, InboundCreditWorkflow, sftp.ingest, recon.daily).

Build banking-service:
- Migrations for bank_partners, internal_bank_accounts, linked_bank_accounts, virtual_accounts, bank_transfers, bank_file_batches, bank_statements, statement_lines, recon_exceptions.
- Endpoints: /bank-accounts GET, POST (name enquiry via BankAdapter), DELETE; /withdrawals POST and GET.
- BankWithdrawalWorkflow: hold → risk → cooling-period check for new accounts → payout via BankAdapter → await webhook or poll → capture or release → notify.
- InboundCreditWorkflow: webhook or statement line → match by virtual account or reference → post to wallet, else suspense + recon_exceptions.
- Webhook POST /webhooks/bank/{provider}.
- File-based banks: ISO 20022 pain.001 generation, pain.002 and camt.053/MT940 parsing via the sftp.ingest job.
- Daily reconciliation (bank vs ledger, safeguarding coverage) via recon.daily; mismatches to ops.alerts.
- Cut-off times and holiday calendars per partner.
- gRPC BankingService: VerifyAccount, InitiatePayout, GetTransfer.

Done when: tests cover withdrawal success/reject/return, unknown outcome handled by polling, inbound matched and unmatched credits, statement parsing, reconciliation exceptions.

Plan mode first.
```

---

## Prompt 13 — bills-service

```text
Follow CLAUDE.md. Milestone M13. Spec sections 6 (schema bills), 10 (Bills), 13 (biller webhook), 15 (BillPaymentWorkflow).

Build bills-service:
- Migrations for billers, biller_fields, bill_payments, saved_bills.
- Endpoints: /billers/categories, /billers, /billers/{id}, /bills/inquiry, /bills/pay, /saved-bills CRUD.
- BillPaymentWorkflow through payments-service and BillerAdapter (simulator): hold → biller pay → await status → capture or release → receipt.
- Webhook POST /webhooks/biller/{provider}.
- Dynamic field validation from biller_fields (regex, required), localized labels.

Done when: tests cover inquiry, pay success, async pending then success, failure with hold release.

Plan mode first.
```

---

## Prompt 14 — notification-service and realtime-gateway

```text
Follow CLAUDE.md. Milestone M14. Spec sections 8 (notify tables), 10 (Notifications), 14 (entire realtime section), 15 (notification pipeline, notify queues).

Build notification-service:
- Migrations for notification_templates, notifications (partitioned), notification_preferences, campaigns.
- Endpoints: /notifications/token, /notifications, /notifications/read, /notification-preferences GET and PUT.
- Kafka consumers mapping domain events to templates per tenant, channel and locale; preferences and quiet hours (security and transaction messages bypass marketing opt-outs); dedupe by event and channel.
- BullMQ queues notify.push, notify.sms, notify.email through MessagingAdapter (FCM for push); delivery receipts webhook POST /webhooks/messaging/{provider}.
- Campaign fan-out job campaigns.send.

Build realtime-gateway:
- Socket.IO with Redis adapter, WebSocket-only, path /socket, namespaces /app, /merchant, /rider, /admin exactly as spec section 14.
- Handshake auth with JWT (or admin session), tenant and device checks, room joins t:{tid}:...
- Kafka consumers that emit every server → client event in spec section 14 to the right rooms.
- Client → server events: order.subscribe/unsubscribe with ownership check, rider.location (Redis GEO t:{tid}:riders:geo, publish rider:loc, batch to delivery.locations), rider.availability, zone.subscribe.
- Limits: 5 sockets per user, 1 location per 3 s, 4 KB payloads, session.expired handling.
- AsyncAPI 3 document for all socket events.

Done when: tests cover room isolation between tenants and users, event fan-out from Kafka, rider location flow, reconnection behaviour, notification templates in ar and en.

Plan mode first.
```

---

## Prompt 15 — cards-service and cards-auth (Go)

```text
Follow CLAUDE.md. Milestone M15. Spec sections 7 (schema cards), 10 (Cards), 13 (card-issuer webhooks, CardsService), 15 (CardIssuanceWorkflow, CardDisputeWorkflow, cards topics).

Build cards-service (TS):
- Migrations for card_programs, cards, card_controls, card_shipments, card_authorizations (partitioned), card_transactions, card_disputes, card_tokens, card_settlements.
- Endpoints: /card-programs, /cards (request, list, detail), activate, freeze, unfreeze, block, replace, controls GET/PATCH, reveal-session, pin-session, provisioning, /cards/{id}/transactions, /cards/{id}/disputes.
- CardIssuanceWorkflow and CardDisputeWorkflow through CardIssuerAdapter (simulator); eligibility from tenant compliance profile.
- Webhook POST /webhooks/card-issuer/{provider}/events for clearing, reversals, status, tokens, disputes; clearing captures holds at final amount; force posts flagged.
- Settlement file ingestion posting interchange and scheme fees.
- gRPC CardsService: GetCard, BlockCard, GetAuthorization.

Build cards-auth (Go):
- POST /webhooks/card-issuer/{provider}/authorizations: verify signature, check card status and controls, limits, Risk Evaluate, available balance, create ledger hold (with FX buffer), return approve/decline with auth code; handle incremental, reversal, partial reversal; idempotent on processor auth ID; write card_authorizations.
- p99 under 500 ms, hard budget 1.5 s, graceful decline on internal timeout.

Never store PAN or CVV; only processor token and last4.

Done when: tests cover approve, each decline reason, control enforcement, FX, reversal, clearing difference, dispute flow, and a k6 load test on the authorization endpoint.

Plan mode first.
```

---

## Prompt 16 — marketplace-service

```text
Follow CLAUDE.md. Milestone M16. Spec sections 8 (schema marketplace), 10 (Marketplace), 15 (OrderPaymentWorkflow, marketplace topics).

Build marketplace-service:
- Migrations for merchants, merchant_staff, stores (PostGIS), categories, products, product_options, carts, orders, order_items, order_events, promotions, promotion_redemptions, commissions, reviews.
- Consumer endpoints: /marketplace/home (SDUI), /categories, /stores (nearby by PostGIS), /stores/{id}, /stores/{id}/products, /products/{id}, /search (OpenSearch), /carts/{storeId} GET/PUT/DELETE, /promotions/validate, /orders POST/GET, /orders/{id}, cancel, tracking, reviews.
- Order state machine PLACED, ACCEPTED, PREPARING, READY, PICKED_UP, DELIVERED, CANCELLED, REJECTED with order_events.
- OrderPaymentWorkflow: hold at checkout (or COD) → await delivered or cancelled → capture and split in one ledger entry (merchant net, rider share, commission, platform delivery fee) or release.
- Promotions with budgets and per-user limits; commissions table written on capture.
- OpenSearch indexer consuming marketplace.products.

Done when: tests cover checkout with wallet and COD, cancellation release, split accounting balanced, promotion limits, nearby search.

Plan mode first.
```

---

## Prompt 17 — delivery-service and payouts-service

```text
Follow CLAUDE.md. Milestone M17. Spec sections 8 (delivery and payouts tables), 11 (Rider app), 13 (DeliveryService), 15 (PayoutBatchWorkflow, delivery topics).

Build delivery-service:
- Migrations for riders, rider_documents, zones, deliveries, delivery_offers, rider_locations (partitioned, 90-day retention), rider_earnings, cod_collections.
- Rider endpoints: /onboarding, /documents, /me, /availability, /offers, accept, reject, /deliveries/active, /deliveries/{id}, arrived-pickup, picked-up, arrived-dropoff, delivered (proof + COD), failed, /location (fallback), /earnings, /cod, /cod/deposits, /withdrawals.
- Dispatch: nearest available rider by Redis GEO and ETA within zone, offer with timeout, next rider on reject/expiry.
- Earnings credited per delivery via ledger; COD recorded as COD_PAYABLE and netted from earnings or cleared on deposit.
- gRPC DeliveryService: CreateDelivery, CancelDelivery, GetDelivery.
- Consume delivery.locations to persist history.

Build payouts-service:
- Migrations for payout_batches, payouts.
- PayoutBatchWorkflow per schedule: build batch, apply reserves and open disputes, pay via banking-service, reconcile, generate statements.

Done when: tests cover dispatch and re-offer, full delivery lifecycle, COD netting, payout batch with reserve and failure retry.

Plan mode first.
```

---

## Prompt 18 — Merchant app API, merchant server API, merchant webhooks

```text
Follow CLAUDE.md. Milestone M18. Spec section 11 (Merchant app, Merchant server API, outbound webhook events) and section 4 (api_keys).

Build:
- All /mobile/v1/merchant endpoints listed in spec section 11 across the owning services (marketplace, payments, payouts, kyc), with role checks OWNER, MANAGER, CASHIER and store scoping.
- All /merchant/v1 endpoints with API key + HMAC signature auth (api_keys table), payment intents (checkout and dynamic QR), refunds, orders, products, stores, balance, transactions, payouts, settlement report CSV, webhook-endpoints CRUD and test, /events replay.
- Outbound webhook delivery via BullMQ webhooks.merchant: HMAC-SHA256 signed, exponential backoff for 72 h, eventId dedupe, delivery log visible via API.
- Events: payment_intent.succeeded, payment_intent.failed, refund.succeeded, refund.failed, order.placed, order.cancelled, payout.paid, payout.failed.
- OpenAPI spec for the merchant server API published as developer documentation.

Done when: tests cover signature verification and replay protection, role restrictions, webhook retry and dedupe.

Plan mode first.
```

---

## Prompt 19 — support-service, reporting-service, audit-service

```text
Follow CLAUDE.md. Milestone M19. Spec sections 4 (audit tables), 8 (support, reporting tables), 10 (Support endpoints), 15 (reports.run queue).

Build:
- support-service: tickets, ticket_messages, support_macros; consumer endpoints /support/tickets GET/POST, /support/tickets/{id}, messages; SLA timers.
- audit-service: consume admin.actions and admin.approvals into audit_logs (append-only, partitioned, WORM export to object storage), pii_reveal_logs; read API for admin.
- reporting-service: Debezium CDC from all service schemas into ClickHouse with PII tokenized; report_definitions, report_schedules, report_runs; reports.run job producing CSV/XLSX/PDF to S3; seed definitions for daily settlement, reconciliation summary, float and liquidity, fees and revenue, merchant payouts, KYC/AML regulatory summaries.

Done when: tests cover ticket lifecycle, audit immutability, a report run end to end from CDC to file.

Plan mode first.
```

---

## Prompt 20 — admin-bff with RBAC and maker-checker

```text
Follow CLAUDE.md. Milestone M20. Spec sections 4 (admin tables), 12 (entire Tenant admin API table), 14 (/admin namespace), 15 (ApprovalExecutionWorkflow).

Build admin-bff:
- Keycloak OIDC (tenant realm) + TOTP; admin_users, roles, permissions, role_permissions, admin_user_roles, approval_policies, approval_requests.
- Seed the permissions catalog with every permission code used in spec section 12 and the default roles: Super Admin, Compliance Officer, KYC Agent, Finance, Support, Marketplace Ops, Rider Ops, Content/CMS, Auditor.
- Implement every /admin/v1 endpoint in spec section 12 by calling the owning services over gRPC/REST, checking the listed permission.
- Maker-checker: endpoints marked MC create approval_requests with before/after diff and reason, return 202 { approvalRequestId }; ApprovalExecutionWorkflow awaits a different checker with the required role (and amount thresholds), then executes the original call with its idempotency key; expiry after 24 h.
- PII masking by role and /users/{id}/reveal with reason, logged in pii_reveal_logs.
- Every mutation publishes admin.actions for the audit log.
- Global /search via OpenSearch filtered by permission.

Done when: tests cover permission denial, maker cannot approve own request, threshold-based second approver, execution idempotency, PII masking.

Plan mode first.
```

---

## Prompt 21 — console-bff and tenant onboarding

```text
Follow CLAUDE.md. Milestone M21. Spec section 12 (Platform console API) and section 15 (TenantOnboardingWorkflow).

Build console-bff:
- Keycloak platform realm + TOTP; platform admin users.
- Every /console/v1 endpoint in spec section 12 backed by tenant-service.
- TenantOnboardingWorkflow: create tenant and profile draft → provision (call infra automation hook, stub locally) → seed ledger system accounts, default roles and permissions, default notification templates, default SDUI screens and flags → run adapter connectivity tests → invite the tenant's first Super Admin → activate.
- Trigger white-label app builds via a CI webhook (stub locally).
- /health/tenants and /usage aggregation from tenant_usage_daily.

Done when: an integration test onboards a brand-new tenant end to end and that tenant can register a user and make a P2P payment with no code change.

Plan mode first.
```

---

## Prompt 22 — Observability, security and load testing

```text
Follow CLAUDE.md. Milestone M22. Spec section 16.

Add:
- OpenTelemetry SDK in every service (TS and Go) with tenant_id, request_id, hashed user_id and payment_id on spans and logs; PII masking in logs.
- Prometheus metrics and Grafana dashboards per service and per tenant; business SLIs listed in spec section 16.
- Alert rules: SLO burn rate, ledger imbalance, DLQ growth, webhook backlog, partner error rate per adapter per tenant.
- Security: Semgrep, Trivy, OWASP ZAP baseline in CI; secrets from Vault only; verify no PAN/CVV fields anywhere.
- k6 load tests: P2P, card authorization, order checkout, socket connections at 3x forecast peak.

Done when: dashboards show a traced request from gateway to ledger, alerts fire in a staged failure test, k6 thresholds pass.

Plan mode first.
```

---

## Prompt 23 — Deployment and CI/CD

```text
Follow CLAUDE.md. Milestone M23. Spec sections 1, 2 (infra/), 16 (CI/CD).

Build:
- Production Dockerfiles (multi-stage, non-root, signed images) for every service.
- Helm charts per service with values/<tenant>.yaml overrides; HPA, PDB, resource limits, Linkerd mTLS.
- Terraform modules (network, Kubernetes, PostgreSQL with replicas, Redis, Kafka, Temporal, S3, KMS, Vault) and one workspace per tenant deployment (shared and dedicated models).
- Argo CD apps with wave rollout: internal → pilot tenants → all, canary analysis and automatic rollback.
- GitHub Actions: PR checks, main build + publish, release tagging, per-tenant deployment promotion.
- Codemagic (or Fastlane) template for building one Flutter flavor per tenant.

Done when: a staging deployment for two tenants (one shared, one dedicated) is reproducible from Terraform + Argo CD.

Plan mode first.
```

---

## Prompt 24 — End-to-end flows and hardening

```text
Follow CLAUDE.md. Milestone M24. Whole spec.

1. Write end-to-end tests (API level) for: onboarding + KYC tier 1, P2P, request-to-pay, card top-up, bank withdrawal, inbound bank credit, bill pay, virtual card issue + authorization + clearing, marketplace order with delivery and split, merchant payout, admin maker-checker freeze/unfreeze, tenant onboarding.
2. Run Pact contract verification across all services and the gRPC buf breaking check.
3. Compare the implementation against docs/backend-spec.md section by section: list every table, column, endpoint, event, topic and queue that is missing or different, then fix them.
4. Update docs/roadmap.md to DONE and write docs/runbook.md (local setup, deploy, rollback, on-call alerts, adding a tenant, adding an adapter).

Plan mode first.
```

---

## Reusable prompts

### Resume an unfinished milestone

```text
Read CLAUDE.md and docs/roadmap.md. Milestone <N> is IN PROGRESS.
Compare the code with the milestone's scope in the roadmap and the spec sections it lists.
List what is done and what is missing, then finish the missing parts. Plan mode first.
```

### Fix failing tests

```text
Run the full test suite for the affected Nx projects.
For each failure, find the root cause and fix the code (not the test) unless the test contradicts docs/backend-spec.md, in which case show me the conflict before changing anything.
```

### Spec compliance review for one service

```text
Review apps/<service> against docs/backend-spec.md.
Check: exact table and column names, indexes, RLS on every table, tenant_id everywhere, idempotency on money POSTs, outbox usage, error codes, endpoint paths and auth levels, events and topics.
Output a table of mismatches, then fix them after I confirm.
```

### Add a real partner adapter

```text
Read CLAUDE.md, libs/adapters and the attached partner API documentation.
Implement <AdapterType> for <provider> in libs/adapters/<type>/<provider>, mapping it to our neutral interface.
It must pass the existing contract test suite for <AdapterType>. Use the sandbox credentials from Vault path <path>.
Plan mode first.
```

### Security review of money code

```text
Do a security and correctness review of <ledger-service | cards-auth | payments-service | auth-service>.
Look for: race conditions, double spend, missing idempotency, missing tenant scoping, balance checks outside transactions, unsafe retries, PII in logs, auth bypass.
Report findings ranked by severity with file and line, then propose fixes. Do not change code until I approve.
```
