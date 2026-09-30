import confluentKafka, { type KafkaJS } from '@confluentinc/kafka-javascript';
import { SchemaRegistryClient } from '@confluentinc/schemaregistry';

export type KafkaClient = KafkaJS.Kafka;
export type Producer = KafkaJS.Producer;
export type Consumer = KafkaJS.Consumer;
export type Admin = KafkaJS.Admin;
export type KafkaMessage = KafkaJS.KafkaMessage;

export interface KafkaConnection {
  readonly brokers: readonly string[];
  readonly clientId: string;
}

export function createKafka(connection: KafkaConnection): KafkaClient {
  return new confluentKafka.KafkaJS.Kafka({
    kafkaJS: {
      brokers: [...connection.brokers],
      clientId: connection.clientId,
      logLevel: confluentKafka.KafkaJS.logLevel.ERROR,
    },
  });
}

export function createProducer(kafka: KafkaClient): Producer {
  return kafka.producer({ kafkaJS: { idempotent: true, acks: -1, allowAutoTopicCreation: false } });
}

export function createSchemaRegistry(url: string): SchemaRegistryClient {
  return new SchemaRegistryClient({ baseURLs: [url], cacheCapacity: 1000 });
}
