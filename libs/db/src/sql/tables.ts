import { ident, qualified } from './identifiers.js';
import { schemaRoles } from './roles.js';

export type TableKind = 'mutable' | 'append-only' | 'insert-only';

export interface StandardColumnOptions {
  readonly kind: TableKind;
  readonly withId?: boolean;
}

export function standardColumns(options: StandardColumnOptions): string[] {
  const columns: string[] = [];
  if (options.withId !== false) {
    columns.push('id uuid NOT NULL');
  }
  columns.push('tenant_id uuid NOT NULL', 'created_at timestamptz NOT NULL DEFAULT now()');
  if (options.kind === 'mutable') {
    columns.push('updated_at timestamptz NOT NULL DEFAULT now()', 'version int NOT NULL DEFAULT 0');
  }
  return columns;
}

export function tenantPredicate(): string {
  return "tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid";
}

export function platformPredicate(): string {
  return `(${tenantPredicate()} OR (tenant_id IS NULL AND current_setting('app.scope', true) = 'platform'))`;
}

export function rlsSql(
  schema: string,
  table: string,
  options: { platformScoped?: boolean } = {},
): string {
  const target = qualified(schema, table);
  const predicate = options.platformScoped ? platformPredicate() : tenantPredicate();
  return [
    `ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${target} FORCE ROW LEVEL SECURITY;`,
    `DROP POLICY IF EXISTS tenant_isolation ON ${target};`,
    `CREATE POLICY tenant_isolation ON ${target} USING ${wrap(predicate)} WITH CHECK ${wrap(predicate)};`,
  ].join('\n');
}

function wrap(predicate: string): string {
  return predicate.startsWith('(') ? predicate : `(${predicate})`;
}

export function grantsSql(schema: string, table: string, kind: TableKind): string {
  const target = qualified(schema, table);
  const roles = schemaRoles(schema);
  const privileges = kind === 'mutable' ? 'SELECT, INSERT, UPDATE' : 'SELECT, INSERT';
  return [
    `ALTER TABLE ${target} OWNER TO ${roles.owner};`,
    `REVOKE ALL ON ${target} FROM PUBLIC;`,
    `GRANT ${privileges} ON ${target} TO ${roles.app};`,
  ].join('\n');
}

export function globalTableGrantsSql(schema: string, table: string): string {
  const target = qualified(schema, table);
  const roles = schemaRoles(schema);
  return [
    `ALTER TABLE ${target} OWNER TO ${roles.owner};`,
    `REVOKE ALL ON ${target} FROM PUBLIC;`,
    `GRANT SELECT ON ${target} TO ${roles.app};`,
    `GRANT SELECT, INSERT, UPDATE ON ${target} TO ${roles.sync};`,
  ].join('\n');
}

export function updatedAtTriggerSql(schema: string, table: string): string {
  const target = qualified(schema, table);
  return `CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON ${target}
FOR EACH ROW EXECUTE FUNCTION ${ident(schema)}.set_updated_at();`;
}

export function monthlyPartitionSql(schema: string, table: string, premake = 4): string {
  if (!Number.isInteger(premake) || premake < 1 || premake > 24) {
    throw new RangeError('premake must be between 1 and 24');
  }
  return `SELECT partman.create_parent(
  p_parent_table => '${qualified(schema, table)}',
  p_control => 'created_at',
  p_interval => '1 month',
  p_premake => ${String(premake)}
);`;
}

export interface TableDefinition {
  readonly schema: string;
  readonly table: string;
  readonly kind: TableKind;
  readonly columns: readonly string[];
  readonly constraints?: readonly string[];
  readonly indexes?: readonly string[];
  readonly partitioned?: boolean;
  readonly withId?: boolean;
  readonly platformScoped?: boolean;
  readonly primaryKey?: readonly string[];
}

export function createTableSql(definition: TableDefinition): string {
  const { schema, table, kind } = definition;
  const target = qualified(schema, table);
  const primaryKey =
    definition.primaryKey ?? (definition.partitioned ? ['id', 'created_at'] : ['id']);
  const lines = [
    ...standardColumns({ kind, withId: definition.withId }),
    ...definition.columns,
    `PRIMARY KEY (${primaryKey.map(ident).join(', ')})`,
    ...(definition.constraints ?? []),
  ];
  const partitionClause = definition.partitioned ? ' PARTITION BY RANGE (created_at)' : '';
  const statements = [
    `CREATE TABLE ${target} (\n  ${lines.join(',\n  ')}\n)${partitionClause};`,
    ...(definition.indexes ?? []).map((index) => `${index};`),
    grantsSql(schema, table, kind),
    rlsSql(schema, table, { platformScoped: definition.platformScoped }),
  ];
  if (kind === 'mutable') {
    statements.push(updatedAtTriggerSql(schema, table));
  }
  if (definition.partitioned) {
    statements.push(monthlyPartitionSql(schema, table));
  }
  return statements.join('\n');
}

export function keyTableSql(
  schema: string,
  table: string,
  keyColumns: readonly { name: string; type: string }[],
  refColumn: string,
): string {
  const target = qualified(schema, table);
  const roles = schemaRoles(schema);
  const columns = [
    'tenant_id uuid NOT NULL',
    ...keyColumns.map((column) => `${ident(column.name)} ${column.type} NOT NULL`),
    `${ident(refColumn)} uuid NOT NULL`,
    'created_at timestamptz NOT NULL DEFAULT now()',
    `PRIMARY KEY (tenant_id, ${keyColumns.map((column) => ident(column.name)).join(', ')})`,
  ];
  return [
    `CREATE TABLE ${target} (\n  ${columns.join(',\n  ')}\n);`,
    `ALTER TABLE ${target} OWNER TO ${roles.owner};`,
    `REVOKE ALL ON ${target} FROM PUBLIC;`,
    `GRANT SELECT, INSERT ON ${target} TO ${roles.app};`,
    `GRANT SELECT, DELETE ON ${target} TO ${roles.maint};`,
    rlsSql(schema, table),
  ].join('\n');
}
