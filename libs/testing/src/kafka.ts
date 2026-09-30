import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';
import { freePort } from './free-port.js';

export const KAFKA_TEST_IMAGE = 'apache/kafka-native:4.3.1';
export const SCHEMA_REGISTRY_TEST_IMAGE = 'confluentinc/cp-schema-registry:8.2.4';

export interface KafkaFixture {
  readonly kafka: StartedTestContainer;
  readonly schemaRegistry: StartedTestContainer | undefined;
  readonly network: StartedNetwork;
  readonly bootstrapServers: string;
  readonly schemaRegistryUrl: string | undefined;
  stop(): Promise<void>;
}

export async function startKafka(
  options: { schemaRegistry?: boolean } = {},
): Promise<KafkaFixture> {
  const network = await new Network().start();
  const hostPort = await freePort();
  const kafka = await new GenericContainer(KAFKA_TEST_IMAGE)
    .withNetwork(network)
    .withNetworkAliases('kafka')
    .withExposedPorts({ container: 9092, host: hostPort })
    .withEnvironment({
      KAFKA_NODE_ID: '1',
      KAFKA_PROCESS_ROLES: 'broker,controller',
      KAFKA_LISTENERS: 'EXTERNAL://:9092,INTERNAL://:19092,CONTROLLER://:9093',
      KAFKA_ADVERTISED_LISTENERS: `EXTERNAL://127.0.0.1:${String(hostPort)},INTERNAL://kafka:19092`,
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP:
        'EXTERNAL:PLAINTEXT,INTERNAL:PLAINTEXT,CONTROLLER:PLAINTEXT',
      KAFKA_INTER_BROKER_LISTENER_NAME: 'INTERNAL',
      KAFKA_CONTROLLER_LISTENER_NAMES: 'CONTROLLER',
      KAFKA_CONTROLLER_QUORUM_VOTERS: '1@kafka:9093',
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: '1',
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: '1',
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: '1',
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: '0',
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: 'false',
    })
    .withWaitStrategy(Wait.forLogMessage(/Kafka Server started/))
    .withStartupTimeout(120_000)
    .start();

  let schemaRegistry: StartedTestContainer | undefined;
  if (options.schemaRegistry) {
    schemaRegistry = await new GenericContainer(SCHEMA_REGISTRY_TEST_IMAGE)
      .withNetwork(network)
      .withExposedPorts(8081)
      .withEnvironment({
        SCHEMA_REGISTRY_HOST_NAME: 'schema-registry',
        SCHEMA_REGISTRY_LISTENERS: 'http://0.0.0.0:8081',
        SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS: 'PLAINTEXT://kafka:19092',
        SCHEMA_REGISTRY_KAFKASTORE_TOPIC_REPLICATION_FACTOR: '1',
        SCHEMA_REGISTRY_SCHEMA_COMPATIBILITY_LEVEL: 'backward',
      })
      .withWaitStrategy(Wait.forHttp('/subjects', 8081).forStatusCode(200))
      .withStartupTimeout(180_000)
      .start();
  }

  return {
    kafka,
    schemaRegistry,
    network,
    bootstrapServers: `127.0.0.1:${String(hostPort)}`,
    schemaRegistryUrl: schemaRegistry
      ? `http://${schemaRegistry.getHost()}:${String(schemaRegistry.getMappedPort(8081))}`
      : undefined,
    async stop() {
      await schemaRegistry?.stop();
      await kafka.stop();
      await network.stop();
    },
  };
}
