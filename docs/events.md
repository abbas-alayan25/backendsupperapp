# Event Catalogue

**Status: APPROVED (delegated, 2026-09-30).** The owner may still change any _(proposed)_ entry. New event types are added here before code emits them.

This catalogue lists every Kafka topic from spec §15 with its producer, consumers, message key and event types, and the socket events in spec §14 that each topic feeds.

- Event types marked **(owner)** come from the owner's examples in decisions Q38.
- Types marked _(proposed)_ are mine, following the same convention, and need approval.
- Items that depend on open questions carry their `Q<n>`.
- Producers, consumers, partitions and retention are copied from §15. Where §15 groups two topics in one row, both topics show that row's full consumer list.

## Conventions (decided)

| Item          | Rule                                                                                                                      | Source         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Topic         | `<domain>.<entity_plural>`, exactly as §15                                                                                | Q38            |
| Event type    | `<aggregate>.<past_tense_verb>`, snake_case, singular aggregate                                                           | Q38            |
| Message key   | `<tenantId>:<ownerId>`, where `ownerId` is the owner whose events must stay in order                                      | Q7             |
| Value         | Envelope: `eventId`, `tenantId`, `type`, `version`, `occurredAt`, `producer`, `traceId`, `subject {type, id}`, `data`     | Q7 (Q43 open)  |
| Headers       | `eventId`, `tenantId`, `type`, `traceparent`                                                                              | Q7             |
| Schemas       | Avro, `TopicRecordNameStrategy`, one record per event type, backward compatible; `version` = that record's schema version | Q38 (Q44 open) |
| Retry and DLQ | `<topic>.retry.1m`, `<topic>.retry.10m`, `<topic>.dlq` for every topic                                                    | §15            |
| Cluster       | Replication 3, `min.insync.replicas` 2, `acks=all`, idempotent producers                                                  | §15            |

**Proposed Avro naming:**

- Record namespace `superapp.events.<domain>`; record name = the event type in PascalCase. For example, `payment.completed` on `payments.payments` becomes `superapp.events.payments.PaymentCompleted`.
- Subject = `payments.payments-superapp.events.payments.PaymentCompleted`.

## Topics

### `tenancy.tenants`

- **Producer:** tenant-service.
- **Consumers:** all services (cache invalidation of `t:{tid}:profile`).
- **Partitions / retention:** 6 / 30 days, compacted.
- **Key:** `<tenantId>:<tenantId>`.
- **Event types:**
  - owner: `tenant.created`, `tenant.profile_changed`, `tenant.adapter_changed`
  - proposed: `tenant.suspended`, `tenant.reactivated`, `tenant.offboarded`, `tenant.domain_changed`

### `identity.users`

- **Producer:** auth-service.
- **Consumers:** risk, notification, realtime, reporting.
- **Partitions / retention:** 24 / 7 days.
- **Key:** `<tenantId>:<userId>`.
- **Event types:**
  - owner: `user.registered`, `user.frozen`
  - proposed: `user.profile_updated`, `user.unfrozen`, `user.blocked`, `user.closed`, `device.registered`, `device.revoked`, `pin.changed`, `pin.reset`

### `identity.sessions`

- **Producer:** auth-service.
- **Consumers:** risk, notification, realtime, reporting.
- **Partitions / retention:** 24 / 7 days.
- **Key:** `<tenantId>:<userId>`.
- **Event types:**
  - owner: `session.revoked`
  - proposed: `session.created`, `login.failed`
- **Socket:** `/app` `session.revoked`.

### `kyc.applications`

- **Producer:** kyc-service.
- **Consumers:** wallet (limits), cards, realtime, notification, audit. Also auth-service for the tier (Q30), and marketplace for KYB (Q49).
- **Partitions / retention:** 24 / 7 days.
- **Key:** `<tenantId>:<userId>`; `<tenantId>:<businessId>` for KYB.
- **Event types:**
  - owner: `kyc_application.submitted`, `kyc_application.approved`, `kyc_tier.changed`
  - proposed: `kyc_application.rejected`, `kyc_application.resubmit_requested`
  - proposed for KYB (Q49): `business.submitted`, `business.approved`, `business.rejected`, `business.suspended`
