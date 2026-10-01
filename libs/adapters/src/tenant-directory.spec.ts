import { tenantV1 } from '@super-app/proto';
import { describe, expect, it } from 'vitest';
import { partnerTypeFromProto, partnerTypeToProto, profileCacheKey } from './tenant-directory.js';
import { PARTNER_TYPES } from './types.js';

describe('tenant directory helpers', () => {
  it('maps every partner type to and from the proto enum', () => {
    for (const partnerType of PARTNER_TYPES) {
      expect(partnerTypeFromProto(partnerTypeToProto(partnerType))).toBe(partnerType);
    }
    expect(partnerTypeFromProto(tenantV1.PartnerType.PARTNER_TYPE_UNSPECIFIED)).toBeUndefined();
  });

  it('uses the tenant-prefixed profile cache key', () => {
    expect(profileCacheKey('abc')).toBe('t:abc:profile');
  });
});
