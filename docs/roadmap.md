# Build Roadmap

Derived from `docs/backend-spec.md`. Milestones follow the order in `docs/claude-code-build-prompts.md`: one prompt per milestone, plan mode first, and a commit (`milestone N: <name>`) once its tests pass and it has been reviewed. Open questions (`Q<n>`) are in `docs/questions.md`; answers are in `docs/decisions.md`.

Conventions:

- **Std tables:** `outbox_events`, `idempotency_keys`, `inbox_events` (spec §3), present in every service schema.
- **RLS test:** an integration test that seeds two tenants and proves neither can read or write the other's rows in any table of the milestone.
- Every milestone is done only when lint, type-check, unit tests and Testcontainers integration tests pass, and this file is updated.

## Status

| #   | Milestone                                                   | Status      | Prompt |
| --- | ----------------------------------------------------------- | ----------- | ------ |
| M1  | Monorepo and local infrastructure                           | DONE        | 1      |
| M2  | Shared libraries                                            | IN PROGRESS | 2      |
| M3  | tenant-service and adapter framework                        | TODO        | 3      |
| M4  | API gateway                                                 | TODO        | 4      |
| M5  | auth-service                                                | TODO        | 5      |
| M6  | ledger-service (Go)                                         | TODO        | 6      |
| M7  | wallet-service                                              | TODO        | 7      |
| M8  | risk-service                                                | TODO        | 8      |
| M9  | file-service and kyc-service                                | TODO        | 9      |
| M10 | platform-service                                            | TODO        | 10     |
| M11 | payments-service                                            | TODO        | 11     |
| M12 | banking-service                                             | TODO        | 12     |
| M13 | bills-service                                               | TODO        | 13     |
| M14 | notification-service and realtime-gateway                   | TODO        | 14     |
| M15 | cards-service and cards-auth (Go)                           | TODO        | 15     |
| M16 | marketplace-service                                         | TODO        | 16     |
| M17 | delivery-service and payouts-service                        | TODO        | 17     |
| M18 | Merchant app API, merchant server API and merchant webhooks | TODO        | 18     |
| M19 | support-service, reporting-service and audit-service        | TODO        | 19     |
| M20 | admin-bff with RBAC and maker-checker                       | TODO        | 20     |
| M21 | console-bff and tenant onboarding                           | TODO        | 21     |
| M22 | Observability, security and load testing                    | TODO        | 22     |
| M23 | Deployment: Docker, Helm, Terraform, Argo CD, CI/CD         | TODO        | 23     |
| M24 | End-to-end flows and hardening                              | TODO        | 24     |

---

## M1. Monorepo and local infrastructure — DONE

- **Spec:** §1, §2, §16 CI/CD step 1.
- **Built:**
  - Nx + pnpm workspace, strict TS, ESLint with a no-comments rule, Prettier, Vitest, golangci-lint, buf, Renovate, and version/comment check scripts.
  - 21 NestJS (Fastify) apps and 2 Go apps (`ledger-service`, `cards-service/cards-auth`), each serving `/health` and `/ready` on 3000, gRPC health on 50051 and metrics on 9464.
  - `docker-compose.yml` with Postgres (PostGIS, pgcrypto, pg_partman, logical WAL), PgBouncer, Redis, Kafka, Schema Registry, Debezium Connect, Temporal, Keycloak, S3 (RustFS), OpenSearch, ClickHouse, Mailpit, Tempo and Grafana.
  - Root scripts `dev:up`, `dev:down`, `dev:smoke`, `db:migrate`, `lint`, `test`, `test:integration`; GitHub Actions workflow running all of them.
- **Tests:** 21 in-process app health tests; Go `server` package and app tests; `dev:smoke` boots all 23 services as processes and checks HTTP, gRPC, metrics and clean SIGTERM shutdown; Postgres image Testcontainers test; every compose service healthy.

## M2. Shared libraries — IN PROGRESS

