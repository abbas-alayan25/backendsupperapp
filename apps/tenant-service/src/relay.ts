import { createLogger } from '@super-app/common';
import { logHashKeyFromEnv } from '@super-app/nest';
import { loadConfig } from './config.js';
import { startTenancyRelay } from './events/relay-runner.js';

const config = loadConfig();
const logger = createLogger({
  service: 'tenant-service-relay',
  userIdHashKey: logHashKeyFromEnv(process.env),
  level: process.env.LOG_LEVEL,
});
const running = await startTenancyRelay({
  databaseUrl: config.relayDatabaseUrl,
  brokers: config.kafkaBrokers,
  schemaRegistryUrl: config.schemaRegistryUrl,
  logger,
});
logger.info('tenancy outbox relay started');
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void running.stop().then(() => process.exit(0));
  });
}
