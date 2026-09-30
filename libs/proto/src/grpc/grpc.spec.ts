import { Metadata, status } from '@grpc/grpc-js';
import { AppError, ERROR_CODES } from '@super-app/common';
import { describe, expect, it } from 'vitest';
import { GRPC_STATUS_BY_ERROR_CODE, fromGrpcError, toGrpcError } from './errors.js';
import { deadlineFor } from './metadata.js';
import { contextFromMetadata } from './server.js';

describe('deadlines', () => {
  it('uses 300 ms for ledger and risk and 2 s elsewhere', () => {
    expect(deadlineFor('ledger.v1.LedgerService')).toBe(300);
    expect(deadlineFor('risk.v1.RiskService')).toBe(300);
    expect(deadlineFor('wallet.v1.WalletService')).toBe(2000);
  });
});

describe('error mapping', () => {
  it('maps every error code to a gRPC status and back without loss', () => {
    for (const code of ERROR_CODES) {
      expect(GRPC_STATUS_BY_ERROR_CODE[code]).toBeTypeOf('number');
      const wire = toGrpcError(new AppError(code, { field: 'x' }));
      const back = fromGrpcError({ ...wire, message: wire.details, name: 'Error' });
      expect(back.code).toBe(code);
      expect(back.details).toEqual(code === 'INTERNAL_ERROR' ? {} : { field: 'x' });
    }
  });

  it('hides unexpected errors as INTERNAL', () => {
    const wire = toGrpcError(new Error('db password is hunter2'));
    expect(wire.code).toBe(status.INTERNAL);
    expect(wire.details).toBe('INTERNAL_ERROR');
    expect(wire.metadata.get('error-details')).toEqual([]);
  });

  it('falls back to the gRPC status when no error code is sent', () => {
    const error = {
      code: status.NOT_FOUND,
      details: 'x',
      metadata: new Metadata(),
      message: 'x',
      name: 'Error',
    };
    expect(fromGrpcError(error).code).toBe('NOT_FOUND');
    expect(fromGrpcError({ ...error, code: status.DEADLINE_EXCEEDED }).code).toBe(
      'PARTNER_UNAVAILABLE',
    );
    expect(fromGrpcError('weird').code).toBe('INTERNAL_ERROR');
  });
});

describe('server context', () => {
  it('requires a UUID tenant id', () => {
    const metadata = new Metadata();
    expect(() => contextFromMetadata(metadata)).toThrow(AppError);
    metadata.set('tenant-id', 'not-a-uuid');
    expect(() => contextFromMetadata(metadata)).toThrow(AppError);
  });

  it('reads tenant and request ids', () => {
    const metadata = new Metadata();
    metadata.set('tenant-id', '0192F5A0-0000-7000-8000-000000000001');
    metadata.set('request-id', 'req-1');
    expect(contextFromMetadata(metadata)).toMatchObject({
      tenantId: '0192f5a0-0000-7000-8000-000000000001',
      requestId: 'req-1',
    });
  });
});