- **Spec:** §3, §9, §13, §15, §16.
- **Done:** `libs/common` (tenant context, money, UUIDv7, cursor pagination, error model and codes, locale, logger, PII crypto) and `libs/nest` (Fastify bootstrap, exception filter, tenant-context hook, OpenTelemetry). The M1 health and gRPC runtime was added to `libs/nest`.
- **Remaining:**
  - `libs/common`: header parsing for `X-Device-Id`, `X-App-Version` and `X-Platform`.
  - `libs/db`: Prisma and Kysely helpers with `SET LOCAL app.tenant_id`; RLS and standard-column SQL templates; the Std tables as a reusable migration; outbox writer; idempotency interceptor using `t:{tid}:idem:{key}` (Q1, Q2, Q7, Q12).
  - `libs/kafka`: event envelope (`eventId, tenantId, type, version, occurredAt, producer, traceId, subject, data`); idempotent producer with Avro and Schema Registry; consumer with inbox dedupe, `.retry.1m`, `.retry.10m` and `.dlq`; key `tenantId:ownerId` (Q6, Q7, Q38).
  - `libs/auth`: EdDSA JWT verification (`tid, sub, dev, typ`); guards Public, Reg, User, Step-up, Staff, Rider, Key and Admin:perm; step-up check bound to the request hash; merchant HMAC signature verifier with 5-minute skew.
  - `libs/proto`: `.proto` files for every service and RPC in §13; tenant-id, request-id and traceparent interceptors; default deadlines of 2 s, and 300 ms for ledger and risk.
  - `libs/temporal`: client factory, worker bootstrap, `tenantId` search attribute, activity helper with idempotency keys.
  - `libs/testing`: Testcontainers fixtures for Postgres, Redis, Kafka and Temporal; factories; a two-tenant helper.
- **Done when:** every lib has unit tests; integration tests prove RLS blocks tenant B from tenant A's rows, outbox writes are atomic, idempotent replay returns the same response, and consumers dedupe duplicate events.

## M3. tenant-service and adapter framework

- **Spec:** §2, §4 `tenancy`, §12 console tenant endpoints, §13 `TenantService`, §15 `tenancy.tenants`, `TenantOnboardingWorkflow` (M21), §16 `t:{tid}:profile`.
- **Tables:** `tenants` (global, Q1), `tenant_profiles`, `tenant_adapters`, `tenant_domains`, `tenant_deployments`, `tenant_apps`, `tenant_usage_daily` + Std tables.
- **Endpoints (REST, called by console-bff):** `/tenants` CRUD, `/tenants/{id}/suspend`, `/tenants/{id}/reactivate`, `/tenants/{id}/profiles`, `/tenants/{id}/profiles/{version}/activate`, `/adapters/catalog`, `/tenants/{id}/adapters` CRUD, `/tenants/{id}/adapters/{adapterId}/test`, `/tenants/{id}/domains`, `/tenants/{id}/apps`.
- **gRPC:** `tenant.v1.TenantService` — `GetProfile`, `ResolveAdapter`, `ResolveDomain`, `ListActiveTenants`.
- **Topics:** `tenancy.tenants` with `tenant.created`, `tenant.profile_changed`, `tenant.adapter_changed`.
- **libs/adapters:** interfaces for `BankAdapter`, `CardIssuerAdapter`, `KycProviderAdapter`, `AcquirerAdapter`, `BillerAdapter` and `MessagingAdapter` (Q35); a registry that resolves by tenant and partner type with Vault `secret_ref`; configurable simulators (success, failure, timeout, duplicate and out-of-order webhooks); a contract test suite per interface.
- **Seed:** two demo tenants with different countries, currencies, locales and adapters.
- **Done when:** integration tests cover profile versioning and activation, per-tenant adapter resolution, cache invalidation and the RLS test, and the simulator contract tests pass (Q15).

## M4. API gateway

- **Spec:** §9, §13 webhooks, §16 rate-limit keys.
- **Scope:** declarative Kong config in `infra/`, running in compose:
  - routes for `/mobile/v1`, `/mobile/v1/merchant`, `/mobile/v1/rider`, `/merchant/v1`, `/admin/v1`, `/console/v1`, `/webhooks/{partnerType}/{provider}` and `/socket`
  - tenant resolution from the domain through tenant-service (cached), and rejection when the domain tenant doesn't match the JWT `tid`
  - JWT validation with verified claims forwarded (Q37)
  - rate limits per tenant, user and API key returning 429, `Retry-After` and `RATE_LIMITED`
  - `X-Request-Id` and `traceparent` propagation; size limits and WAF/bot plugins
