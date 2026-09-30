import { describe, expect, it } from 'vitest';
import {
  TOPICS,
  TOPIC_NAMES,
  dlqTopic,
  isEventType,
  isTopic,
  messageKey,
  retryTopic,
} from './topics.js';

describe('topics', () => {
  it('lists the 28 spec section 15 topics plus notify.inbox', () => {
    expect(TOPIC_NAMES).toHaveLength(29);
    expect(TOPICS['tenancy.tenants']).toEqual({
      partitions: 6,
      retentionDays: 30,
      compacted: true,
    });
    expect(TOPICS['ledger.entries'].partitions).toBe(48);
  });

  it('follows the <domain>.<entity_plural> naming', () => {
    for (const topic of TOPIC_NAMES) {
      expect(topic).toMatch(/^[a-z]+\.[a-z]+$/);
    }
  });

  it('recognises topics', () => {
    expect(isTopic('payments.payments')).toBe(true);
    expect(isTopic('payments.payment')).toBe(false);
    expect(isTopic('toString')).toBe(false);
  });

  it('names retry and dead-letter topics', () => {
    expect(retryTopic('payments.payments', 0)).toBe('payments.payments.retry.1m');
    expect(retryTopic('payments.payments', 1)).toBe('payments.payments.retry.10m');
    expect(dlqTopic('payments.payments')).toBe('payments.payments.dlq');
  });

  it('builds message keys', () => {
    expect(messageKey('t1', 'u1')).toBe('t1:u1');
    expect(() => messageKey('', 'u1')).toThrow(RangeError);
    expect(() => messageKey('t1', '')).toThrow(RangeError);
  });

  it('validates event type names', () => {
    for (const valid of [
      'user.registered',
      'kyc_application.approved',
      'card_authorization.decided',
    ]) {
      expect(isEventType(valid)).toBe(true);
    }
    for (const invalid of [
      'UserRegistered',
      'user',
      'user.Registered',
      'user.registered.now',
      '',
    ]) {
      expect(isEventType(invalid)).toBe(false);
    }
  });
});
