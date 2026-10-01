# White-Label Super App — Technical Documentation

Sep 29, 2026 · @Abbas Alayan

## 1. Overview

This is the single technical reference for the platform: a white-label super app (e-wallet, payments, cards, marketplace, riders) sold to multiple clients, where each client is a **tenant** with its own brand, country, licence and partners. One codebase serves every tenant. Everything that differs between clients is tenant configuration or a swappable partner adapter, never a code branch. Every money movement posts to the tenant's double-entry ledger first and to external rails second. Backend, data, mobile, web, QA and DevOps teams all build from this document.

### Product domains

| Domain | Scope |
| --- | --- |
| Tenancy | Tenant profiles, branding, market and compliance settings, adapter selection, control plane |
| Wallet | Customer, merchant, rider and system wallets; multi-currency balances; limits by KYC tier |
| Payments | P2P, top-up, cash-in/out via agents, bill pay, QR merchant pay, request-to-pay |
| Banking | Bank account linking, bank transfers in/out, settlement and reconciliation with the tenant's partner banks |
| Cards | Virtual and physical prepaid/debit cards linked to the wallet, via the tenant's card processor |
| Marketplace | Merchants, catalog, orders, delivery, commissions, merchant payouts |
| Riders | Onboarding, dispatch, live tracking, earnings, cash-on-delivery collection |
| Identity & Risk | Auth, KYC/KYB, AML monitoring, fraud rules, sanctions screening |
| Platform | Admin portals, feature flags, SDUI home screen, notifications, reporting |

### Assumptions

- Each tenant is a licensed e-money/wallet operator or runs under a partner bank licence in its country; customer funds sit in that tenant's safeguarding accounts.
- Currencies, languages and regulators are set per tenant; the ledger supports any ISO 4217 currency with minor units.
- Card issuing goes through the tenant's licensed processor/BIN sponsor (Visa or Mastercard); the platform never stores full PAN or CVV.
- Licensed tenants get a dedicated deployment by default (section 3); pilots can share a multi-tenant cluster.
- Stack: NestJS (TypeScript) services, PostgreSQL, Kafka, Redis, Kubernetes; Flutter apps (consumer, merchant, rider) with one flavor per tenant; Next.js admin portals.

### Glossary

| Term | Meaning |
| --- | --- |
| Tenant | One white-label client: its brand, country, licence, partners and data |
| Tenant profile | Versioned configuration that defines a tenant (brand, market, compliance, adapters, products, fees) |
| Adapter | Implementation of a standard interface for one external partner (bank, card processor, KYC provider, biller) |
| Control plane | Platform-owned service and console that onboards and manages tenants and their deployments |
| Ledger account | A balance holder in the ledger (user wallet, fee income, bank clearing, card settlement) |
| Journal entry | One atomic money movement made of balanced debit/credit postings |
| Hold | Funds reserved but not yet moved (card auth, pending order) |
| Safeguarding account | Real bank account that holds the sum of a tenant's customer e-money |
| Maker-checker | An action created by one admin and approved by another |
| SDUI | Server-driven UI: app screens rendered from JSON configured in the admin portal |
| Rail | An external money network: bank transfer, card network, cash agent, biller |

## 2. System Architecture

Twelve domain services sit behind one API gateway that resolves the tenant on every request; the Ledger service is the only place balances change, and external partners are reached only through adapters chosen per tenant. The same container images run for every tenant, whether in a shared cluster or a dedicated stack.

&#91;embedded content: system architecture · 5 clients, 12 services, 5 partner types\]

Clients call the gateway, services talk to each other through gRPC for commands and Kafka for events, and every partner call goes through an adapter so a bank or provider can be swapped without touching payment logic.

### Infrastructure

| Component | Choice | Notes |
| --- | --- | --- |
| Runtime | Kubernetes (EKS/GKE) + service mesh (mTLS) | Multi-AZ; separate clusters per environment |
| Services | NestJS (TypeScript); Go optional for ledger and card auth hot paths | One repo per service or a monorepo with Nx |
| Databases | PostgreSQL 16+, one schema/cluster per service | Ledger on its own cluster with synchronous replica |
| Events | Kafka + schema registry | Outbox pattern, retry and dead-letter topics |
| Cache and locks | Redis | Sessions, flags, rate limits, idempotency keys, rider GEO |
| Files | S3-compatible object storage | KYC docs, statements, exports; SSE-KMS |
| Search | OpenSearch | Admin search across users, transactions, merchants |
| Warehouse | BigQuery or ClickHouse via CDC | Reports and BI; PII tokenized |
| Secrets and keys | Vault / cloud KMS, HSM for card-related keys if required |  |

## 3. White-Label and Multi-Tenancy

One codebase serves every client. Each client is a tenant whose brand, market, licence, partners and enabled products live in a versioned tenant profile, so onboarding a new client means configuration plus, at most, one new adapter.

### What varies per tenant

| Layer | What varies | Mechanism |
| --- | --- | --- |
| Brand | Name, logo, colors, fonts, app icon, store listing | Theme tokens in the tenant profile; one Flutter flavor per tenant; admin portal themed at runtime |
| Market | Country, currencies, languages, time zone, phone and ID formats | `market` block of the tenant profile |
| Licence and compliance | Regulator, KYC tiers, limits, AML rules, report formats, data retention | Versioned compliance profile, changed through maker-checker |
| Partners | Banks, card processor, KYC provider, billers, acquirer, SMS/push | One adapter per partner type, selected per tenant |
| Products | Wallet, cards, marketplace, bills, riders, cash agents | Feature flags scoped to the tenant |
| Commercials | Fees, commissions, FX margin, payout schedules | Per-tenant fee and limit tables |
| UI | Home screen and service layout | SDUI screens per tenant |

### Tenant profile

```json
{
  "tenantId": "acme-lb",
  "status": "ACTIVE",
  "brand": { "name": "Acme Pay", "themeTokens": "s3://brand/acme/tokens.json", "supportEmail": "support@acmepay.example" },
  "market": { "country": "LB", "currencies": ["USD", "LBP"], "defaultCurrency": "USD", "locales": ["ar", "en"], "timeZone": "Asia/Beirut" },
  "compliance": { "regulator": "central-bank-lb", "profileVersion": 7, "kycTiers": "ref:kyc-tiers-v7", "retentionYears": 5 },
  "adapters": {
    "bank": ["bank-a", "bank-b"],
    "cardIssuer": "processor-x",
    "kyc": "kyc-provider-y",
    "acquirer": "gateway-z",
    "billers": ["aggregator-1"],
    "sms": "sms-local-1"
  },
  "products": { "wallet": true, "cards": true, "marketplace": false, "bills": true, "riders": false },
  "deployment": { "model": "DEDICATED", "region": "me-central-1", "domain": "api.acmepay.example", "version": "2026.10.1" }
}
```