- **Done when:** integration tests with two tenant domains prove routing, tenant-mismatch rejection, rate limiting and header propagation (Q33).

## M5. auth-service

- **Spec:** §4 `identity`, §9, §10 "Auth and devices" and "Profile", §13 `AuthService`, §14 `session.revoked`, §15 `identity.users`, `identity.sessions`, §16 `t:{tid}:otp:{phoneHash}`, `t:{tid}:stepup:{tokenId}`.
- **Tables:** `users`, `credentials`, `devices`, `sessions`, `otp_challenges`, `login_events` (partitioned), `user_addresses`, `referrals` + Std tables.
- **Endpoints:** `/auth/otp/request`, `/auth/otp/verify`, `/auth/register`, `/auth/login`, `/auth/token/refresh`, `/auth/logout`, `/auth/step-up`, `/auth/pin/change`, `/auth/pin/reset`, `GET /devices`, `DELETE /devices/{deviceId}`, `GET/PATCH /me`, `/me/addresses` CRUD, `/me/referrals`, `/me/close` (Q22).
- **gRPC:** `GetUser`, `BatchGetUsers`, `VerifyStepUpToken`, `SetUserStatus`, `RevokeSessions`.
- **Rules:** EdDSA access tokens (10 min); rotating device-bound refresh tokens (30 days, stored hashed); Argon2id PIN with lockout; device-key signatures on login and step-up; OTP plus a cooling-period flag for new devices (Q36); OTP sent directly through the MessagingAdapter; step-up tokens single use, 2 min, bound to the request hash; PII `_enc` + `_hash` for phone, email, DOB and addresses (Q14, Q16, Q17).
- **Done when:** tests cover full registration, login on known and new devices, refresh rotation and reuse detection, PIN lockout, single-use step-up, the RLS test, and the same phone registering in two tenants.

## M6. ledger-service (Go)

- **Spec:** §3, §6 `ledger` and the balancing rule, §13 `LedgerService`, §15 `ledger.entries`, `ledger.holds`, `holds.expire`, `recon.daily`, `ops.alerts`.
- **Tables:** `ledger_accounts`, `journal_entries` (append-only, partitioned), `postings` (append-only, partitioned), `ledger_balances`, `holds`, `fx_rates`, `recon_runs`, `outbox_events`, `idempotency_keys` (Q2, Q3, Q4).
- **gRPC:** `CreateAccount`, `PostEntry`, `ReverseEntry`, `CreateHold`, `CaptureHold`, `ReleaseHold`, `GetBalance`, `BatchGetBalances`, `ListPostings`, `GetEntry`.
- **Rules:** one transaction per entry (lock balances ordered by `account_id`, insert entry and postings, check debits equal credits per currency, reject negative balances unless `allow_negative`, update balances, write outbox); hold lifecycle (Q18, Q19); per-tenant idempotency; reversals via `reverses_entry_id`; FX through `FX_POSITION`; internal reconciliation to `recon_runs` and `ops.alerts`; seeded system accounts per tenant (Q23).
- **Done when:** unit, Testcontainers integration, and property/fuzz tests with concurrent random flows prove the ledger always balances and never deadlocks; idempotent replay; hold lifecycle; RLS test; p99 `PostEntry` benchmark.

## M7. wallet-service

- **Spec:** §6 `wallet`, §10 wallet and beneficiaries, §13 `WalletService`, §15 `statements.generate`.
- **Tables:** `wallets`, `limit_rules`, `limit_usage`, `beneficiaries`, `statements` + Std tables.
- **Endpoints:** `GET/POST /wallets`, `/wallets/{id}/transactions`, `/transactions/{id}`, `/limits`, `GET/POST /statements`, `/beneficiaries` CRUD, `/contacts/match` (Q28).
- **gRPC:** `GetWallet`, `GetWalletByOwner`, `ReserveLimit`, `CommitLimit`, `ReleaseLimit`, `SetWalletStatus`.
- **Done when:** tests prove limit reservation under concurrency, frozen wallets reject debits, statements match ledger postings, and the RLS test passes.

