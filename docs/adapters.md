# Adapter Interfaces

**Status: APPROVED (2026-10-01), including the gap additions for Q51–Q57 listed in `docs/decisions.md`.**

- Interfaces and method names are exactly those in `docs/architecture.md` §3.
- BankAdapter parameters come from §8. Every other parameter and return type is drafted here and marked **(drafted)**.

## Shared conventions (drafted)

- **Construction:** an adapter is created per tenant and partner by the registry, with `AdapterContext { tenantId, partnerType, provider, config, secrets }`.
  - `config` is `tenant_adapters.config`.
  - `secrets` is read from Vault at `secret/tenants/<tenantId>/adapters/<partnerType>/<provider>` and kept in memory only.
- **Money:** always `Money { amountMinor: bigint; currency: string }`. Adapters convert to the partner's format.
- **Idempotency:** every method that moves money or creates something at the partner takes an `idempotencyKey` from the caller (a Temporal activity key or the payment id).
- **Webhooks:** `handleWebhook(payload: Buffer, signature: string)` verifies the signature against the tenant's webhook secret, rejects invalid ones with `UNAUTHENTICATED`, and returns neutral events. Each event carries the partner's event id (`partnerEventId`) for dedupe.
- **Errors:** partner failures map to `PARTNER_UNAVAILABLE` (timeouts, 5xx), `VALIDATION_FAILED` (rejected input) or a neutral domain result (e.g. `DECLINED`). An unknown outcome is never reported as a failure; it is returned as `PENDING`.
- **Simulators:** every interface has a simulator with configurable behaviours: success, failure, timeout, duplicate webhook, out-of-order webhook.

## BankAdapter

