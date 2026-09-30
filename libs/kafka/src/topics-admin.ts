import { TOPICS, type Topic, dlqTopic, retryTopic } from '@super-app/common';
import type { Admin } from './clients.js';

export const DLQ_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

export interface TopicProvisioningOptions {
  readonly replicationFactor: number;
  readonly minInsyncReplicas?: number;
  readonly partitionsOverride?: number;
}

export interface TopicConfig {
  topic: string;
  numPartitions: number;
  replicationFactor: number;
  configEntries: { name: string; value: string }[];
}

export function topicConfigs(
  topics: readonly Topic[],
  options: TopicProvisioningOptions,
): TopicConfig[] {
  return topics.flatMap((topic) => {
    const spec = TOPICS[topic];
    const partitions = options.partitionsOverride ?? spec.partitions;
    const common = [
      ...(options.minInsyncReplicas
        ? [{ name: 'min.insync.replicas', value: String(options.minInsyncReplicas) }]
        : []),
    ];
    const retention = (days: number) => ({ name: 'retention.ms', value: String(days * DAY_MS) });
    const base: TopicConfig = {
      topic,
      numPartitions: partitions,
      replicationFactor: options.replicationFactor,
      configEntries: [
        ...common,
        retention(spec.retentionDays),
        { name: 'cleanup.policy', value: spec.compacted ? 'compact,delete' : 'delete' },
      ],
    };
    const derived = (name: string, days: number): TopicConfig => ({
      topic: name,
      numPartitions: partitions,
      replicationFactor: options.replicationFactor,
      configEntries: [...common, retention(days), { name: 'cleanup.policy', value: 'delete' }],
    });
    return [
      base,
      derived(retryTopic(topic, 0), spec.retentionDays),
      derived(retryTopic(topic, 1), spec.retentionDays),
      derived(dlqTopic(topic), DLQ_RETENTION_DAYS),
    ];
  });
}

export async function ensureTopics(
  admin: Admin,
  topics: readonly Topic[],
  options: TopicProvisioningOptions,
): Promise<string[]> {
  const existing = new Set(await admin.listTopics());
  const missing = topicConfigs(topics, options).filter((config) => !existing.has(config.topic));
  if (missing.length > 0) {
    await admin.createTopics({ topics: missing });
  }
  return missing.map((config) => config.topic);
}
