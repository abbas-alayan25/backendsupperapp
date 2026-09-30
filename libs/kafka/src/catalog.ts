import { type Topic, isEventType, isTopic } from '@super-app/common';
import avro from 'avsc';

export type AvroField = Readonly<Record<string, unknown>> & { readonly name: string };

export interface EventDefinition {
  readonly topic: Topic;
  readonly eventType: string;
  readonly dataFields: readonly AvroField[];
}

export interface CatalogEntry {
  readonly topic: Topic;
  readonly eventType: string;
  readonly recordName: string;
  readonly subject: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly avroType: avro.Type;
}

export class UnknownEventTypeError extends Error {
  constructor(topic: string, eventType: string) {
    super(`Event type ${eventType} is not in the catalog for ${topic}`);
    this.name = 'UnknownEventTypeError';
  }
}

function pascalCase(value: string): string {
  return value
    .split(/[._]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function recordNamespace(topic: Topic): string {
  const domain = topic.split('.')[0] ?? topic;
  return `superapp.events.${domain}`;
}

export function recordName(topic: Topic, eventType: string): string {
  return `${recordNamespace(topic)}.${pascalCase(eventType)}`;
}

export function subjectName(topic: Topic, eventType: string): string {
  return `${topic}-${recordName(topic, eventType)}`;
}

export function envelopeSchema(definition: EventDefinition): Record<string, unknown> {
  const name = pascalCase(definition.eventType);
  return {
    type: 'record',
    name,
    namespace: recordNamespace(definition.topic),
    fields: [
      { name: 'eventId', type: 'string' },
      { name: 'tenantId', type: 'string' },
      { name: 'type', type: 'string' },
      { name: 'version', type: 'int' },
      { name: 'occurredAt', type: 'string' },
      { name: 'producer', type: 'string' },
      { name: 'traceId', type: ['null', 'string'], default: null },
      {
        name: 'subject',
        type: {
          type: 'record',
          name: `${name}Subject`,
          fields: [
            { name: 'type', type: 'string' },
            { name: 'id', type: 'string' },
          ],
        },
      },
      {
        name: 'data',
        type: { type: 'record', name: `${name}Data`, fields: definition.dataFields },
      },
    ],
  };
}

export class EventCatalog {
  private readonly entries = new Map<string, CatalogEntry>();

  constructor(definitions: readonly EventDefinition[] = []) {
    for (const definition of definitions) {
      this.add(definition);
    }
  }

  add(definition: EventDefinition): this {
    if (!isTopic(definition.topic)) {
      throw new RangeError(`Unknown topic ${String(definition.topic)}`);
    }
    if (!isEventType(definition.eventType)) {
      throw new RangeError(
        `Event type ${definition.eventType} is not <aggregate>.<past_tense_verb>`,
      );
    }
    const key = this.key(definition.topic, definition.eventType);
    if (this.entries.has(key)) {
      throw new RangeError(
        `Event ${definition.eventType} is already defined on ${definition.topic}`,
      );
    }
    const schema = envelopeSchema(definition);
    this.entries.set(key, {
      topic: definition.topic,
      eventType: definition.eventType,
      recordName: recordName(definition.topic, definition.eventType),
      subject: subjectName(definition.topic, definition.eventType),
      schema,
      avroType: avro.Type.forSchema(schema as avro.Schema),
    });
    return this;
  }

  find(topic: string, eventType: string): CatalogEntry | undefined {
    return this.entries.get(this.key(topic, eventType));
  }

  get(topic: string, eventType: string): CatalogEntry {
    const entry = this.find(topic, eventType);
    if (!entry) {
      throw new UnknownEventTypeError(topic, eventType);
    }
    return entry;
  }

  all(): CatalogEntry[] {
    return [...this.entries.values()];
  }

  private key(topic: string, eventType: string): string {
    return `${topic}|${eventType}`;
  }
}