- **Socket:** `/app` `kyc.status_changed`.

### `kyc.cases`

- **Producer:** kyc-service.
- **Consumers:** wallet (limits), cards, realtime, notification, audit.
- **Partitions / retention:** 24 / 7 days.
- **Key:** `<tenantId>:<applicationId>`.
- **Event types:** proposed: `kyc_case.created`, `kyc_case.assigned`, `kyc_case.decided`.
- **Socket:** `/admin` `kyc.case_created`.

### `risk.decisions`

- **Producer:** risk-service.
- **Consumers:** admin realtime, reporting.
- **Partitions / retention:** 24 / 7 days.
- **Key:** `<tenantId>:<subjectId>`.
- **Event types:** proposed: `risk_decision.recorded`.

### `risk.alerts`

- **Producer:** risk-service.
- **Consumers:** admin realtime, reporting.
- **Partitions / retention:** 24 / 7 days.
- **Key:** `<tenantId>:<entityId>`.
- **Event types:** proposed: `aml_alert.created`, `aml_alert.triaged`, `aml_case.opened`, `aml_case.decided`, `screening_result.created`.
- **Socket:** `/admin` `aml.alert_created`.

### `ledger.entries`

- **Producer:** ledger-service.
- **Consumers:** realtime (balances), risk (post-transaction), reporting, notification.
- **Partitions / retention:** 48 / 14 days.
- **Key:** `<tenantId>:<ownerId>` of the account owner (Q23; one entry touches several accounts).
- **Event types:** owner: `ledger_entry.posted`. proposed: `ledger_entry.reversed`.
- **Socket:** `/app` `wallet.balance_updated` (needs `walletId`, Q23).

### `ledger.holds`

- **Producer:** ledger-service.
- **Consumers:** realtime, risk, reporting, notification.
- **Partitions / retention:** 48 / 14 days.
- **Key:** `<tenantId>:<ownerId>` of the held account (Q23).
- **Event types:** owner: `hold.created`, `hold.captured`, `hold.released`. proposed: `hold.expired`.

### `payments.payments`

- **Producer:** payments-service.
- **Consumers:** risk, notification, realtime, loyalty (Q24), reporting.
- **Partitions / retention:** 48 / 14 days.
- **Key:** `<tenantId>:<payerUserId>`, or `<tenantId>:<payeeOwnerId>` when there is no payer (top-ups, inbound).
- **Event types:**
  - owner: `payment.created`, `payment.completed`, `payment.failed`, `payment.reversed`, `payment.refunded`
  - proposed: `payment.authorized`, `payment.declined`, `payment.held_for_review`, `payment.partially_refunded`, `payment_dispute.opened`, `payment_dispute.resolved`
- **Sockets:** `/app` `payment.status_changed`, `/merchant` `payment.received`, `/admin` `txn.feed`.

### `payments.requests`

- **Producer:** payments-service.
- **Consumers:** risk, notification, realtime, loyalty (Q24), reporting.
- **Partitions / retention:** 48 / 14 days.
- **Key:** `<tenantId>:<payerUserId>`.
- **Event types:** proposed: `payment_request.created`, `payment_request.paid`, `payment_request.declined`, `payment_request.cancelled`, `payment_request.expired`.
- **Socket:** `/app` `payment_request.received`.

### `banking.transfers`

- **Producer:** banking-service.
- **Consumers:** payments, payouts, finance alerts, reporting.
- **Partitions / retention:** 24 / 14 days.
- **Key:** `<tenantId>:<ownerId>` of the linked or virtual account.
- **Event types:** proposed: `bank_transfer.submitted`, `bank_transfer.settled`, `bank_transfer.rejected`, `bank_transfer.returned`, `inbound_credit.matched`, `inbound_credit.unmatched`, `linked_account.verified`.

