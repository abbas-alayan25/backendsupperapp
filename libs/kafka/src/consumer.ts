import { type Topic, dlqTopic, isUuid, retryTopic, runWithContext } from '@super-app/common';
import { processOnce, withTenant } from '@super-app/db';
import type { Kysely, Transaction } from 'kysely';
import type { Consumer, KafkaClient, KafkaMessage, Producer } from './clients.js';
import type { EventEnvelope } from './envelope.js';
import type { AvroEventSerde } from './serde.js';

export const DEFAULT_RETRY_DELAYS_MS = [60_000, 600_000] as const;
export const RETRY_NOT_BEFORE_HEADER = 'retry-not-before';
export const RETRY_ATTEMPT_HEADER = 'retry-attempt';
export const LAST_ERROR_HEADER = 'last-error';

export type EventHandler<DB> = (envelope: EventEnvelope, trx: Transaction<DB>) => Promise<void>;

export interface EventConsumerOptions<DB> {
  readonly kafka: KafkaClient;
  readonly producer: Producer;
  readonly groupId: string;
  readonly topic: Topic;
  readonly db: Kysely<DB>;
  readonly schema: string;
  readonly serde: AvroEventSerde;
  readonly handlers: Readonly<Record<string, EventHandler<DB>>>;
  readonly retryDelaysMs?: readonly [number, number];
  readonly onError?: (error: unknown, envelope: EventEnvelope | undefined) => void;
}

export interface FailureRoute {
  topic: string;
  notBefore: number | undefined;
  attempt: number;
}

export function failureRoute(
  topic: Topic,
  stage: 0 | 1 | 2,
  now: number,
  delays: readonly [number, number] = DEFAULT_RETRY_DELAYS_MS,
): FailureRoute {
  if (stage === 0) {
    return { topic: retryTopic(topic, 0), notBefore: now + delays[0], attempt: 1 };
  }
  if (stage === 1) {
    return { topic: retryTopic(topic, 1), notBefore: now + delays[1], attempt: 2 };
  }
  return { topic: dlqTopic(topic), notBefore: undefined, attempt: 3 };
}

function header(message: KafkaMessage, name: string): string | undefined {
  const value = message.headers?.[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined ? undefined : first.toString();
}

function describeError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
  return text.slice(0, 200);
}

export class EventConsumer<DB> {
  private consumer: Consumer | undefined;

  constructor(private readonly options: EventConsumerOptions<DB>) {}

  async start(): Promise<void> {
    const { topic } = this.options;
    const consumer = this.options.kafka.consumer({
      kafkaJS: { groupId: this.options.groupId, fromBeginning: true, autoCommit: true },
    });
    this.consumer = consumer;
    await consumer.connect();
    await consumer.subscribe({ topics: [topic, retryTopic(topic, 0), retryTopic(topic, 1)] });
    await consumer.run({
      eachMessage: async (payload) => {
        await this.handle(payload.topic, payload.message, () => payload.heartbeat());
      },
    });
  }

  async stop(): Promise<void> {
    const consumer = this.consumer;
    this.consumer = undefined;
    await consumer?.disconnect();
  }

  private stageOf(source: string): 0 | 1 | 2 {
    const { topic } = this.options;
    if (source === retryTopic(topic, 0)) return 1;
    if (source === retryTopic(topic, 1)) return 2;
    return 0;
  }

  private async waitUntil(notBefore: number, heartbeat: () => Promise<void>): Promise<void> {
    while (Date.now() < notBefore) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(notBefore - Date.now(), 3_000)));
      await heartbeat();
    }
  }

  private async handle(source: string, message: KafkaMessage, heartbeat: () => Promise<void>) {
    const stage = this.stageOf(source);
    const notBefore = Number(header(message, RETRY_NOT_BEFORE_HEADER) ?? 0);
    if (notBefore > Date.now()) {
      await this.waitUntil(notBefore, heartbeat);
    }
    const eventType = header(message, 'type') ?? '';
    let envelope: EventEnvelope | undefined;
    try {
      if (!message.value) {
        throw new Error('Message has no value');
      }
      envelope = await this.options.serde.deserialize(this.options.topic, eventType, message.value);
      const handler = this.options.handlers[envelope.type];
      if (!handler) {
        return;
      }
      if (!isUuid(envelope.tenantId)) {
        throw new Error('Event has no valid tenant');
      }
      const current = envelope;
      await runWithContext(
        { tenantId: current.tenantId, requestId: current.eventId, locale: 'en' },
        () =>
          withTenant(this.options.db, current.tenantId, (trx) =>
            processOnce(
              trx,
              {
                schema: this.options.schema,
                eventId: current.eventId,
                topic: this.options.topic,
                tenantId: current.tenantId,
              },
              () => handler(current, trx),
            ),
          ),
      );
    } catch (error) {
      this.options.onError?.(error, envelope);
      await this.routeFailure(stage, message, error);
    }
  }

  private async routeFailure(stage: 0 | 1 | 2, message: KafkaMessage, error: unknown) {
    const route = failureRoute(this.options.topic, stage, Date.now(), this.options.retryDelaysMs);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(message.headers ?? {})) {
      const first = Array.isArray(value) ? value[0] : value;
      if (first !== undefined && name !== RETRY_NOT_BEFORE_HEADER) {
        headers[name] = first.toString();
      }
    }
    headers[RETRY_ATTEMPT_HEADER] = String(route.attempt);
    headers[LAST_ERROR_HEADER] = describeError(error);
    if (route.notBefore !== undefined) {
      headers[RETRY_NOT_BEFORE_HEADER] = String(route.notBefore);
    }
    await this.options.producer.send({
      topic: route.topic,
      messages: [{ key: message.key ?? null, value: message.value, headers }],
    });
  }
}