## M8. risk-service

- **Spec:** §5 `risk`, §13 `RiskService`, §15 `risk.decisions`, `risk.alerts`, `sanctions.sync`, §16 `t:{tid}:vel:{userId}:{service}`.
- **Tables:** `risk_rules`, `risk_decisions` (partitioned), `risk_scores`, `aml_alerts`, `aml_cases`, `aml_case_notes`, `sanctions_lists`, `sanctions_entries`, `screening_results`, `blocklist_entries` + Std tables.
- **gRPC:** `Evaluate` for ONBOARDING, LOGIN and PRE_TXN (50 ms budget).
- **Consumers:** POST_TXN on `payments.payments`, `ledger.entries` and `cards.authorizations` → `aml_alerts`.
- **Done when:** tests cover each action type (Q29), latency under 50 ms p99, alert generation from event streams, sanctions fuzzy matching and the RLS test.

## M9. file-service and kyc-service

- **Spec:** §5 `kyc`, §8 `files`, §10 KYC and `/files/upload-url`, §11 merchant onboarding, §13 `FileService`, `KycService`, `/webhooks/kyc/{provider}`, §15 `files.scan`, `kyc.applications`, `kyc.cases`, `KycReviewWorkflow`.
- **Tables:** `files`; `kyc_profiles`, `kyc_applications`, `kyc_documents`, `kyc_checks`, `kyc_cases`, `kyc_reason_codes`, `businesses`, `business_documents`, `business_ubos` + Std tables.
- **Endpoints:** `/files/upload-url`; `/kyc/status`, `/kyc/requirements`, `/kyc/applications`, `/kyc/applications/{id}/documents`, `/kyc/applications/{id}/liveness-session`, `/kyc/applications/{id}/submit`; `/mobile/v1/merchant/onboarding`, `/onboarding/business`, `/onboarding/documents`, `/onboarding/submit`.
- **gRPC:** `CreateUploadUrl`, `GetDownloadUrl`, `GetFileMeta`; `GetTier`, `GetProfile`, `RequireTier`.
- **Done when:** tests cover auto-approval, the flagged path to a case, resubmission, KYB with UBOs, duplicate ID numbers per tenant (Q30) and the RLS test.

## M10. platform-service

- **Spec:** §8 `platform` tables, §10 app config, §13 `PlatformService`, §15 `platform.config`, `segments.refresh`, §16 `t:{tid}:flags`, `t:{tid}:screen:{key}:{segment}`.
- **Tables:** `feature_flags`, `flag_targets`, `segments`, `sdui_screens`, `sdui_versions`, `app_versions`, `maintenance_windows`, `translations` + Std tables.
- **Endpoints:** `/app/config`, `/app/screens/{screenKey}` (ETag), `/app/translations`.
- **gRPC:** `EvaluateFlags`, `IsServiceEnabled`, `GetScreen`.
- **Done when:** tests cover flag targeting and rollout determinism, per-segment SDUI resolution, removal of sections whose flag is off, cache invalidation and the RLS test.

## M11. payments-service

- **Spec:** §6 `payments`, §10 payments, top-up and cash, §13 `PaymentsService`, `/webhooks/acquirer/{provider}`, §15 `payments.payments`, `payments.requests`, `CardTopUpWorkflow`.
- **Tables:** `payments`, `payment_events` (partitioned), `payment_requests`, `qr_codes`, `fee_rules`, `funding_cards`, `cash_agents`, `payment_disputes` + Std tables (Q31).
- **Endpoints:** all 20 endpoints in §10 "Payments, top-up, cash".
- **gRPC:** `CreatePayment`, `GetPayment`, `RefundPayment`, `CapturePayment`.
- **Done when:** tests cover P2P with fees, insufficient funds, limit exceeded, risk CHALLENGE/HOLD/BLOCK, idempotent replay, request-to-pay, QR pay, card top-up success/failure/timeout, refunds and reversals, a balanced ledger throughout, and the RLS test.

## M12. banking-service

