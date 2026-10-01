import { loginRoleSql, schemaRoles } from '@super-app/db';
import pg from 'pg';
import { LOCAL_ROLE_PASSWORD } from '../config.js';
import { TENANCY_SCHEMA } from './migration-sql.js';

export interface LoginRole {
  readonly name: string;
  readonly memberOf: string;
  readonly passwordEnv: string;
  readonly bypassRls?: boolean;
}

const roles = schemaRoles(TENANCY_SCHEMA);

export const TENANCY_LOGIN_ROLES: readonly LoginRole[] = [
  { name: 'tenant_service', memberOf: roles.app, passwordEnv: 'TENANCY_APP_PASSWORD' },
  { name: 'tenant_service_sync', memberOf: roles.sync, passwordEnv: 'TENANCY_SYNC_PASSWORD' },
  {
    name: 'tenant_service_relay',
    memberOf: roles.relay,
    passwordEnv: 'TENANCY_RELAY_PASSWORD',
    bypassRls: true,
  },
];

export function provisionSql(env: NodeJS.ProcessEnv = process.env): string {
  return TENANCY_LOGIN_ROLES.map((role) => {
    const password = env[role.passwordEnv];
    if (!password && env.NODE_ENV === 'production') {
      throw new Error(`${role.passwordEnv} is required in production`);
    }
    return loginRoleSql({
      name: role.name,
      password: password ?? LOCAL_ROLE_PASSWORD,
      memberOf: role.memberOf,
      bypassRls: role.bypassRls ?? false,
    });
  }).join('\n');
}

export async function provisionLoginRoles(connectionString: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(provisionSql(env));
  } finally {
    await client.end();
  }
}
