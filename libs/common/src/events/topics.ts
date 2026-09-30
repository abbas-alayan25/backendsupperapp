export interface TopicSpec {
  readonly partitions: number;
  readonly retentionDays: number;
  readonly compacted: boolean;
}

export const TOPICS = {
  'tenancy.tenants': { partitions: 6, retentionDays: 30, compacted: true },
  'identity.users': { partitions: 24, retentionDays: 7, compacted: false },
  'identity.sessions': { partitions: 24, retentionDays: 7, compacted: false },
  'kyc.applications': { partitions: 24, retentionDays: 7, compacted: false },
  'kyc.cases': { partitions: 24, retentionDays: 7, compacted: false },
  'risk.decisions': { partitions: 24, retentionDays: 7, compacted: false },
  'risk.alerts': { partitions: 24, retentionDays: 7, compacted: false },
  'ledger.entries': { partitions: 48, retentionDays: 14, compacted: false },
  'ledger.holds': { partitions: 48, retentionDays: 14, compacted: false },
  'payments.payments': { partitions: 48, retentionDays: 14, compacted: false },
  'payments.requests': { partitions: 48, retentionDays: 14, compacted: false },
  'banking.transfers': { partitions: 24, retentionDays: 14, compacted: false },
  'banking.recon': { partitions: 24, retentionDays: 14, compacted: false },
  'cards.cards': { partitions: 48, retentionDays: 14, compacted: false },
  'cards.authorizations': { partitions: 48, retentionDays: 14, compacted: false },
  'cards.transactions': { partitions: 48, retentionDays: 14, compacted: false },
  'bills.payments': { partitions: 12, retentionDays: 7, compacted: false },
  'marketplace.orders': { partitions: 24, retentionDays: 7, compacted: false },
  'marketplace.products': { partitions: 24, retentionDays: 7, compacted: false },
  'delivery.deliveries': { partitions: 24, retentionDays: 7, compacted: false },
  'delivery.offers': { partitions: 24, retentionDays: 7, compacted: false },
  'delivery.locations': { partitions: 24, retentionDays: 3, compacted: false },
  'payouts.payouts': { partitions: 12, retentionDays: 14, compacted: false },
  'platform.config': { partitions: 6, retentionDays: 7, compacted: false },
  'admin.approvals': { partitions: 12, retentionDays: 30, compacted: false },
  'admin.actions': { partitions: 12, retentionDays: 30, compacted: false },
  'notify.requests': { partitions: 24, retentionDays: 3, compacted: false },
  'notify.inbox': { partitions: 24, retentionDays: 3, compacted: false },
  'ops.alerts': { partitions: 3, retentionDays: 7, compacted: false },
} as const satisfies Record<string, TopicSpec>;

export type Topic = keyof typeof TOPICS;

export const TOPIC_NAMES = Object.keys(TOPICS) as Topic[];

export const RETRY_SUFFIXES = ['retry.1m', 'retry.10m'] as const;

export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function isTopic(value: string): value is Topic {
  return Object.hasOwn(TOPICS, value);
}

export function retryTopic(topic: Topic, stage: 0 | 1): string {
  return `${topic}.${RETRY_SUFFIXES[stage]}`;
}

export function dlqTopic(topic: Topic): string {
  return `${topic}.dlq`;
}

export function messageKey(tenantId: string, ownerId: string): string {
  if (!tenantId || !ownerId || tenantId.includes(':')) {
    throw new RangeError('Message keys need a tenant id and an owner id');
  }
  return `${tenantId}:${ownerId}`;
}

export function isEventType(value: string): boolean {
  return EVENT_TYPE_PATTERN.test(value);
}
