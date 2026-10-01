import { Server, ServerCredentials, credentials, status } from '@grpc/grpc-js';
import { AppError, currentContext, runWithContext } from '@super-app/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createGrpcClient,
  fromGrpcError,
  idempotencyKeyFrom,
  idempotencyMetadata,
  ledgerV1,
  tenantV1,
  platformUnary,
  unary,
} from '../src/index.js';

const TENANT = '0192f5a0-0000-7000-8000-000000000001';
const inContext = <T>(fn: () => Promise<T>) =>
  runWithContext({ tenantId: TENANT, requestId: 'req-42', locale: 'en' }, fn);

let server: Server;
let address: string;
let seenIdempotencyKey: string | undefined;

beforeAll(async () => {
  server = new Server();
  server.addService(tenantV1.TenantServiceService, {
    getProfile: unary<tenantV1.GetProfileRequest, tenantV1.GetProfileResponse>(() => {
      const context = currentContext();
      return Promise.resolve({
        tenant: {
          id: context?.tenantId ?? '',
          code: context?.requestId ?? '',
          legalName: '',
          displayName: '',
          country: 'JO',
          status: tenantV1.TenantStatus.TENANT_STATUS_ACTIVE,
          deploymentModel: tenantV1.DeploymentModel.DEPLOYMENT_MODEL_SHARED,
          region: 'me-central-1',
          currentProfileVersion: 1,
        },
        profile: undefined,
      });
    }),
    resolveAdapter: unary<tenantV1.ResolveAdapterRequest, tenantV1.ResolveAdapterResponse>(() =>
      Promise.reject(new AppError('NOT_FOUND', { partnerType: 'BANK' })),
    ),
    resolveDomain: unary<tenantV1.ResolveDomainRequest, tenantV1.ResolveDomainResponse>(
      async (_request, call) => {
        seenIdempotencyKey = idempotencyKeyFrom(call.metadata);
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
          tenantId: TENANT,
          kind: tenantV1.DomainKind.DOMAIN_KIND_API,
          status: tenantV1.TenantStatus.TENANT_STATUS_ACTIVE,
        };
      },
    ),
    listActiveTenants: platformUnary<
      tenantV1.ListActiveTenantsRequest,
      tenantV1.ListActiveTenantsResponse
    >(() =>
      Promise.resolve({
        tenants: currentContext()?.scope === 'platform' ? [] : [{} as tenantV1.Tenant],
      }),
    ),
  });
  server.addService(ledgerV1.LedgerServiceService, {
    getBalance: unary<ledgerV1.GetBalanceRequest, ledgerV1.GetBalanceResponse>(async (request) => {
      if (request.accountId === 'boom') {
        throw new Error('database password leaked here');
      }
      if (request.accountId === 'slow') {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return {
        balance: {
          accountId: request.accountId,
          posted: { amountMinor: 9_223_372_036_854_775_807n, currency: 'USD' },
          held: { amountMinor: 0n, currency: 'USD' },
          available: { amountMinor: 9_223_372_036_854_775_807n, currency: 'USD' },
          lastEntryId: '',
        },
      };
    }),
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, bound) => {
      if (error) reject(error);
      else resolve(bound);
    });
  });
  address = `127.0.0.1:${String(port)}`;
});

afterAll(() => {
  server.forceShutdown();
});