- **Spec:** §7 `banking`, §10 bank accounts and withdrawals, §13 `BankingService`, `/webhooks/bank/{provider}`, §15 `banking.transfers`, `banking.recon`, `BankWithdrawalWorkflow`, `InboundCreditWorkflow`, `sftp.ingest`, `recon.daily`.
- **Tables:** `bank_partners`, `internal_bank_accounts`, `linked_bank_accounts`, `virtual_accounts`, `bank_transfers`, `bank_file_batches`, `bank_statements`, `statement_lines`, `recon_exceptions` + Std tables.
- **Endpoints:** `/bank-accounts` GET/POST/DELETE, `/withdrawals` POST/GET.
- **gRPC:** `VerifyAccount`, `InitiatePayout`, `GetTransfer`.
- **Done when:** tests cover withdrawal success, reject and return; unknown outcomes resolved by polling; matched and unmatched inbound credits; statement parsing; reconciliation exceptions; and the RLS test.

## M13. bills-service

- **Spec:** §6 `bills`, §10 bills, §13 `/webhooks/biller/{provider}`, §15 `bills.payments`, `BillPaymentWorkflow`.
- **Tables:** `billers`, `biller_fields`, `bill_payments`, `saved_bills` + Std tables.
- **Endpoints:** `/billers/categories`, `/billers`, `/billers/{id}`, `/bills/inquiry`, `/bills/pay`, `/saved-bills` CRUD.
- **Done when:** tests cover inquiry, successful payment, async pending then success, failure with hold release, and the RLS test.

## M14. notification-service and realtime-gateway

- **Spec:** §8 `notify` tables, §10 notifications, §13 `/webhooks/messaging/{provider}`, §14 (all), §15 notification pipeline, `notify.requests`, `notify.push|sms|email`, `campaigns.send`, `delivery.locations`, §16 `t:{tid}:riders:geo`.
- **Tables:** `notification_templates`, `notifications` (partitioned), `notification_preferences`, `campaigns` + Std tables.
- **Endpoints:** `/notifications/token` (Q27), `/notifications`, `/notifications/read`, `/notification-preferences` GET/PUT.
- **Realtime:** Socket.IO at `/socket` with namespaces `/app`, `/merchant`, `/rider`, `/admin`, every server → client and client → server event in §14, the §14 limits, and an AsyncAPI document.
- **Done when:** tests cover room isolation between tenants and users, fan-out from Kafka, the rider location flow, reconnection, and `ar`/`en` templates.

## M15. cards-service and cards-auth (Go)

- **Spec:** §7 `cards`, §10 cards, §13 card-issuer webhooks and `CardsService`, §15 `cards.cards`, `cards.authorizations`, `cards.transactions`, `CardIssuanceWorkflow`, `CardDisputeWorkflow`.
- **Tables:** `card_programs`, `cards`, `card_controls`, `card_shipments`, `card_authorizations` (partitioned), `card_transactions`, `card_disputes`, `card_tokens`, `card_settlements` + Std tables.
- **Endpoints:** all 17 endpoints in §10 "Cards"; `/webhooks/card-issuer/{provider}/events`; `/webhooks/card-issuer/{provider}/authorizations` (Go, p99 < 500 ms, hard budget 1.5 s).
- **gRPC:** `GetCard`, `BlockCard`, `GetAuthorization`.
- **Done when:** tests cover approval, each decline reason, control enforcement, FX, reversals, clearing differences (Q18) and the dispute flow; a k6 load test on the authorization endpoint passes.

## M16. marketplace-service

- **Spec:** §8 `marketplace`, §10 marketplace, §15 `marketplace.orders`, `marketplace.products`, `OrderPaymentWorkflow`.
- **Tables:** `merchants`, `merchant_staff`, `stores`, `categories`, `products`, `product_options`, `carts`, `orders`, `order_items`, `order_events`, `promotions`, `promotion_redemptions`, `commissions`, `reviews` + Std tables.
- **Endpoints:** all 17 endpoints in §10 "Marketplace".
- **Also:** OpenSearch indexer consuming `marketplace.products` (Q24).
- **Done when:** tests cover checkout with wallet and COD, release on cancellation, balanced split accounting, promotion limits, nearby search, and the RLS test.