Partner credentials are never stored in the profile; each adapter entry points to a per-tenant secret path in Vault.

### Adapter interfaces

| Adapter | Core methods | Example implementations |
| --- | --- | --- |
| `BankAdapter` | verifyAccount, initiatePayout, getTransferStatus, handleWebhook, fetchStatement, getBalance, createVirtualAccount | Partner bank APIs, ISO 20022 / MT940 file exchange |
| `CardIssuerAdapter` | createCard, updateStatus, setControls, getRevealSession, handleAuthorization, handleClearing, submitDispute, provisionToken | Card processors such as Marqeta, Paymentology, Nymcard, or a local processor |
| `KycProviderAdapter` | createApplicant, submitDocuments, getResult, screenSanctions, handleWebhook | Sumsub, Onfido, Uqudo, or a local provider |
| `AcquirerAdapter` | createPayment (3DS), capture, refund, handleWebhook | Card top-up gateways |
| `BillerAdapter` | listBillers, getFields, inquiry, pay, getStatus | Bill aggregators, direct billers |
| `MessagingAdapter` | sendOtp, sendSms, sendPush, sendEmail | FCM, local SMS gateways, email provider |

- The core resolves an adapter from the adapter registry by `tenantId + partnerType`; domain services never import a partner SDK directly.
- Each adapter maps the partner's model to the platform's neutral model (for example, one internal card authorization model for every processor).
- Every adapter ships with a contract test suite and a simulator used in CI and staging.
- An adapter built for one tenant is reusable by any other tenant using the same partner.

### Deployment models

| Model | Isolation | Use when |
| --- | --- | --- |
| Shared multi-tenant | `tenant_id` on every row + PostgreSQL row-level security; shared cluster | Pilots, demos, clients under one licence |
| Dedicated stack (default for licensed tenants) | Own database, KMS keys, region, domain and ledger; same images | Tenant holds its own licence or data residency is required |
| Hybrid | Both models managed from one control plane | Mix of small and regulated clients |

- Every model runs the same container images and migrations; per-tenant Helm values and Terraform workspaces hold the differences.
- The ledger is always separate per licensed entity; two licensees' money never share books.
- Tenants are upgraded in waves with per-tenant version pinning and rollback.

### Control plane

A platform-owned control plane manages all tenants: onboarding wizard, tenant profile editing and versioning, adapter selection and credential references, deployment and version per tenant, cross-tenant health and usage for billing. Tenant staff never see the control plane or other tenants.

### White-label apps and web

- Flutter: one codebase with one flavor per tenant (bundle ID, icons, splash, theme, remote-config key); CI (Codemagic or Fastlane) builds and uploads each flavor to the tenant's own Apple and Google developer accounts.
- Admin portal and merchant web: the tenant is resolved from the domain; theme, logo and language load at runtime.
- Store listings, privacy policies and support contacts come from the tenant profile.

### Rules that keep the product white-label

1. No per-tenant code branches; customization only through the tenant profile, feature flags, SDUI or a new adapter.
2. Every table, event, log line, metric, cache key and file path carries `tenant_id`.
3. A new partner is a new adapter with contract tests, never logic inside a domain service.
4. Migrations are backward compatible so tenants on adjacent versions keep working during rollout.

## 4. Core Ledger

The ledger is the single source of truth for balances: no service updates a balance directly, it posts a journal entry whose debits equal its credits per currency.

### Rules

1. Amounts are stored as integers in minor units (`BIGINT`), never floats; currency is on every posting.
2. Every journal entry is balanced per currency; the ledger rejects unbalanced entries.
3. Entries are append-only. Corrections are reversal entries that reference the original, never updates or deletes.
4. Every write carries an idempotency key; a replay returns the original result.
5. Balance = sum of postings, cached in `ledger_balances` and updated in the same DB transaction with a row lock (`SELECT … FOR UPDATE`) or optimistic version.
6. Available balance = posted balance − active holds.
7. Foreign exchange posts two legs through an FX position account per currency pair, with the rate stored on the entry.

### Chart of accounts

| Account type | Examples | Normal balance |
| --- | --- | --- |
| Liability — customer funds | Customer wallet, merchant wallet, rider wallet | Credit |
| Asset — bank | Safeguarding account per bank per currency, bank clearing (in transit) | Debit |
| Asset — card | Card network settlement receivable | Debit |
| Liability — payable | Merchant payouts pending, rider payouts pending, biller payable | Credit |
| Revenue | Transfer fees, FX margin, merchant commission, interchange | Credit |
| Expense | Card processing fees, bank fees, cashback/rewards | Debit |
| Suspense | Unmatched bank credits, failed payouts, disputes | Either |

### Example: P2P transfer of 10.00 USD with 0.20 fee

| Account | Debit | Credit |
| --- | --- | --- |
| Sender wallet | 1020 |  |
| Receiver wallet |  | 1000 |
| Fee income |  | 20 |

### Holds

A hold reserves funds without moving them (card authorization, pending order, pending bank withdrawal). States: `ACTIVE → CAPTURED | RELEASED | EXPIRED`. Capture posts the journal entry and closes the hold atomically; expiry is run by a scheduler (card holds default 7 days, configurable per MCC).

### Reconciliation

- **Internal:** nightly check that the sum of all postings per currency is zero and cached balances equal recomputed balances.
- **Bank:** statement files (MT940/CAMT.053 or bank API) matched to ledger bank-clearing postings by reference, amount and date; unmatched items go to suspense and the admin exception queue.
- **Card:** processor settlement files matched to captured authorizations; interchange and fees posted from the file.
- **Safeguarding:** daily check that safeguarding bank balances ≥ total customer liabilities; a shortfall raises a P1 alert to Finance and Compliance.

## 5. Data Model

