# Open Questions

Gaps, ambiguities and contradictions found in `docs/backend-spec.md` and `docs/claude-code-build-prompts.md`. Answers are recorded in `docs/decisions.md`. The milestone column uses the numbering in `docs/roadmap.md`.

Status: **Open**, **Partial** (the build prompts answer part of it) or **Answered**.

## Summary

| ID  | Topic                                           | Status   | Blocks   |
| --- | ----------------------------------------------- | -------- | -------- |
| Q1  | Global tables, RLS bypass, cross-schema FK      | Open     | M2, M3   |
| Q2  | Partitioned tables vs unique keys and PKs       | Open     | M2, M5   |
| Q3  | Ledger balance sign convention                  | Open     | M6       |
| Q4  | Go in the monorepo, ledger data layer           | Partial  | M6       |
| Q5  | Home for NestJS bootstrap                       | Answered | —        |
| Q6  | Event type names and payloads                   | Partial  | M2, M3   |
| Q7  | Outbox routing to topic and key                 | Open     | M2       |
| Q8  | gRPC message shapes                             | Answered | —        |
| Q9  | Tenant header from the gateway                  | Answered | —        |
| Q10 | HTTP status per error code                      | Answered | —        |
| Q11 | PII crypto                                      | Answered | —        |
| Q12 | Idempotency scope and semantics                 | Open     | M2       |
| Q13 | BFF and schema ownership                        | Partial  | M20, M21 |
| Q14 | Auth parameters                                 | Partial  | M5       |
| Q15 | Tenant profile JSON shapes                      | Open     | M3       |
| Q16 | Device binding and JWKS                         | Open     | M5       |
| Q17 | Merchant staff and rider identity               | Open     | M5, M18  |
| Q18 | Partial and incremental hold capture            | Partial  | M6, M15  |
| Q19 | Who runs `holds.expire`                         | Open     | M6       |
| Q20 | Infra provisioning, app builds, deployments     | Answered | —        |
| Q21 | Who writes `tenant_usage_daily`                 | Open     | M21      |
| Q22 | `/me/close` balance check                       | Open     | M5       |
| Q23 | Wallet id in ledger events                      | Open     | M6, M14  |
| Q24 | OpenSearch indexer and loyalty consumer         | Partial  | M16      |
| Q25 | Missing admin tables (notes, settings)          | Open     | M20      |
| Q26 | Platform-level maker-checker                    | Open     | M21      |
| Q27 | Push token ownership                            | Open     | M14      |
| Q28 | `/contacts/match` ownership                     | Open     | M7       |
| Q29 | Risk rule expression format                     | Partial  | M8       |
| Q30 | KYC tier source of truth                        | Partial  | M9       |
| Q31 | Cash-out code table                             | Open     | M11      |
| Q32 | Missing merchant tables                         | Open     | M18      |
| Q33 | Webhook tenant path secret                      | Open     | M4       |
| Q34 | Error code for unexpected errors                | Answered | —        |
| Q35 | Architecture document referenced by the prompts | Open     | M2, M3   |
| Q36 | New-device cooling-period flag has no column    | Open     | M5       |
| Q37 | Kong JWT validation vs service JWT validation   | Open     | M4       |
| Q38 | Event naming convention beyond tenancy          | Open     | M2       |

## Data model and tenancy