## M17. delivery-service and payouts-service

- **Spec:** §8 `delivery` and `payouts`, §11 rider app, §13 `DeliveryService`, §15 `delivery.deliveries`, `delivery.offers`, `delivery.locations`, `payouts.payouts`, `PayoutBatchWorkflow`.
- **Tables:** `riders`, `rider_documents`, `zones`, `deliveries`, `delivery_offers`, `rider_locations` (partitioned, 90-day), `rider_earnings`, `cod_collections`, `payout_batches`, `payouts` + Std tables.
- **Endpoints:** all 19 endpoints in §11 "Rider app".
- **gRPC:** `CreateDelivery`, `CancelDelivery`, `GetDelivery`.
- **Done when:** tests cover dispatch and re-offer, the full delivery lifecycle, COD netting, a payout batch with reserve and failure retry, and the RLS test.

## M18. Merchant app API, merchant server API and merchant webhooks

- **Spec:** §4 `api_keys`, §11 merchant app, merchant server API and outbound webhook events, §15 `webhooks.merchant`.
- **Endpoints:** all 28 `/mobile/v1/merchant` endpoints and all 24 `/merchant/v1` endpoints (Q32).
- **Events:** `payment_intent.succeeded`, `payment_intent.failed`, `refund.succeeded`, `refund.failed`, `order.placed`, `order.cancelled`, `payout.paid`, `payout.failed`.
- **Done when:** tests cover signature verification and replay protection, role restrictions (OWNER, MANAGER, CASHIER, store scoping), and webhook retry and dedupe; the merchant OpenAPI spec is published.

## M19. support-service, reporting-service and audit-service

- **Spec:** §4 `audit` tables, §8 `support` and `reporting` tables, §10 support, §15 `reports.run`, `admin.actions`, `admin.approvals`.
- **Tables:** `tickets`, `ticket_messages`, `support_macros`; `audit_logs` (append-only, partitioned), `pii_reveal_logs`; `report_definitions`, `report_schedules`, `report_runs` + Std tables.
- **Endpoints:** `/support/tickets` GET/POST, `/support/tickets/{id}`, `/support/tickets/{id}/messages`; audit read API.
- **Done when:** tests cover the ticket lifecycle, audit immutability, and a report run end to end from CDC to file.

## M20. admin-bff with RBAC and maker-checker

- **Spec:** §4 `admin` tables, §12 tenant admin API (all), §14 `/admin`, §15 `admin.approvals`, `admin.actions`, `ApprovalExecutionWorkflow`.
- **Tables:** `admin_users`, `permissions`, `roles`, `role_permissions`, `admin_user_roles`, `approval_policies`, `approval_requests` + Std tables (Q1, Q13, Q25).
- **Endpoints:** every `/admin/v1` endpoint in §12.
- **Done when:** tests cover permission denial, the maker being unable to approve their own request, a threshold-based second approver, execution idempotency and PII masking.

## M21. console-bff and tenant onboarding

- **Spec:** §12 platform console API, §15 `TenantOnboardingWorkflow`.
- **Endpoints:** all 19 `/console/v1` endpoints (Q21, Q26).
- **Done when:** an integration test onboards a new tenant end to end, and that tenant can register a user and make a P2P payment with no code change.

## M22. Observability, security and load testing

- **Spec:** §16.
- **Done when:** dashboards show a traced request from gateway to ledger, alerts fire in a staged failure test, and k6 thresholds pass for P2P, card authorization, checkout and sockets at 3× peak.

## M23. Deployment: Docker, Helm, Terraform, Argo CD, CI/CD

- **Spec:** §1, §2 `infra/`, §16 CI/CD.
- **Done when:** a staging deployment for two tenants (one shared, one dedicated) is reproducible from Terraform + Argo CD.

## M24. End-to-end flows and hardening

- **Spec:** whole spec.
- **Done when:**
  - End-to-end API tests pass for every flow listed in Prompt 24.
  - Pact and `buf breaking` checks pass.
  - A section-by-section spec comparison shows no gaps.
  - Every milestone above is DONE, and `docs/runbook.md` exists.