Each service owns its own PostgreSQL schema; other services read it only through APIs or events, never by joining across schemas. Every table carries `tenant_id` (non-null, first column of every composite index) and has row-level security enabled, including in dedicated stacks, so the same schema works in both deployment models. IDs are UUIDv7 (time-ordered); every table has `created_at`, `updated_at` and, where mutable, `version` for optimistic locking.

| Service | Core tables | Key fields |
| --- | --- | --- |
| tenancy | `tenants`, `tenant_profiles`, `tenant_adapters`, `tenant_domains`, `tenant_deployments` | code, status, profile\_version, market (JSONB), compliance\_profile, partner\_type, provider, secret\_ref (Vault path), domain, region, app\_version |
| identity | `users`, `credentials`, `devices`, `sessions`, `otp_challenges` | phone (E.164, unique per tenant), email, status, pin\_hash (Argon2id), device\_fingerprint, push\_token |
| kyc | `kyc_profiles`, `kyc_documents`, `kyc_checks`, `kyc_cases`, `kyb_businesses`, `kyb_ubos` | tier (0–3), status, doc\_type, s3\_key, liveness\_score, match\_score, sanctions\_hit, provider, reviewer\_id, reason\_code |
| ledger | `ledger_accounts`, `journal_entries`, `postings`, `ledger_balances`, `holds`, `fx_rates` | account\_type, owner\_id, currency, amount\_minor, direction, entry\_type, idempotency\_key, reverses\_entry\_id |
| wallet | `wallets`, `limits`, `limit_usage`, `beneficiaries` | wallet\_type, ledger\_account\_id, status (active/frozen/closed), tier\_limits, daily/monthly counters |
| payments | `payments`, `payment_events`, `payment_requests`, `qr_codes`, `bill_payments` | type, status, source/destination refs, amount, fee, fx\_rate, rail, adapter, external\_ref, failure\_code |
| banking | `linked_bank_accounts`, `bank_transfers`, `bank_statements`, `statement_lines`, `recon_matches` | bank\_adapter, iban/account\_no (encrypted), verification\_status, direction, rail\_ref, value\_date, match\_status |
| cards | `cards`, `card_programs`, `card_authorizations`, `card_transactions`, `card_disputes`, `card_controls`, `card_tokens` | issuer\_adapter, processor\_card\_token, last4, status, mcc, auth\_code, stan/rrn, hold\_id, cleared\_amount, controls |
| marketplace | `merchants`, `stores`, `products`, `orders`, `order_items`, `commissions`, `payouts`, `promotions` | merchant\_status, commission\_rate\_bps, order\_status, delivery\_fee, payout\_schedule |
| delivery | `riders`, `rider_documents`, `deliveries`, `rider_locations`, `rider_earnings`, `cod_collections` | availability, vehicle\_type, geo point (PostGIS), eta, cod\_amount |
| risk | `risk_rules`, `risk_scores`, `aml_alerts`, `aml_cases`, `sanctions_lists`, `blocklists` | rule\_expr, severity, entity\_type, decision, str\_reference |
| platform | `feature_flags`, `flag_targets`, `sdui_screens`, `sdui_versions`, `notifications`, `app_versions` | key, enabled, segment, rollout\_pct, schema\_json, publish\_status, min\_version |
| admin | `admin_users`, `roles`, `permissions`, `approval_requests`, `audit_logs` | scope (platform or tenant), role\_id, action, before/after (JSONB), maker\_id, checker\_id, reason, ip |

### Data handling rules

- PII columns (national ID number, IBAN, date of birth, address) are encrypted at application level with envelope encryption (KMS data keys) and have a separate hashed column for lookup.
- KYC images live in object storage with server-side encryption; the DB stores only the key. Access is via 5-minute signed URLs, logged.
- Card PAN/CVV never enter the platform; only the processor token and last4 are stored.
- Analytics: CDC (Debezium) streams to a warehouse (BigQuery or ClickHouse) with PII tokenized; reports read the warehouse, never production.

## 6. Identity, KYC/KYB and AML

KYC tier decides what a user can do; the tier is raised automatically on a clean check and routed to manual review when any check flags.

### Authentication

- Registration: phone OTP (SMS/WhatsApp), then 6-digit PIN and optional biometrics bound to a device key (Secure Enclave / Android Keystore).
- Tokens: short-lived JWT access token (10 min) + rotating refresh token (30 days, device-bound). Sensitive actions (payments, card reveal, adding a beneficiary) require step-up: PIN or biometric signature over the request.
- New device login triggers OTP + a 24-hour cooling period on outgoing transfers above a threshold.

### KYC tiers

| Tier | Requirements | Typical capabilities |
| --- | --- | --- |
| 0 | Phone verified | Receive only, low balance cap |
| 1 | Name, DOB, ID document OCR, selfie liveness | P2P, bill pay, marketplace, virtual card, low limits |
| 2 | Tier 1 + address proof, sanctions/PEP clear | Bank transfers, physical card, higher limits |
| 3 | Tier 2 + source of funds / enhanced due diligence | Highest limits, business-level volume |

Tier requirements and limit values come from each tenant's compliance profile, not code, so one tenant can require address proof at Tier 1 while another asks for it at Tier 2.

### KYC pipeline

