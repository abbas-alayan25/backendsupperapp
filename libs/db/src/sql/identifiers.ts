const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export function ident(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new RangeError(`Invalid SQL identifier ${name}`);
  }
  return name;
}

export function qualified(schema: string, table: string): string {
  return `${ident(schema)}.${ident(table)}`;
}

export function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
