import { type Kysely, sql } from 'kysely';

export const DEFAULT_BYPASS_ALLOWED = [/^.+_relay$/, /^migrator$/, /^debezium$/] as const;

export async function findUnexpectedBypassRlsRoles<DB>(
  db: Kysely<DB>,
  allowed: readonly RegExp[] = DEFAULT_BYPASS_ALLOWED,
): Promise<string[]> {
  const result = await sql<{ rolname: string }>`
    SELECT rolname FROM pg_roles
    WHERE rolbypassrls AND NOT rolsuper AND rolname NOT LIKE 'pg\\_%'
    ORDER BY rolname
  `.execute(db);
  return result.rows
    .map((row) => row.rolname)
    .filter((name) => !allowed.some((pattern) => pattern.test(name)));
}

export async function runtimeRolesWithBypass<DB>(
  db: Kysely<DB>,
  runtimeRoles: readonly string[],
): Promise<string[]> {
  if (runtimeRoles.length === 0) {
    return [];
  }
  const result = await sql<{ rolname: string }>`
    SELECT r.rolname FROM pg_roles r
    WHERE r.rolname = ANY(${[...runtimeRoles]}::text[])
      AND (
        r.rolbypassrls OR r.rolsuper OR EXISTS (
          SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
          WHERE m.member = r.oid AND (g.rolbypassrls OR g.rolsuper)
        )
      )
    ORDER BY r.rolname
  `.execute(db);
  return result.rows.map((row) => row.rolname);
}