1. Document capture in app → upload to object storage via pre-signed URL.
2. Provider checks (the tenant's KycProviderAdapter, e.g. Sumsub, Onfido, Uqudo or a local provider): OCR, document authenticity, liveness, face match.
3. Screening: sanctions (UN, OFAC, EU, local lists) and PEP; adverse media for Tier 3.
4. Decision engine: all pass and scores above thresholds → auto-approve; any flag → `kyc_case` in the manual queue with SLA timer.
5. Manual review in admin portal: approve / reject / request resubmission, reason code mandatory; flagged approvals need maker-checker.
6. Result event `kyc.tier_changed` updates limits and app state.

### KYB (merchants and businesses)

Company registration documents, trade licence, UBOs (each UBO goes through KYC and screening), bank account ownership check, business category (MCC) and risk rating. Merchant cannot receive payouts until KYB is `APPROVED`.

### AML and fraud monitoring

- **Real-time (pre-transaction, < 50 ms budget):** rules on velocity, amount, new device, new beneficiary, geo mismatch, blocklists. Outcomes: `ALLOW`, `CHALLENGE` (step-up), `HOLD` (manual review), `BLOCK`.
- **Post-transaction (streaming):** pattern rules on Kafka events: structuring, rapid in-out, many-to-one funnels, dormant account spikes.
- Alerts → cases in the admin portal; case outcomes feed STR/SAR filing to the financial intelligence unit and optional account freeze.
- Periodic re-screening of the full user base whenever sanctions lists update (daily job).
- Rules are stored as versioned data (JSON rule expressions) editable from the admin portal with maker-checker.

## 7. Payment Flows

Every payment runs the same pipeline: validate → limits → risk → ledger (hold or post) → external rail if any → final posting → events. The payments service orchestrates it as a saga with compensating reversals.

### Payment state machine

| From | Event | To |
| --- | --- | --- |
| `CREATED` | validation + limits pass | `RISK_CHECK` |
| `RISK_CHECK` | risk ALLOW | `AUTHORIZED` (hold placed) |
| `RISK_CHECK` | risk CHALLENGE | `PENDING_USER` (step-up) |
| `RISK_CHECK` | risk HOLD | `PENDING_REVIEW` (admin queue) |
| `RISK_CHECK` | risk BLOCK | `DECLINED` |
| `AUTHORIZED` | internal transfer or rail confirms | `COMPLETED` (hold captured, entry posted) |
| `AUTHORIZED` | rail submitted, awaiting callback | `PROCESSING` |
| `PROCESSING` | rail success / failure / timeout | `COMPLETED` / `FAILED` (hold released) / `PENDING_REVIEW` |
| `COMPLETED` | admin reversal approved | `REVERSED` (reversal entry) |
| `COMPLETED` | partial or full refund | `PARTIALLY_REFUNDED` / `REFUNDED` |

### Flow summary

| Flow | Ledger movement | External rail |
| --- | --- | --- |
| P2P | Sender wallet → receiver wallet (+ fee) | None |
| Request-to-pay | Same as P2P after payer accepts | None |
| Top-up by card | Card settlement receivable → user wallet | Acquirer 3DS payment (tokenized card) |
| Top-up by bank | Bank clearing → user wallet on confirmed credit | Bank transfer / virtual IBAN |
| Cash-in at agent | Agent wallet → user wallet | None (agent float) |
| Cash-out at agent | User wallet → agent wallet (+ fee) | None |
| Withdraw to bank | User wallet → bank clearing (hold until rail confirms) | Bank payout API |
| Bill pay | User wallet → biller payable | Biller aggregator API |
| Merchant QR pay | User wallet → merchant wallet (− commission to revenue) | None |
| Marketplace order | Hold on user wallet at checkout; capture on dispatch/delivery; split to merchant, rider, commission | None |
| Card purchase | Hold on auth; capture on clearing file | Card network via processor |

### Required behaviour for every flow

- Client sends `Idempotency-Key`; server stores key + request hash + response for 24 h.
- Limits checked against tier + custom limits (per txn, daily, monthly, count) and updated in the same transaction as the hold.
- External calls use timeouts and retries with exponential backoff; an unknown outcome is never assumed failed — it goes to `PROCESSING` and a status poller or reconciliation resolves it.
- The outbox pattern writes events in the same DB transaction as the state change; a relay publishes them to Kafka.
- Every payment has a human-readable reference shown in the app and admin portal.

Enabled flows, fees, limits and rails are resolved from the tenant profile at the start of every payment; a flow disabled for the tenant fails fast with `SERVICE_DISABLED`.

## 8. Bank Integrations

Each partner bank is integrated behind one `BankAdapter` interface (section 3), so adding a bank means writing an adapter, not changing payment logic. Each tenant selects its own banks, and one bank adapter can serve many tenants.

### Adapter interface

| Method | Purpose |
| --- | --- |
| `verifyAccount(accountRef, holderName)` | Confirm account exists and name matches (name enquiry / penny test) |
| `initiatePayout(transfer)` | Send funds from safeguarding/settlement account to a customer or merchant account |
| `getTransferStatus(railRef)` | Poll status when callbacks are late or missing |
| `handleWebhook(payload, signature)` | Receive credits, payout results, returns |
| `fetchStatement(date)` | Pull daily statement (API, SFTP MT940, or CAMT.053) |
| `getBalance(accountId)` | Safeguarding and settlement balance checks |
| `createVirtualAccount(userId)` | Optional: dedicated virtual IBAN per user for inbound top-ups |

### Connectivity patterns

- **REST/Open Banking API** where the bank offers it: mTLS + OAuth2 client credentials, signed payloads (JWS), IP allowlist.
- **Host-to-host / SFTP** for banks without APIs: PGP-encrypted batch payment files (ISO 20022 pain.001) out, status (pain.002) and statements (camt.053 / MT940) in; file jobs are idempotent by file ID.
- **Card-based top-ups** through a payment gateway/acquirer with 3DS2 and network tokenization.

### Inbound (bank → wallet)

1. Bank credit arrives via webhook or statement line with a reference or virtual IBAN.
2. Matching engine finds the user by virtual IBAN or payment reference.
3. Matched → post bank clearing → user wallet, notify user. Unmatched → suspense account + admin exception queue.

### Outbound (wallet → bank)

1. User requests withdrawal to a verified linked account; hold placed.
2. Risk check; first withdrawal to a new account may carry a cooling period.
3. Payout sent individually (instant rail) or batched per cut-off time.
4. Success → capture hold to bank clearing; failure/return → release hold or reverse, notify user.

### Settlement and safeguarding

- Daily net settlement between partner banks, card processor and the safeguarding account, calculated from ledger positions.
- Treasury view in admin portal: balance per bank per currency, in-transit amounts, pending payouts, projected liquidity for next 3 days.
- Cut-off times, holidays and value dates configured per bank.

## 9. Card Issuing

Cards are issued by each tenant's licensed processor under its BIN sponsor, behind the `CardIssuerAdapter` (section 3). The platform stays out of PCI card-data scope by holding only processor tokens and deciding authorizations from the tenant's wallet ledger ("just-in-time" funding). Processors differ in auth webhooks, 3DS, tokenization and disputes, so the cards service works on one neutral card model and each adapter maps its processor to it.

### Parties

| Party | Role |
| --- | --- |
| BIN sponsor / issuing bank | Scheme membership (Visa/Mastercard), card programme licence |
| Card processor | Card creation, PAN vault, authorization routing, 3DS, tokenization (Apple Pay / Google Pay), clearing files |
| Card manufacturer / bureau | Physical card printing and delivery (via processor) |
| Super app cards service | Card lifecycle, controls, real-time auth decision, ledger posting, disputes |

### Card lifecycle

`REQUESTED → ISSUED (virtual active) → SHIPPED (physical) → ACTIVE → FROZEN ⇄ ACTIVE → BLOCKED (lost/stolen/fraud) → REPLACED | CLOSED`

- Issuance rules (minimum KYC tier for virtual and physical cards, card programmes per segment) come from the tenant's compliance profile; the default is tier ≥ 1 for virtual and ≥ 2 for physical.
- Card details (PAN, CVV, expiry) are shown in the app through the processor's secure display SDK or iframe; they never pass through our backend.
- PIN set/change through the processor's PIN SDK or IVR.
- Card controls stored in `card_controls` and enforced at auth time: freeze, e-commerce, ATM, contactless, international, MCC blocklist, per-txn and daily limits.

### Real-time authorization (JIT funding)

1. Processor sends an authorization webhook (ISO 8583 mapped to JSON) with amount, currency, MCC, merchant, country, entry mode.
2. Cards service verifies signature, then checks card status, controls, limits, risk and available wallet balance.
3. Approve → place a hold on the wallet for the auth amount (+ FX buffer when currency differs) and return `APPROVE` with auth code; else return a decline code.
4. Hard response budget: **< 1.5 s end to end**; on our timeout the processor applies stand-in rules configured to decline or approve low amounts.
5. Incremental auths, reversals and partial reversals adjust the hold.

### Clearing and settlement

- Daily clearing file (or clearing webhooks) captures the hold at the final amount; differences from the auth are posted (tips, FX changes).
- Force posts (clearing without auth) are posted and flagged for review.
- Settlement with the processor/scheme posts to card settlement accounts; interchange revenue and scheme fees are booked from the settlement report.
- Unmatched auths expire after the hold window and are released.

### Disputes and chargebacks

User raises a dispute in the app → `card_disputes` record → submitted to processor with reason code → provisional credit per policy → outcome posts final credit or reversal. Deadlines follow scheme rules and are tracked with SLA timers.

### Tokenization and wallets

Apple Pay and Google Pay provisioning via the processor's push-provisioning SDK; token lifecycle events (created, suspended, deleted) are mirrored in `card_tokens`.

## 10. Merchants, Marketplace and Riders

Merchants and riders are wallet holders like customers, so orders, commissions, COD and payouts all settle through the same ledger.

### Merchant onboarding

1. Merchant signs up in the merchant app or is created by Ops in the admin portal.
2. KYB (section 6), settlement bank account verification, MCC and risk rating.
3. Commercial terms: commission (basis points), fees, payout schedule (daily, weekly, on demand), reserve percentage for high-risk categories.
4. Status `ACTIVE` unlocks QR payments, catalog and orders.

### Order lifecycle

`CART → PLACED (hold on customer wallet) → ACCEPTED → PREPARING → READY → PICKED_UP → DELIVERED (capture + split) | CANCELLED (release) | REJECTED (release)`

Split on delivery, one journal entry:

| Account | Movement |
| --- | --- |
| Customer wallet | Debit order total |
| Merchant wallet | Credit items total − commission |
| Rider wallet | Credit rider share of delivery fee |
| Commission revenue | Credit commission + platform share of delivery fee |

Refunds after delivery reverse the relevant legs; a merchant with insufficient balance goes negative against its reserve and is netted on the next payout.

### Merchant payouts

Scheduler builds payout batches per schedule, subtracting reserves and open disputes, then sends through the bank adapter. Payout statements are available in the merchant app and via API.

### Merchant API (for integrated merchants)

API keys per merchant (scoped, rotatable), HMAC-signed requests and webhooks: create payment intent, dynamic QR, refund, order status, payout reports.

### Riders

- Onboarding: KYC + driving licence, vehicle documents, background check status.
- Dispatch: nearest available rider by PostGIS distance and ETA; offer with timeout, then next rider.
- Live tracking: rider app sends location every 5–10 s over WebSocket/MQTT; latest position in Redis GEO, history batched to `rider_locations`.
- Earnings credited per delivery; cash-on-delivery collected is posted as a rider liability (`rider COD payable`) and settled when the rider deposits cash or it is netted from earnings.
- Rider payouts on schedule or instant withdrawal to wallet/bank.

## 11. API Standards

All external APIs are REST/JSON over HTTPS behind the API gateway, specified contract-first in OpenAPI 3.1; internal service-to-service calls use gRPC or events.

| Topic | Standard |
| --- | --- |
| Base paths | `/mobile/v1` (apps), `/merchant/v1` (merchant API), `/admin/v1` (portal), `/webhooks/{partner}` (inbound) |
| Versioning | Major version in path; additive changes only within a version; deprecation header + 6-month notice |
| Naming | Plural nouns, kebab-case paths, camelCase JSON fields |
| Money | `{ "amount": "10.00", "currency": "USD" }` as decimal string in APIs; minor units internally |
| Time | ISO 8601 UTC (`2026-09-29T13:51:00Z`) |
| Auth — mobile | Bearer JWT + device ID header; step-up signature header on sensitive calls |
| Auth — merchant | API key + HMAC-SHA256 signature over method, path, timestamp, body; 5-minute clock skew |
| Auth — admin | OIDC SSO + 2FA; permission checked per endpoint |
| Idempotency | `Idempotency-Key` header required on every POST that moves money or creates resources |
| Pagination | Cursor-based: `?limit=50&cursor=…`, response `nextCursor` |
| Filtering | `?status=COMPLETED&from=…&to=…`; sort with `?sort=-createdAt` |
| Rate limits | Per user, per device, per API key; `429` with `Retry-After` |
| Tracing | `X-Request-Id` accepted and returned; W3C `traceparent` propagated |
| Localization | \`Accept-Language: ar |

### Tenant context

- The gateway resolves the tenant from the request domain (web, merchant API) or the signed `X-Tenant-Id` claim in the app token (mobile) and rejects any mismatch between them.
- The tenant ID travels in every internal call (gRPC metadata), event envelope, log line and trace; services set it on the database session so row-level security applies.
- API keys, webhook secrets and JWT signing keys are issued per tenant; a key from one tenant is never valid for another.
- Rate limits and quotas are enforced per tenant as well as per user and API key.

### Error format

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Your balance is not enough for this payment.",
    "details": { "available": "4.50", "currency": "USD" },
    "requestId": "01J9…"
  }
}
```

Error codes are stable enums shared with mobile (e.g. `KYC_REQUIRED`, `LIMIT_EXCEEDED`, `SERVICE_DISABLED`, `ACCOUNT_FROZEN`, `STEP_UP_REQUIRED`, `RISK_DECLINED`, `DUPLICATE_REQUEST`).

### Outbound webhooks (to merchants)

- Signed with HMAC-SHA256 (`X-Signature`, `X-Timestamp`), JSON body with `eventId`, `type`, `createdAt`, `data`.
- At-least-once delivery, retries with exponential backoff for 72 h, dead-letter visible in merchant dashboard; receivers dedupe on `eventId`.

### Inbound webhooks (from banks, processor, KYC provider)

Verify signature or mTLS first, store raw payload, ACK fast (< 200 ms), process asynchronously from a queue, dedupe on the partner's event ID.

## 12. API Catalog

The endpoint list below is the scope for the OpenAPI specs; each service team owns its spec file and generates the Flutter and Next.js clients from it.

### Mobile API — `/mobile/v1`

| Domain | Method | Path | Purpose |
| --- | --- | --- | --- |
| Auth | POST | `/auth/otp/request` | Send OTP to phone |
| Auth | POST | `/auth/otp/verify` | Verify OTP, return registration or login token |
| Auth | POST | `/auth/pin` | Set or change PIN |
| Auth | POST | `/auth/token/refresh` | Rotate tokens |
| Auth | GET/DELETE | `/devices`, `/devices/{id}` | List or remove trusted devices |
| Profile | GET/PATCH | `/me` | Profile, tier, limits, flags |
| KYC | POST | `/kyc/documents/upload-url` | Pre-signed upload URL |
| KYC | POST | `/kyc/submissions` | Submit KYC for a target tier |
| KYC | GET | `/kyc/status` | Current status and required actions |
| Wallet | GET | `/wallets` | Balances per currency |
| Wallet | GET | `/wallets/{id}/transactions` | History with filters |
| Wallet | GET | `/limits` | Limits and remaining usage |
| Payments | POST | `/payments/p2p` | Send money |
| Payments | POST | `/payments/requests` | Request money |
| Payments | POST | `/payments/qr/parse` | Decode merchant/user QR |
| Payments | POST | `/payments/qr` | Pay by QR |
| Payments | GET | `/payments/{id}` | Status and receipt |
| Top-up | POST | `/topups/card` | Card top-up (returns 3DS action) |
| Top-up | GET | `/topups/bank-details` | Virtual IBAN / reference for bank top-up |
| Bank | POST/GET/DELETE | `/bank-accounts` | Link, list, unlink bank accounts |
| Bank | POST | `/withdrawals` | Withdraw to bank |
| Bills | GET | `/billers`, `/billers/{id}/fields` | Biller catalog and inputs |
| Bills | POST | `/bills/inquiry`, `/bills/pay` | Fetch due amount, pay |
| Cards | POST/GET | `/cards` | Request card, list cards |
| Cards | POST | `/cards/{id}/freeze`, `/cards/{id}/unfreeze` | Freeze controls |
| Cards | PATCH | `/cards/{id}/controls` | E-com, ATM, intl, limits |
| Cards | POST | `/cards/{id}/reveal-session` | Token for processor secure display |
| Cards | POST | `/cards/{id}/provision` | Apple Pay / Google Pay push provisioning data |
| Cards | POST | `/cards/{id}/disputes` | Raise dispute |
| Beneficiaries | POST/GET/DELETE | `/beneficiaries` | Saved recipients |
| Marketplace | GET | `/stores`, `/stores/{id}/products` | Browse |
| Marketplace | POST | `/orders` | Place order (hold) |
| Marketplace | GET | `/orders/{id}`, `/orders/{id}/tracking` | Status and live rider location |
| App | GET | `/app/config` | Feature flags, min version, maintenance |
| App | GET | `/app/screens/{screenKey}` | SDUI screen JSON for user segment |
| Notifications | POST | `/notifications/token` | Register FCM token |

### Merchant API — `/merchant/v1`

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/payment-intents` | Create payment (checkout, dynamic QR) |
| GET | `/payment-intents/{id}` | Status |
| POST | `/refunds` | Full or partial refund |
| GET/PATCH | `/orders`, `/orders/{id}` | Accept, reject, update status |
| CRUD | `/products`, `/stores` | Catalog management |
| GET | `/balance`, `/payouts`, `/reports/settlement` | Balance, payouts, settlement reports |
| CRUD | `/webhook-endpoints` | Configure webhooks |

### Rider API — `/mobile/v1/rider`

| Method | Path | Purpose |
| --- | --- | --- |
| PATCH | `/availability` | Go online/offline |
| WS | `/location` | Stream location |
| POST | `/offers/{id}/accept`, `/offers/{id}/reject` | Delivery offers |
| PATCH | `/deliveries/{id}/status` | Picked up, delivered (with proof) |
| POST | `/cod/deposits` | Record COD deposit |
| GET | `/earnings` | Earnings and payouts |

### Admin API — `/admin/v1`

| Area | Endpoints |
| --- | --- |
| Users | `GET /users`, `GET /users/{id}`, `POST /users/{id}/freeze`, `POST /users/{id}/unfreeze`, `POST /users/{id}/limits` |
| KYC | `GET /kyc/cases`, `POST /kyc/cases/{id}/assign`, `POST /kyc/cases/{id}/decision` |
| Transactions | `GET /transactions`, `POST /transactions/{id}/hold`, `POST /transactions/{id}/release`, `POST /transactions/{id}/reverse` |
| Compliance | `GET /aml/alerts`, `POST /aml/cases`, `POST /aml/cases/{id}/decision`, `CRUD /risk/rules`, `CRUD /blocklists` |
| Approvals | `GET /approvals`, `POST /approvals/{id}/approve`, `POST /approvals/{id}/reject` |
| Marketplace | `CRUD /merchants`, `POST /merchants/{id}/kyb-decision`, `CRUD /categories`, `GET /orders` |
| Riders | `CRUD /riders`, `GET /riders/live` (WS), `POST /riders/{id}/suspend` |
| Finance | `GET /reports/{type}`, `POST /reports/{type}/export`, `GET /recon/exceptions`, `POST /recon/exceptions/{id}/resolve`, `GET /treasury/positions` |
| App control | `CRUD /flags`, `CRUD /screens`, `POST /screens/{id}/versions/{v}/publish`, `CRUD /app-versions`, `POST /notifications/campaigns` |
| Admin | `CRUD /admin-users`, `CRUD /roles`, `GET /audit-logs` |

Every admin mutation that is maker-checker returns `202` with an `approvalRequestId` instead of applying immediately.

## 13. Events Catalog

Services communicate state changes through Kafka topics named `<domain>.<entity>.v1`; events are immutable facts with a schema in the schema registry (Avro or JSON Schema).

### Envelope

```json
{
  "eventId": "uuid",
  "tenantId": "acme-lb",
  "type": "payment.completed",
  "version": 1,
  "occurredAt": "2026-09-29T13:51:00Z",
  "producer": "payments-service",
  "traceId": "…",
  "subject": { "type": "payment", "id": "uuid" },
  "data": {}
}
```

| Event | Producer | Main consumers |
| --- | --- | --- |
| `user.registered`, `user.frozen`, `user.unfrozen` | identity | wallet, risk, notifications, analytics |
| `kyc.submitted`, `kyc.flagged`, `kyc.tier_changed` | kyc | wallet (limits), cards, admin, notifications |
| `ledger.entry_posted`, `ledger.hold_created`, `ledger.hold_released` | ledger | risk, reporting, notifications |
| `payment.created`, `payment.completed`, `payment.failed`, `payment.reversed` | payments | risk, notifications, loyalty, reporting |
| `bank.credit_received`, `bank.payout_completed`, `bank.payout_failed`, `recon.exception_raised` | banking | payments, finance, admin |
| `card.issued`, `card.status_changed`, `card.authorization_decided`, `card.cleared`, `card.dispute_updated` | cards | risk, notifications, reporting |
| `order.placed`, `order.status_changed`, `order.delivered`, `order.cancelled` | marketplace | payments, delivery, notifications |
| `delivery.assigned`, `delivery.location_updated`, `delivery.completed` | delivery | marketplace, app tracking |
| `risk.alert_raised`, `risk.decision_made`, `aml.case_closed` | risk | admin, compliance reporting |
| `flag.changed`, `screen.published` | platform | API gateway cache, mobile config |
| `admin.action_performed`, `approval.decided` | admin | audit store, SIEM |

### Rules

- Produce through the transactional outbox; consumers are idempotent (dedupe on `eventId`).
- Partition by tenant ID + the subject's owner ID (user, merchant) to keep per-owner ordering; consumers reject events without a tenant ID. Add \`tenant.created\`, \`tenant.profile\_changed\` and \`tenant.adapter\_changed\` from the control plane.
- Breaking changes create a new version topic; both versions run in parallel during migration.
- Failed consumption goes to a retry topic, then a dead-letter topic with alerting.

## 14. Security and Compliance

The design keeps card data out of scope, encrypts every PII field, and makes every privileged action attributable to a named person.

| Area | Control |
| --- | --- |
| PCI DSS | No PAN/CVV storage or transit (processor tokens + secure display SDK); target SAQ A-level scope for the platform; processor holds PCI DSS Level 1 |
| Encryption in transit | TLS 1.2+ everywhere, mTLS between services (service mesh) and to banks/processor |
| Encryption at rest | Disk/DB encryption + application-level envelope encryption for PII via KMS/HSM; key rotation yearly or on incident |
| Secrets | Vault or cloud secret manager; no secrets in code or images; short-lived DB credentials |
| Mobile app | Certificate pinning, root/jailbreak and emulator detection, Play Integrity / App Attest, obfuscation, secure storage for tokens, screenshot blocking on sensitive screens |
| API protection | WAF, bot protection, rate limiting, request signing for sensitive calls, replay protection by timestamp + nonce |
| Access control | Least privilege IAM, no direct production DB access; break-glass access with approval and session recording |
| Admin | SSO + 2FA, RBAC/ABAC, maker-checker, PII masking, immutable audit log (WORM storage), session timeout 15 min |
| Logging | No PII or secrets in logs (masking filters); security events to SIEM; 1-year hot + 5-year cold retention or as regulator requires |
| Fraud | Device fingerprinting, velocity rules, behavioural signals, SIM-swap check on OTP where carriers support it |
| Vulnerability management | SAST/DAST/dependency scanning in CI, container image scanning, annual penetration test + before major releases, bug bounty |
| Data protection | Data retention schedule per table (KYC and transactions per AML law, typically 5+ years after relationship end), user data export/deletion where law allows |
| Regulatory reporting | Scheduled reports per central bank / regulator format; STR/SAR to FIU; large-transaction reports; card scheme reports via processor |
| Business continuity | Documented incident response, RTO/RPO targets (section 16), regular DR drills |

### Per-tenant isolation

- Separate KMS keys, Vault paths and signing keys per tenant; one tenant's key compromise cannot expose another tenant.
- Data residency is set in the tenant profile; a dedicated stack runs in the region the regulator requires.
- Audits, penetration tests and PCI assessments can be scoped to one tenant's deployment.
- Cross-tenant access is impossible for tenant staff; platform staff access production data only through break-glass with approval, logged per tenant.

## 15. Admin Portals, Feature Flags and SDUI

There are two admin tiers: the platform console for your own team and a white-labeled tenant admin portal for each client's staff. Neither writes to domain databases directly. Both call each service's admin API, and sensitive calls go through the approvals service first.

### Admin tiers

| Tier | Users | Scope |
| --- | --- | --- |
| Platform console (control plane) | Platform staff | Tenant onboarding, tenant profiles, adapter selection, deployments and versions, cross-tenant health, usage and billing |
| Tenant admin portal | Each client's staff | Everything below, limited to that tenant, branded with the tenant's theme and domain |

### Tenant admin portal modules

| Module | Main functions |
| --- | --- |
| Overview | GMV, balances, volume and success rate, active users, pending KYC, open AML alerts, orders, live riders, system health |
| Users & Wallets | Search, 360° profile, KYC tier, ledger, limits, freeze/unfreeze, devices, login history, notes |
| KYC | Queue by status, document viewer, match score, sanctions/PEP result, manual decisions with reason codes, SLA timers, assignment |
| Transactions | Realtime feed, filters, lifecycle view, hold/release, reverse/refund, disputes, chargebacks |
| Compliance & AML | Rules builder, alert queue, case management, risk scores, STR/SAR, sanctions sync, block/allow lists |
| Reports | Settlement, reconciliation, float and liquidity, fees and revenue, payouts, regulator reports, scheduled exports |
| Marketplace | Merchants, KYB, commissions, catalog moderation, orders, promotions, categories |
| Businesses (KYB) | Verification, documents, UBOs, limits, API keys, settlement accounts |
| Riders | Onboarding, live map, availability, assignment, earnings, payouts, ratings, suspension |
| App Control Center | Feature flags, SDUI home screen builder, maintenance mode, force/soft update, push and in-app campaigns |
| Limits & Fees | Per tier, service and segment; fee tables; approval workflow |
| Support | Tickets linked to users and transactions, macros, escalations |
| Admin & Security | Staff users, roles and permissions matrix, audit log explorer, API keys, webhooks, settings |

Default tenant roles: Super Admin, Compliance Officer, KYC Agent, Finance, Support, Marketplace Ops, Rider Ops, Content/CMS, Auditor (read-only). Each tenant can adjust permissions per module and action (view, create, edit, approve, export, toggle). PII is masked by role; revealing it needs permission and a reason, and is logged.

### Maker-checker

1. Maker submits an action → `approval_requests` row with action type, payload, before/after diff, reason.
2. Eligible checkers (different person, required role, optionally a second approver above an amount) are notified.
3. Approve → approvals service calls the target service with the original payload and its idempotency key; reject → closed with comment.
4. Requests expire after a configurable window (default 24 h).

Actions requiring approval by default (each tenant can add more): flagged KYC approval, freeze/unfreeze, limit overrides, reversals and refunds above threshold, manual ledger adjustments, risk rule changes, kill-switch toggles, SDUI home publish, role changes.

### Feature flags

| Field | Example |
| --- | --- |
| key | `service.bill_pay` |
| enabled | true |
| targeting | tenant (always), country, platform, app version range, KYC tier, user segment, user ID list |
| rollout | percentage by stable hash of user ID |
| schedule | start/end time |
| disabled message | localized EN/AR text shown in app |

- Evaluated server-side and returned in `/app/config`; APIs also enforce flags, returning `SERVICE_DISABLED`, so a toggled-off service cannot be called even by an old app.
- Cached in Redis, invalidated on `flag.changed`; apps refresh config on launch, resume and via silent push.

### SDUI home screen

- `sdui_screens` holds screen keys per tenant (`home`, `services`, `marketplace_home`); `sdui_versions` holds JSON versions with status `DRAFT → PENDING_APPROVAL → PUBLISHED → ARCHIVED`.
- Schema is a list of typed sections the Flutter app knows how to render (e.g. `balance_card`, `service_grid`, `banner_carousel`, `promo_tile`, `store_list`, `recent_transactions`), each with props, actions (deep links) and targeting.
- The API resolves the right version per user segment, removes sections whose feature flag is off, and returns it with an ETag; the app caches the last good version for offline start.
- The JSON schema is versioned; the server never sends section types above the app's declared `sduiSchemaVersion`.
- Rollback = republish a previous version (one click, logged).

## 16. Operations, Testing and Delivery

Proposed targets below are starting points for the team to confirm with the business and regulator.

### Observability

- OpenTelemetry traces, metrics and logs → Grafana/Prometheus/Loki (or Datadog).
- Business dashboards: payment success rate per flow and rail, card approval rate, KYC auto-approval rate, recon exceptions, safeguarding coverage.
- Alerts on SLO burn rate, ledger imbalance (any non-zero = P1), webhook backlog, DLQ growth.

### Proposed SLOs

| Service | Target |
| --- | --- |
| Mobile API availability | 99.95% monthly |
| Card authorization decision | p99 < 500 ms, 99.99% availability |
| P2P payment p95 latency | < 800 ms |
| Ledger posting p99 | < 100 ms |
| RPO / RTO (ledger, payments) | 0–1 min / 30 min |

### Disaster recovery

Multi-AZ PostgreSQL with synchronous replica for the ledger, point-in-time recovery, cross-region backups, quarterly restore and failover drills.

### Testing

- Unit and integration tests per service; contract tests (Pact) between services and with the mobile clients.
- Ledger property tests: random flows must always leave the ledger balanced.
- Partner sandboxes and simulators for banks, processor and KYC provider, including timeouts, duplicates and out-of-order webhooks.
- Load tests at 3× forecast peak before launch; chaos tests on rail failures.
- UAT with Compliance and Finance sign-off on reports and reconciliation.

### Environments

`local → dev → staging (partner simulators and sandboxes) → pre-prod (production-like, masked data) → production`. Each dedicated tenant gets its own staging and production. Infrastructure is code (Terraform workspace + Helm values per tenant); deployments use GitOps (Argo CD) with canary releases, and tenants are upgraded in waves (internal, pilot tenants, then the rest).

### Delivery phases

| Phase | Scope |
| --- | --- |
| 0 — Platform foundation | Tenant context in every service, tenant profile, adapter registry, control plane MVP, per-tenant CI for app flavors and infrastructure |
| 1 — Core wallet (first tenant) | Identity, KYC tiers 0–1, ledger, wallet, P2P, card top-up, tenant admin portal (users, KYC queue, transactions, audit), feature flags, SDUI home |
| 2 — Banking and compliance | Bank linking, bank top-up and withdrawal, reconciliation, AML monitoring and cases, regulator reports, maker-checker everywhere |
| 3 — Marketplace | Merchants, KYB, QR pay, catalog, orders, riders, payouts, merchant API |
| 4 — Cards | First `CardIssuerAdapter`, virtual cards, JIT authorization, controls, Apple/Google Pay, physical cards, disputes |
| 5 — Second tenant | New country profile, reuse of existing adapters, dedicated stack, onboarding time measured and cut |
| 6 — Growth | More adapters (processors, KYC, billers), cash agents, loyalty/cashback, multi-currency FX, lending partners |

### Open questions

- Which country and licence model does the first tenant use (own e-money licence or partner bank), and which regulator report formats are required?
- Which partner banks, card processor and KYC provider does the first tenant use?
- Will early clients share one cluster or get dedicated stacks from the start?
- What is the target time to onboard a new tenant that reuses existing adapters?
