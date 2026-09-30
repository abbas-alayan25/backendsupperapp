import { defineSearchAttributeKey } from '@temporalio/common';

export const TENANT_ID_SEARCH_ATTRIBUTE = defineSearchAttributeKey('tenantId', 'KEYWORD');
export const TENANT_ID_HEADER = 'tenant-id';