const call = <Req, Res>(
  method: (request: Req, callback: (error: Error | null, response: Res) => void) => unknown,
  request: Req,
): Promise<Res> =>
  new Promise((resolve, reject) => {
    method(request, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });

describe('gRPC context propagation', () => {
  it('carries tenant and request ids from the caller context', async () => {
    const client = createGrpcClient(tenantV1.TenantServiceClient, address);
    const response = await inContext(() =>
      call<tenantV1.GetProfileRequest, tenantV1.GetProfileResponse>(
        client.getProfile.bind(client),
        {},
      ),
    );
    expect(response.tenant).toMatchObject({ id: TENANT, code: 'req-42' });
    client.close();
  });

  it('refuses to call without a tenant context', () => {
    const client = createGrpcClient(tenantV1.TenantServiceClient, address);
    expect(() => client.getProfile({}, () => undefined)).toThrow(/No request context/);
    client.close();
  });

  it('rejects calls that arrive without tenant-id metadata', async () => {
    const raw = new tenantV1.TenantServiceClient(address, credentials.createInsecure());
    const error = await call(raw.getProfile.bind(raw), {}).catch((e: unknown) => e);
    expect((error as { code: number }).code).toBe(status.PERMISSION_DENIED);
    expect(fromGrpcError(error).details).toEqual({ reason: 'TENANT_UNRESOLVED' });
    raw.close();
  });
});

describe('errors', () => {
  it('round-trips AppError codes and details', async () => {
    const client = createGrpcClient(tenantV1.TenantServiceClient, address);
    const error = await inContext(() =>
      call(client.resolveAdapter.bind(client), {
        partnerType: tenantV1.PartnerType.PARTNER_TYPE_BANK,
      }),
    ).catch((e: unknown) => e);
    const appError = fromGrpcError(error);
    expect(appError.code).toBe('NOT_FOUND');
    expect(appError.details).toEqual({ partnerType: 'BANK' });
    client.close();
  });

  it('hides unexpected server errors', async () => {
    const client = createGrpcClient(ledgerV1.LedgerServiceClient, address);
    const error = await inContext(() =>
      call<ledgerV1.GetBalanceRequest, ledgerV1.GetBalanceResponse>(
        client.getBalance.bind(client),
        {
          accountId: 'boom',
        },
      ),
    ).catch((e: unknown) => e);
    expect(fromGrpcError(error).code).toBe('INTERNAL_ERROR');
    expect(String((error as Error).message)).not.toContain('password');
    client.close();
  });

  it('serves platform RPCs in platform scope without tenant metadata', async () => {
    const raw = new tenantV1.TenantServiceClient(address, credentials.createInsecure());
    const response = await call<
      tenantV1.ListActiveTenantsRequest,
      tenantV1.ListActiveTenantsResponse
    >(raw.listActiveTenants.bind(raw), {});
    expect(response.tenants).toEqual([]);
    raw.close();
  });
});

describe('deadlines and idempotency', () => {
  it('applies the 300 ms ledger deadline', async () => {
    const client = createGrpcClient(ledgerV1.LedgerServiceClient, address);
    const error = await inContext(() =>
      call(client.getBalance.bind(client), { accountId: 'slow' }),
    ).catch((e: unknown) => e);
    expect((error as { code: number }).code).toBe(status.DEADLINE_EXCEEDED);
    client.close();
  });

  it('keeps int64 money exact as bigint', async () => {
    const client = createGrpcClient(ledgerV1.LedgerServiceClient, address);
    const response = await inContext(() =>
      call<ledgerV1.GetBalanceRequest, ledgerV1.GetBalanceResponse>(
        client.getBalance.bind(client),
        { accountId: 'a1' },
      ),
    );
    expect(response.balance?.posted?.amountMinor).toBe(9_223_372_036_854_775_807n);
    client.close();
  });

  it('allows slower calls within the 2 s default and passes the idempotency key', async () => {
    const client = createGrpcClient(tenantV1.TenantServiceClient, address);
    const response = await inContext(
      () =>
        new Promise<tenantV1.ResolveDomainResponse>((resolve, reject) => {
          client.resolveDomain(
            { domain: 'api.tenant.test' },
            idempotencyMetadata('key-1'),
            (error, value) => {
              if (error) reject(error);
              else resolve(value);
            },
          );
        }),
    );
    expect(response.tenantId).toBe(TENANT);
    expect(seenIdempotencyKey).toBe('key-1');
    client.close();
  });
});
