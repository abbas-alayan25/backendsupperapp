import type { StdTables } from '@super-app/db';
import type { Kysely } from 'kysely';
import type { Producer } from './clients.js';
import { envelopeFromOutbox } from './envelope.js';
import type { AvroEventSerde } from './serde.js';

export const DEFAULT_RELAY_BATCH_SIZE = 500;

export interface OutboxRelayOptions<DB> {
  readonly db: Kysely<DB>;
  readonly schema: string;
  readonly producer: Producer;
  readonly serde: AvroEventSerde;
  readonly batchSize?: number;
}

export class OutboxRelay<DB> {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;
  private stopped = false;

  constructor(private readonly options: OutboxRelayOptions<DB>) {}

  async runOnce(): Promise<number> {
    const db = this.options.db as unknown as Kysely<StdTables>;
    const batchSize = this.options.batchSize ?? DEFAULT_RELAY_BATCH_SIZE;
    return db.transaction().execute(async (trx) => {
      const rows = await trx
        .withSchema(this.options.schema)
        .selectFrom('outbox_events')
        .selectAll()
        .where('published_at', 'is', null)
        .orderBy('created_at')
        .orderBy('id')
        .limit(batchSize)
        .forUpdate()
        .skipLocked()
        .execute();
      if (rows.length === 0) {
        return 0;
      }
      const byTopic = new Map<
        string,
        { key: string; value: Buffer; headers: Record<string, string> }[]
      >();
      for (const row of rows) {
        const envelope = envelopeFromOutbox(row);
        const value = await this.options.serde.serialize(row.topic, envelope);
        const headers: Record<string, string> = {
          eventId: envelope.eventId,
          tenantId: envelope.tenantId,
          type: envelope.type,
        };
        const traceparent = row.headers.traceparent;
        if (traceparent) {
          headers.traceparent = traceparent;
        }
        const messages = byTopic.get(row.topic) ?? [];
        messages.push({ key: row.message_key, value, headers });
        byTopic.set(row.topic, messages);
      }
      await this.options.producer.sendBatch({
        topicMessages: [...byTopic].map(([topic, messages]) => ({ topic, messages })),
      });
      await trx
        .withSchema(this.options.schema)
        .updateTable('outbox_events')
        .set({ published_at: new Date() })
        .where(
          'id',
          'in',
          rows.map((row) => row.id),
        )
        .execute();
      return rows.length;
    });
  }

  start(intervalMs = 200, onError: (error: unknown) => void = () => undefined): void {
    this.stopped = false;
    const tick = async () => {
      let published = 0;
      try {
        published = await this.runOnce();
      } catch (error) {
        onError(error);
      }
      if (!this.stopped) {
        this.timer = setTimeout(
          () => {
            this.running = tick();
          },
          published > 0 ? 0 : intervalMs,
        );
      }
    };
    this.running = tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
}
