import avro from 'avsc';
import type { CatalogEntry, EventCatalog } from './catalog.js';
import type { EventEnvelope } from './envelope.js';

export interface SchemaInfoLike {
  schema: string;
  schemaType?: string;
}

export interface SchemaRegistryPort {
  register(subject: string, schema: SchemaInfoLike, normalize?: boolean): Promise<number>;
  getId(subject: string, schema: SchemaInfoLike, normalize?: boolean): Promise<number>;
  getBySubjectAndId(subject: string, id: number): Promise<SchemaInfoLike>;
}

export class SchemaValidationError extends Error {
  constructor(
    readonly eventType: string,
    readonly paths: readonly string[],
  ) {
    super(`Event ${eventType} does not match its schema at ${paths.join(', ') || '(root)'}`);
    this.name = 'SchemaValidationError';
  }
}

export class WireFormatError extends Error {
  constructor(reason: string) {
    super(`Invalid Confluent wire format: ${reason}`);
    this.name = 'WireFormatError';
  }
}

const MAGIC_BYTE = 0;
const HEADER_LENGTH = 5;

function schemaInfo(entry: CatalogEntry): SchemaInfoLike {
  return { schemaType: 'AVRO', schema: JSON.stringify(entry.schema) };
}

export async function registerCatalog(
  registry: SchemaRegistryPort,
  catalog: EventCatalog,
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const entry of catalog.all()) {
    ids.set(entry.subject, await registry.register(entry.subject, schemaInfo(entry)));
  }
  return ids;
}

export class AvroEventSerde {
  private readonly writerTypes = new Map<number, avro.Type>();

  constructor(
    private readonly registry: SchemaRegistryPort,
    private readonly catalog: EventCatalog,
  ) {}

  async serialize(topic: string, envelope: EventEnvelope): Promise<Buffer> {
    const entry = this.catalog.get(topic, envelope.type);
    const paths: string[] = [];
    const valid = entry.avroType.isValid(envelope, {
      errorHook: (path: string[]) => {
        paths.push(path.join('.'));
      },
    });
    if (!valid) {
      throw new SchemaValidationError(envelope.type, paths);
    }
    const id = await this.registry.getId(entry.subject, schemaInfo(entry));
    const header = Buffer.alloc(HEADER_LENGTH);
    header.writeUInt8(MAGIC_BYTE, 0);
    header.writeInt32BE(id, 1);
    return Buffer.concat([header, entry.avroType.toBuffer(envelope)]);
  }

  async deserialize(topic: string, eventType: string, value: Buffer): Promise<EventEnvelope> {
    if (value.length < HEADER_LENGTH || value.readUInt8(0) !== MAGIC_BYTE) {
      throw new WireFormatError('missing magic byte or header');
    }
    const id = value.readInt32BE(1);
    const entry = this.catalog.find(topic, eventType);
    const writer = await this.writerType(id, entry?.subject ?? '');
    const payload = value.subarray(HEADER_LENGTH);
    if (!entry) {
      return writer.fromBuffer(payload) as EventEnvelope;
    }
    const resolver = entry.avroType.createResolver(writer);
    return entry.avroType.fromBuffer(payload, resolver) as EventEnvelope;
  }

  private async writerType(id: number, subject: string): Promise<avro.Type> {
    const cached = this.writerTypes.get(id);
    if (cached) {
      return cached;
    }
    const info = await this.registry.getBySubjectAndId(subject, id);
    const type = avro.Type.forSchema(JSON.parse(info.schema) as avro.Schema);
    this.writerTypes.set(id, type);
    return type;
  }
}