| Method                 | Signature                                                                                         | Source                    |
| ---------------------- | ------------------------------------------------------------------------------------------------- | ------------------------- |
| `verifyAccount`        | `(accountRef: BankAccountRef, holderName: string) => Promise<AccountVerification>`                | §8 params; types drafted  |
| `initiatePayout`       | `(transfer: PayoutTransfer) => Promise<PayoutSubmission>`                                         | §8 params; types drafted  |
| `getTransferStatus`    | `(railRef: string) => Promise<TransferStatusResult>`                                              | §8                        |
| `handleWebhook`        | `(payload: Buffer, signature: string) => Promise<BankEvent[]>`                                    | §8                        |
| `fetchStatement`       | `(date: string) => Promise<BankStatement[]>` (ISO date; one statement per internal account)       | §8 params; return drafted |
| `getBalance`           | `(accountId: string) => Promise<Money>` (`accountId` = the partner's internal account identifier) | §8                        |
| `createVirtualAccount` | `(userId: string) => Promise<VirtualAccount>`                                                     | §8; see A1                |

**Types (drafted):**

- `BankAccountRef { iban?: string; accountNumber?: string; bankCode?: string; currency: string }`
- `AccountVerification { status: 'VERIFIED' | 'FAILED' | 'PENDING'; holderNameOnFile?: string; nameMatches: boolean; method: 'NAME_ENQUIRY' | 'PENNY_TEST' | 'DOCUMENT' }`
- `PayoutTransfer { transferId; idempotencyKey; fromAccountId; to: BankAccountRef; beneficiaryName; amount: Money; reference; rail: 'INSTANT' | 'ACH' | 'SWIFT' | 'BOOK' }`
- `PayoutSubmission { railRef; status: 'SUBMITTED' | 'ACCEPTED' | 'SETTLED' | 'REJECTED' | 'PENDING'; failureCode? }`
- `TransferStatusResult { railRef; status: 'SUBMITTED' | 'ACCEPTED' | 'SETTLED' | 'REJECTED' | 'RETURNED' | 'PENDING'; valueDate?; failureCode? }`
- `BankEvent`, each with `partnerEventId`:
  - `CreditReceived { amount; reference; virtualAccountRef?; counterpartyName?; counterpartyIban?; valueDate; railRef }`
  - `PayoutResult { railRef; status; failureCode? }`
  - `Returned { railRef; amount; reason }`
- `BankStatement { accountId; date; opening: Money; closing: Money; lines: StatementLine[] }`
- `StatementLine { valueDate; amount; direction: 'CREDIT' | 'DEBIT'; reference; counterpartyName?; counterpartyIban? }`
- `VirtualAccount { iban; reference; currency; partnerAccountRef }`

## CardIssuerAdapter

| Method                | Signature (drafted)                                                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createCard`          | `(request: { cardId; idempotencyKey; programRef: { bin; form: 'VIRTUAL' \| 'PHYSICAL' }; cardholderName; userRef; currency; shippingAddress?: Address }) => Promise<{ processorCardToken; last4; expiryMonth; expiryYear; status: 'ISSUED' \| 'REQUESTED' }>`                                          |
| `updateStatus`        | `(processorCardToken: string, status: 'ACTIVE' \| 'FROZEN' \| 'BLOCKED' \| 'CLOSED', reason?: 'LOST' \| 'STOLEN' \| 'FRAUD' \| 'DAMAGED' \| 'ADMIN') => Promise<void>`                                                                                                                                 |
| `setControls`         | `(processorCardToken: string, controls: CardControls) => Promise<void>` (mirrors `card_controls`)                                                                                                                                                                                                      |
| `getRevealSession`    | `(processorCardToken: string) => Promise<{ sessionToken; expiresAt; sdkConfig: Record<string, string> }>`                                                                                                                                                                                              |
| `handleAuthorization` | `(payload: Buffer, signature: string, decide: (authorization: NeutralAuthorization) => Promise<AuthorizationDecision>) => Promise<{ status: number; headers: Record<string, string>; body: Buffer }>` — the adapter parses the processor message, calls `decide`, and encodes the processor's response |
| `handleClearing`      | `(input: { source: 'WEBHOOK' \| 'FILE'; content: Buffer; signature?: string }) => Promise<NeutralClearingRecord[]>`                                                                                                                                                                                    |
| `submitDispute`       | `(dispute: { disputeId; idempotencyKey; processorTransactionRef; reasonCode; amount: Money; evidence: { name; contentType; url }[] }) => Promise<{ processorDisputeId; status: 'SUBMITTED' }>`                                                                                                         |
| `provisionToken`      | `(processorCardToken: string, request: { walletProvider: 'APPLE_PAY' \| 'GOOGLE_PAY' \| 'SAMSUNG_PAY'; deviceName; certificates?: string[]; nonce?; nonceSignature? }) => Promise<{ activationData; encryptedPassData; ephemeralPublicKey }>`                                                          |

**Neutral authorization model (drafted):**

- `NeutralAuthorization` mirrors the `card_authorizations` columns: `processorAuthId`, `processorCardToken`, `authType`, `amount`, `billingAmount`, `mcc`, `merchantName`, `merchantCity`, `merchantCountry`, `entryMode`, `isEcommerce`, `threeDs`, `stan`, `rrn`, `originalProcessorAuthId?`.
- `AuthorizationDecision { decision: 'APPROVED' | 'DECLINED'; authCode?; declineCode? }`

## KycProviderAdapter

| Method            | Signature (drafted)                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createApplicant` | `(request: { applicationId; userRef; targetTier: number; person: { fullName; dob?; nationality? } }) => Promise<{ providerApplicantId }>`                                                            |
| `submitDocuments` | `(providerApplicantId: string, documents: { docType; side?: 'FRONT' \| 'BACK'; downloadUrl; contentType }[]) => Promise<void>`                                                                       |
| `getResult`       | `(providerApplicantId: string) => Promise<{ status: 'PENDING' \| 'COMPLETED'; checks: { checkType; result: 'PASS' \| 'FAIL' \| 'REVIEW'; score?: number; extracted?: Record<string, unknown> }[] }>` |
| `screenSanctions` | `(subject: { entityType: 'PERSON' \| 'BUSINESS'; fullName; dob?; nationality? }) => Promise<{ matches: { source; entryRef; score: number }[] }>`                                                     |
| `handleWebhook`   | `(payload: Buffer, signature: string) => Promise<KycProviderEvent[]>` (`ApplicantReviewed { providerApplicantId }`, `CheckCompleted { providerApplicantId; checkType }`)                             |

## AcquirerAdapter

| Method          | Signature (drafted)                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createPayment` | `(request: { paymentId; idempotencyKey; amount: Money; fundingCardToken; customerRef; returnUrl; threeDs: { deviceChannel: 'APP' \| 'BROWSER'; browserInfo?: Record<string, string> } }) => Promise<{ providerPaymentId; status: 'AUTHORIZED' \| 'REQUIRES_ACTION' \| 'DECLINED' \| 'PENDING'; action?: { type: 'REDIRECT' \| 'SDK'; url?; data?: Record<string, string> } }>` |
| `capture`       | `(providerPaymentId: string, amount: Money, idempotencyKey: string) => Promise<{ status: 'CAPTURED' \| 'PENDING' \| 'FAILED' }>`                                                                                                                                                                                                                                               |
| `refund`        | `(providerPaymentId: string, amount: Money, idempotencyKey: string) => Promise<{ providerRefundId; status: 'REFUNDED' \| 'PENDING' \| 'FAILED' }>`                                                                                                                                                                                                                             |
| `handleWebhook` | `(payload: Buffer, signature: string) => Promise<AcquirerEvent[]>` (`ThreeDsCompleted`, `Captured`, `Refunded`, `Chargeback`)                                                                                                                                                                                                                                                  |

## BillerAdapter

| Method        | Signature (drafted)                                                                                                                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listBillers` | `() => Promise<{ providerBillerCode; category; nameEn; nameAr; inquirySupported: boolean; logoUrl? }[]>`                                                                                                                                            |
| `getFields`   | `(providerBillerCode: string) => Promise<{ fieldKey; labelEn; labelAr; inputType: 'TEXT' \| 'NUMBER' \| 'PHONE' \| 'SELECT'; regex?; required: boolean; options?: string[] }[]>`                                                                    |
| `inquiry`     | `(providerBillerCode: string, fields: Record<string, string>) => Promise<{ inquiryRef; dueAmount?: Money; minAmount?: Money; maxAmount?: Money; customerName?; dueDate? }>`                                                                         |
| `pay`         | `(request: { paymentId; idempotencyKey; providerBillerCode; fields: Record<string, string>; inquiryRef?; amount: Money }) => Promise<{ providerRef; status: 'SUCCESS' \| 'PENDING' \| 'FAILED'; receipt?: Record<string, unknown>; failureCode? }>` |
| `getStatus`   | `(providerRef: string) => Promise<{ status: 'SUCCESS' \| 'PENDING' \| 'FAILED'; receipt?: Record<string, unknown>; failureCode? }>`                                                                                                                 |

## MessagingAdapter

| Method      | Signature (drafted)                                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sendOtp`   | `(request: { to: string; code: string; locale: 'ar' \| 'en'; channel: 'SMS' \| 'WHATSAPP'; purpose: 'REGISTER' \| 'LOGIN' \| 'RESET_PIN' \| 'NEW_DEVICE' \| 'STEP_UP' }) => Promise<{ providerMessageId }>` |
| `sendSms`   | `(request: { to: string; body: string; idempotencyKey: string }) => Promise<{ providerMessageId }>`                                                                                                         |
| `sendPush`  | `(request: { token: string; title: string; body: string; data?: Record<string, string>; collapseKey?: string; idempotencyKey: string }) => Promise<{ providerMessageId }>`                                  |
| `sendEmail` | `(request: { to: string; subject: string; html: string; text: string; idempotencyKey: string }) => Promise<{ providerMessageId }>`                                                                          |

## Gaps between the spec and the §3 method lists (for owner decision)

The spec has endpoints or webhooks that need a partner call, but no method in §3 covers them. I have not added methods. Each gap is listed as an open question in `docs/questions.md`.

| ID  | Spec feature                                                                                                        | Adapter            | Missing capability                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------- |
| A1  | `virtual_accounts` has `owner_type`, `owner_id`, `currency`                                                         | BankAdapter        | `createVirtualAccount(userId)` has no currency or merchant/rider owner |
| A2  | `POST /cards/{id}/pin-session`                                                                                      | CardIssuerAdapter  | No PIN session method (only `getRevealSession`)                        |
| A3  | `POST /webhooks/card-issuer/{provider}/events` (card status, token lifecycle, dispute updates) and settlement files | CardIssuerAdapter  | No general card-event webhook; `handleClearing` covers clearing only   |
| A4  | `POST /kyc/applications/{id}/liveness-session`                                                                      | KycProviderAdapter | No liveness/SDK session method                                         |
| A5  | `POST /funding-cards/session` (acquirer tokenization)                                                               | AcquirerAdapter    | No tokenization session method                                         |
| A6  | `POST /webhooks/biller/{provider}`                                                                                  | BillerAdapter      | No `handleWebhook`                                                     |
| A7  | `POST /webhooks/messaging/{provider}` (delivery receipts)                                                           | MessagingAdapter   | No `handleWebhook`                                                     |
