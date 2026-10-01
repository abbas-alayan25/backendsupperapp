import type { AdapterRecord, AdapterSource, PartnerType } from '@super-app/adapters';
import type { TenancyDb } from '../shared/tenancy-db.js';

export class DirectAdapterSource implements AdapterSource {
  constructor(private readonly db: TenancyDb) {}

  async listAdapters(tenantId: string, partnerType: PartnerType): Promise<AdapterRecord[]> {
    const adapters = await this.db.read(tenantId, (tx) =>
      tx.tenantAdapter.findMany({
        where: { tenantId, partnerType, status: 'ACTIVE' },
        orderBy: [{ priority: 'asc' }, { provider: 'asc' }],
      }),
    );
    return adapters.map((adapter) => ({
      partnerType,
      provider: adapter.provider,
      priority: adapter.priority,
      config: adapter.config as Readonly<Record<string, unknown>>,
      secretRef: adapter.secretRef,
    }));
  }
}
