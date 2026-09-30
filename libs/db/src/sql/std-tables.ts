import { qualified } from './identifiers.js';
import { schemaRoles } from './roles.js';
import { createTableSql } from './tables.js';

export function stdTablesSql(schema: string): string {
  const roles = schemaRoles(schema);
  const outbox = qualified(schema, 'outbox_events');
  const idempotency = qualified(schema, 'idempotency_keys');
  const inbox = qualified(schema, 'inbox_events');
  return [
    createTableSql({
      schema,
      table: 'outbox_events',
      kind: 'insert-only',
      columns: [
        'aggregate_type text NOT NULL',
        'aggregate_id uuid NOT NULL',
        'event_type text NOT NULL',
        'event_version int NOT NULL CHECK (event_version > 0)',
        'producer text NOT NULL',
        'topic text NOT NULL',
        'message_key text NOT NULL',
        'payload jsonb NOT NULL',
        "headers jsonb NOT NULL DEFAULT '{}'::jsonb",
        'published_at timestamptz',
      ],
      indexes: [
        `CREATE INDEX ON ${outbox} (created_at) WHERE published_at IS NULL`,
        `CREATE INDEX ON ${outbox} (tenant_id, published_at)`,
      ],
    }),
    createTableSql({
      schema,
      table: 'idempotency_keys',
      kind: 'insert-only',
      columns: [
        'key text NOT NULL',
        "actor_type text NOT NULL CHECK (actor_type IN ('USER', 'API_KEY', 'ADMIN', 'SERVICE'))",
        'actor_id text NOT NULL',
        'request_hash text NOT NULL',
        'response_code int',
        'response_body jsonb',
        'locked_until timestamptz',
        'expires_at timestamptz NOT NULL',
      ],
      constraints: ['UNIQUE (tenant_id, key)'],
      indexes: [`CREATE INDEX ON ${idempotency} (tenant_id, expires_at)`],
    }),
    `GRANT UPDATE ON ${idempotency} TO ${roles.app};`,
    createTableSql({
      schema,
      table: 'inbox_events',
      kind: 'insert-only',
      columns: [
        'event_id uuid NOT NULL',
        'topic text NOT NULL',
        'processed_at timestamptz NOT NULL DEFAULT now()',
      ],
      constraints: ['UNIQUE (tenant_id, event_id)'],
      indexes: [`CREATE INDEX ON ${inbox} (tenant_id, processed_at)`],
    }),
    `GRANT SELECT, UPDATE (published_at) ON ${outbox} TO ${roles.relay};`,
    `GRANT SELECT, DELETE ON ${outbox}, ${idempotency}, ${inbox} TO ${roles.maint};`,
  ].join('\n');
}
