import type { Logger } from '@super-app/common';
import { type StdTables, createDatabase } from '@super-app/db';
import {
  AvroEventSerde,
  OutboxRelay,
  createKafka,
  createProducer,
  createSchemaRegistry,
  registerCatalog,
} from '@super-app/kafka';
import { TENANCY_SCHEMA } from '../db/migration-sql.js';
import { tenancyCatalog } from './catalog.js';

export interface RelayRunnerOptions {
  readonly databaseUrl: string;
  readonly brokers: readonly string[];
  readonly schemaRegistryUrl: string;
  readonly logger: Logger;
  readonly intervalMs?: number;
}

export interface RunningRelay {
  readonly relay: OutboxRelay<StdTables>;
  stop(): Promise<void>;
}

export async function startTenancyRelay(options: RelayRunnerOptions): Promise<RunningRelay> {
  const catalog = tenancyCatalog();
  const registry = createSchemaRegistry(options.schemaRegistryUrl);
  await registerCatalog(registry, catalog);
  const kafka = createKafka({ brokers: options.brokers, clientId: 'tenant-service-relay' });
  const producer = createProducer(kafka);
  await producer.connect();
  const db = createDatabase<StdTables>({
    connectionString: options.databaseUrl,
    applicationName: 'tenant-service-relay',
    maxConnections: 2,
  });
  const relay = new OutboxRelay<StdTables>({
    db,
    schema: TENANCY_SCHEMA,
    producer,
    serde: new AvroEventSerde(registry, catalog),
  });
  relay.start(options.intervalMs ?? 200, (error) => {
    options.logger.error({ err: error }, 'outbox relay batch failed');
  });
  return {
    relay,
    stop: async () => {
      await relay.stop();
      await producer.disconnect();
      await db.destroy();
    },
  };
}
