import { ident } from './identifiers.js';

export interface SchemaRoles {
  readonly owner: string;
  readonly app: string;
  readonly sync: string;
  readonly maint: string;
  readonly relay: string;
}

export function schemaRoles(schema: string): SchemaRoles {
  const base = ident(schema);
  return {
    owner: `${base}_owner`,
    app: `${base}_app`,
    sync: `${base}_sync`,
    maint: `${base}_maint`,
    relay: `${base}_relay`,
  };
}

function createRole(name: string, attributes: string): string {
  return `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${name}') THEN
    CREATE ROLE ${name} ${attributes};
  END IF;
END $$;`;
}

export function schemaSetupSql(schema: string): string {
  const roles = schemaRoles(schema);
  const name = ident(schema);
  return [
    createRole(roles.owner, 'NOLOGIN NOBYPASSRLS'),
    createRole(roles.app, 'NOLOGIN NOBYPASSRLS'),
    createRole(roles.sync, 'NOLOGIN NOBYPASSRLS'),
    createRole(roles.maint, 'NOLOGIN NOBYPASSRLS'),
    createRole(roles.relay, 'NOLOGIN BYPASSRLS'),
    `CREATE SCHEMA IF NOT EXISTS ${name} AUTHORIZATION ${roles.owner};`,
    `GRANT USAGE ON SCHEMA ${name} TO ${roles.app}, ${roles.sync}, ${roles.maint}, ${roles.relay};`,
    `CREATE OR REPLACE FUNCTION ${name}.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;`,
    `ALTER FUNCTION ${name}.set_updated_at() OWNER TO ${roles.owner};`,
  ].join('\n');
}

export function loginRoleSql(options: {
  name: string;
  password: string;
  memberOf: string;
  bypassRls?: boolean;
}): string {
  const name = ident(options.name);
  const bypass = options.bypassRls ? 'BYPASSRLS' : 'NOBYPASSRLS';
  return `${createRole(name, `LOGIN ${bypass} PASSWORD '${options.password.replaceAll("'", "''")}'`)}
GRANT ${ident(options.memberOf)} TO ${name};`;
}