- **Q1. Global tables and RLS.** §3 says RLS on every table, but `tenancy.tenants`, `admin.permissions`, `risk.sanctions_lists` and `risk.sanctions_entries` have no `tenant_id`, and `admin_users.tenant_id` is null for PLATFORM staff. What policy applies to these? How do cross-tenant jobs and console reads (`ListActiveTenants`, `/health/tenants`, `/usage`, `holds.expire`, `recon.daily`) bypass RLS: a separate DB role with `BYPASSRLS`, or looping per tenant? §3 makes `tenant_id` an FK to `tenancy.tenants`, which needs every schema in one database and conflicts with "no service reads another service's tables". Is it a real cross-schema FK or a logical reference? For DEDICATED tenants, is it one database per tenant stack?
- **Q2. Partitioning vs unique keys.** Postgres requires the partition key in every unique constraint on a partitioned table. `journal_entries unique(tenant_id, idempotency_key)`, `card_authorizations unique(tenant_id, processor_auth_id, auth_type)` and `notifications unique(tenant_id, event_id, channel)` cannot be enforced globally once partitioned by month, and `id` alone cannot be the PK. Options: include `created_at` in the keys and enforce idempotency in a separate non-partitioned table, or partition differently. `login_events` and `risk_decisions` are marked partitioned but are missing from the §3 list. Tables that declare their own PK (`ledger_balances`, `role_permissions`, `admin_user_roles`, `card_controls`): do they still get the standard `id` column?
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

- **Q6. Event type names and payloads.** Partial: Prompt 2 defines the envelope (`eventId, tenantId, type, version, occurredAt, producer, traceId, subject, data`), and Prompt 3 names the tenancy events (`tenant.created`, `tenant.profile_changed`, `tenant.adapter_changed`). Still open: event types and `data` schemas for every other topic.
- **Q7. Outbox routing.** `outbox_events` has no topic or key column. Should the topic come from `aggregate_type` (e.g. `identity.users`), and should the Kafka key `tenantId:ownerId` come from `aggregate_id` or a header?
- **Q23.** `wallet.balance_updated` needs `walletId`, but its source `ledger.entries` knows only the ledger `account_id`. Should ledger events carry `owner_type/owner_id`, or should the gateway map accounts to wallets?
- **Q29.** Partial: Prompt 8 calls for a JSON rule expression engine with named conditions and actions. Still open: the exact JSON grammar (JSONLogic or a custom tree).
- **Q33.** §13 resolves the webhook tenant "from the webhook domain or a tenant-scoped path secret", but the path is `/webhooks/{partnerType}/{provider}` with no secret segment. What is the path format?
- **Q35.** Prompts 2 and 3 refer to "the architecture" document (event envelope, adapter interface methods), and it is not in the repo. The envelope fields are listed in Prompt 2, but adapter methods are not listed anywhere. Please add the architecture document, or approve interfaces I draft.
- **Q38.** Prompt 3's names use `<entity>.<past_tense_verb>`. Should every topic follow the same convention (e.g. `user.registered`, `payment.completed`), with the full list drafted per service for approval?

## API behaviour and security

- **Q12. Idempotency.** §9 requires `Idempotency-Key` on POSTs that move money or create a resource, while CLAUDE.md in Prompt 0 says "every money-moving POST". The current CLAUDE.md follows §9 (the wider rule). Confirm. When is `DUPLICATE_REQUEST` returned vs `CONFLICT`? How do `idempotency_keys.locked_until` and the Redis lock relate? Which gRPC metadata key carries the idempotency key?
- **Q14. Auth parameters.** Partial: Prompt 5 sets access tokens to 10 min, refresh tokens to 30 days (rotating, device-bound, stored hashed) and step-up tokens to 2 min, single use. Still open: OTP length, TTL, max attempts and resend cooldown; PIN length and lockout threshold and duration; registration-token format and TTL; rate-limit windows per endpoint.
- **Q16. Device binding.** Key algorithm for `devices.public_key`; what the device signs at login and step-up (there is no challenge or nonce endpoint); how the client computes the step-up request hash; where auth-service publishes its JWKS and how EdDSA keys rotate.
- **Q18.** Partial: Prompt 15 says clearing captures holds at the final amount. Still open: capture above the held amount, partial capture of ledger holds, and whether the remainder is released.
- **Q37.** Prompt 4 has Kong validate JWTs and pass verified claims as headers, while Prompt 2's `libs/auth` verifies JWTs in services. Should services verify the JWT again (defence in depth, planned default), or trust the gateway headers over mTLS?

## Answered

Q5, Q8, Q9, Q10, Q11, Q20 and Q34 are answered; see `docs/decisions.md`.