### `banking.recon`

- **Producer:** banking-service.
- **Consumers:** payments, payouts, finance alerts, reporting.
- **Partitions / retention:** 24 / 14 days.
- **Key:** `<tenantId>:<partnerId>`.
- **Event types:** proposed: `recon_run.completed`, `recon_exception.raised`, `recon_exception.resolved`.

### `cards.cards`

- **Producer:** cards-service.
- **Consumers:** risk, notification, realtime, reporting.
- **Partitions / retention:** 48 / 14 days.
- **Key:** `<tenantId>:<userId>`.
- **Event types:**
  - owner: `card.issued`, `card.status_changed`
  - proposed: `card.requested`, `card.activated`, `card.replaced`, `card.shipped`, `card_token.provisioned`, `card_token.status_changed`

### `cards.authorizations`

- **Producer:** cards-service (written by cards-auth).
- **Consumers:** risk, notification, realtime, reporting.
- **Partitions / retention:** 48 / 14 days.
- **Key:** `<tenantId>:<cardId>`.
- **Event types:** owner: `card_authorization.decided`. proposed: `card_authorization.reversed`.
- **Socket:** `/app` `card.transaction`.

### `cards.transactions`

- **Producer:** cards-service.
- **Consumers:** risk, notification, realtime, reporting.
- **Partitions / retention:** 48 / 14 days.
- **Key:** `<tenantId>:<cardId>`.
- **Event types:**
  - owner: `card_transaction.cleared`
  - proposed: `card_transaction.reversed`, `card_transaction.refunded`, `card_dispute.opened`, `card_dispute.resolved`, `card_settlement.posted`

### `bills.payments`

- **Producer:** bills-service.
- **Consumers:** notification, reporting.
- **Partitions / retention:** 12 / 7 days.
- **Key:** `<tenantId>:<userId>`.
- **Event types:** proposed: `bill_payment.pending`, `bill_payment.completed`, `bill_payment.failed`.

### `marketplace.orders`

- **Producer:** marketplace-service.
- **Consumers:** payments, delivery, notification, realtime, search indexer.
- **Partitions / retention:** 24 / 7 days.
- **Key:** `<tenantId>:<orderId>`.
- **Event types:**
  - owner: `order.placed`, `order.accepted`, `order.delivered`, `order.cancelled`
  - proposed: `order.rejected`, `order.preparing`, `order.ready`, `order.picked_up`, `review.submitted`
- **Sockets:** `/app` `order.status_changed`; `/merchant` `order.new`, `order.cancelled`; `/rider` `order.ready`.

### `marketplace.products`

- **Producer:** marketplace-service.
- **Consumers:** payments, delivery, notification, realtime, search indexer.
- **Partitions / retention:** 24 / 7 days.
- **Key:** `<tenantId>:<productId>`, or `<tenantId>:<storeId>` for store events.
- **Event types:** proposed: `product.created`, `product.updated`, `product.moderated`, `product.stock_changed`, `product.archived`, `store.updated`. Store events are here because `/search` covers stores and no other topic carries them.

### `delivery.deliveries`

- **Producer:** delivery-service.
- **Consumers:** marketplace, notification, realtime.
- **Partitions / retention:** 24 / 7 days.
- **Key:** `<tenantId>:<orderId>`.
- **Event types:**
  - owner: `delivery.assigned`, `delivery.completed`
  - proposed: `delivery.created`, `delivery.rider_arriving`, `delivery.picked_up`, `delivery.failed`, `delivery.cancelled`
- **Sockets:** `/merchant` `rider.assigned`, `rider.arriving`; `/rider` `delivery.cancelled`.

### `delivery.offers`

