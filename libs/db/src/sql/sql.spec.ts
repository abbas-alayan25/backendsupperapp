import { describe, expect, it } from 'vitest';
import { ident, literal, qualified } from './identifiers.js';
import { loginRoleSql, schemaRoles, schemaSetupSql } from './roles.js';
import { stdTablesSql } from './std-tables.js';
import {
  createTableSql,
  keyTableSql,
  monthlyPartitionSql,
  platformPredicate,
  rlsSql,
  standardColumns,
  tenantPredicate,
} from './tables.js';

describe('identifiers', () => {
  it('accepts snake_case identifiers', () => {
    expect(ident('payment_events')).toBe('payment_events');
    expect(qualified('ledger', 'postings')).toBe('ledger.postings');
  });

  it.each(['Payments', 'a-b', '1abc', 'x; drop table y', '', 'a'.repeat(64)])(
    'rejects %j',
    (name) => {
      expect(() => ident(name)).toThrow(RangeError);
    },
  );

  it('escapes literals', () => {
    expect(literal("o'brien")).toBe("'o''brien'");
  });
});

describe('standard columns', () => {
  it('adds updated_at and version only to mutable tables', () => {
    expect(standardColumns({ kind: 'mutable' })).toEqual([
      'id uuid NOT NULL',
      'tenant_id uuid NOT NULL',
      'created_at timestamptz NOT NULL DEFAULT now()',
      'updated_at timestamptz NOT NULL DEFAULT now()',
      'version int NOT NULL DEFAULT 0',
    ]);
    expect(standardColumns({ kind: 'append-only' })).toHaveLength(3);
    expect(standardColumns({ kind: 'mutable', withId: false })[0]).toBe('tenant_id uuid NOT NULL');
  });
});

describe('row-level security', () => {
  it('forces RLS and fails closed when the tenant is unset', () => {
    const sql = rlsSql('wallet', 'wallets');
    expect(sql).toContain('ALTER TABLE wallet.wallets ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE wallet.wallets FORCE ROW LEVEL SECURITY;');
    expect(sql).toContain(`USING (${tenantPredicate()}) WITH CHECK (${tenantPredicate()})`);
    expect(tenantPredicate()).toContain("current_setting('app.tenant_id', true)");
    expect(tenantPredicate()).toContain('nullif(');
  });

  it('allows PLATFORM rows only in platform scope', () => {
    expect(rlsSql('admin', 'admin_users', { platformScoped: true })).toContain(platformPredicate());
    expect(platformPredicate()).toContain("current_setting('app.scope', true) = 'platform'");
  });
});

describe('tables', () => {
  it('builds a partitioned append-only table with a composite key and monthly partitions', () => {
    const sql = createTableSql({
      schema: 'payments',
      table: 'payment_events',
      kind: 'append-only',
      partitioned: true,
      columns: ['payment_id uuid NOT NULL'],
    });
    expect(sql).toContain('PRIMARY KEY (id, created_at)');
    expect(sql).toContain('PARTITION BY RANGE (created_at)');
    expect(sql).toContain('GRANT SELECT, INSERT ON payments.payment_events TO payments_app;');
    expect(sql).not.toContain('UPDATE ON payments.payment_events');
    expect(sql).not.toContain('set_updated_at');
    expect(sql).toContain("p_interval => '1 month'");
    expect(sql).toContain('SET inherit_privileges = true');
    expect(sql).toContain("partman.reapply_privileges('payments.payment_events')");
  });

  it('builds a mutable table with the updated_at trigger', () => {
    const sql = createTableSql({
      schema: 'wallet',
      table: 'wallets',
      kind: 'mutable',
      columns: [],
    });
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE ON wallet.wallets TO wallet_app;');
    expect(sql).toContain('EXECUTE FUNCTION wallet.set_updated_at()');
    expect(sql).toContain('OWNER TO wallet_owner');
  });

  it('builds key tables with tenant_id first in the primary key', () => {
    const sql = keyTableSql(
      'ledger',
      'entry_keys',
      [{ name: 'idempotency_key', type: 'text' }],
      'entry_id',
    );
    expect(sql).toContain('PRIMARY KEY (tenant_id, idempotency_key)');
    expect(sql).toContain('entry_id uuid NOT NULL');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
  });

  it('limits premake', () => {
    expect(() => monthlyPartitionSql('a', 'b', 0)).toThrow(RangeError);
  });
});

describe('roles and std tables', () => {
  it('derives role names per schema', () => {
    expect(schemaRoles('wallet')).toEqual({
      owner: 'wallet_owner',
      app: 'wallet_app',
      sync: 'wallet_sync',
      maint: 'wallet_maint',
      relay: 'wallet_relay',
    });
  });

  it('gives BYPASSRLS only to the relay role', () => {
    const sql = schemaSetupSql('wallet');
    expect(sql).toContain('CREATE ROLE wallet_relay NOLOGIN BYPASSRLS');
    for (const role of ['owner', 'app', 'sync', 'maint']) {
      expect(sql).toContain(`CREATE ROLE wallet_${role} NOLOGIN NOBYPASSRLS`);
    }
  });

  it('creates the three std tables with the decided extensions', () => {
    const sql = stdTablesSql('wallet');
    for (const column of [
      'topic text NOT NULL',
      'message_key text NOT NULL',
      'event_version int NOT NULL',
      'producer text NOT NULL',
      'actor_type text NOT NULL',
      'actor_id text NOT NULL',
      'UNIQUE (tenant_id, key)',
      'UNIQUE (tenant_id, event_id)',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).not.toContain('PARTITION BY');
    expect(sql).toContain(
      'GRANT SELECT, UPDATE (published_at) ON wallet.outbox_events TO wallet_relay;',
    );
  });

  it('escapes passwords in login roles', () => {
    expect(loginRoleSql({ name: 'svc', password: "p'w", memberOf: 'wallet_app' })).toContain(
      "PASSWORD 'p''w'",
    );
  });
});