- **Producer:** delivery-service.
- **Consumers:** marketplace, notification, realtime.
- **Partitions / retention:** 24 / 7 days.
- **Key:** `<tenantId>:<riderId>`.
- **Event types:** proposed: `delivery_offer.sent`, `delivery_offer.accepted`, `delivery_offer.rejected`, `delivery_offer.expired`.
- **Sockets:** `/rider` `offer.new`, `offer.expired`.

### `delivery.locations`

- **Producer:** realtime-gateway, batched and without an outbox (Q48).
- **Consumers:** delivery (history), reporting.
- **Partitions / retention:** 24 / 3 days.
- **Key:** `<tenantId>:<riderId>`.
- **Event types:** proposed: `rider_location.recorded` (one event per batch).

### `payouts.payouts`

- **Producer:** payouts-service.
- **Consumers:** notification, realtime, reporting.
- **Partitions / retention:** 12 / 14 days.
- **Key:** `<tenantId>:<ownerId>` (merchant or rider).
- **Event types:**
  - owner: `payout.paid`
  - proposed: `payout.created`, `payout.sent`, `payout.failed`, `payout.returned`, `payout_batch.completed`
- **Socket:** `/merchant` `payout.status_changed`.

### `platform.config`

- **Producer:** platform-service.
- **Consumers:** realtime (`config.changed`), gateway caches.
- **Partitions / retention:** 6 / 7 days.
- **Key:** `<tenantId>:<tenantId>`.
- **Event types:**
  - owner: `flag.changed`, `screen.published`
  - proposed: `screen.rolled_back`, `app_version.released`, `maintenance_window.scheduled`, `translation.changed`
- **Socket:** `/app` `config.changed`.

### `admin.approvals`

- **Producer:** admin-bff.
- **Consumers:** audit-service, realtime, target services.
- **Partitions / retention:** 12 / 30 days.
- **Key:** `<tenantId>:<approvalRequestId>`.
- **Event types:** owner: `approval.requested`, `approval.decided`. proposed: `approval.executed`, `approval.expired`.
- **Socket:** `/admin` `approval.requested`, `approval.decided`.

### `admin.actions`

- **Producer:** admin-bff.
- **Consumers:** audit-service, realtime, target services.
- **Partitions / retention:** 12 / 30 days.
- **Key:** `<tenantId>:<adminUserId>`.
- **Event types:** proposed: `admin_action.performed`, `pii.revealed`.

### `notify.requests`

- **Producer:** any service.
- **Consumers:** notification-service.
- **Partitions / retention:** 24 / 3 days.
- **Key:** `<tenantId>:<userId>`.
- **Event types:** proposed: `notification.requested`.

### `ops.alerts`

- **Producer:** recon jobs, monitors.
- **Consumers:** realtime `/admin`, on-call paging.
- **Partitions / retention:** 3 / 7 days.
- **Key:** `<tenantId>:<source>`.
- **Event types:** proposed: `system_alert.raised`, `ledger_imbalance.detected`.
- **Socket:** `/admin` `system.alert`.

### `notify.inbox` — not in §15 (Q47)

- **Proposed producer:** notification-service.
- **Proposed consumer:** realtime-gateway.
- **Key:** `<tenantId>:<userId>`.
- **Event types:** proposed: `inbox_message.created`.
- **Socket:** `/app` `notification.new`.

## Not Kafka topics

- **Redis channel `rider:loc`:** carries rider positions (client → gateway → Redis → subscribers). It feeds the `/app` `delivery.location` and `/admin` `riders.positions` socket events and is outside this catalogue (§14).
- **Merchant webhook events** (§11): `payment_intent.succeeded`, `payment_intent.failed`, `refund.succeeded`, `refund.failed`, `order.placed`, `order.cancelled`, `payout.paid`, `payout.failed`. These are outbound HTTP events produced by the `webhooks.merchant` queue, not Kafka event types; their names come from the spec.
