import { describe, expect, it } from 'vitest';
import { CONSOLE_PERMISSIONS, permissionsForRoles } from './permissions.js';

describe('console permissions', () => {
  it('maps realm roles to console permissions', () => {
    expect([...permissionsForRoles(['platform-admin'])].sort()).toEqual([CONSOLE_PERMISSIONS.edit, CONSOLE_PERMISSIONS.view]);
    expect([...permissionsForRoles(['platform-viewer'])]).toEqual([CONSOLE_PERMISSIONS.view]);
    expect([...permissionsForRoles(['offline_access', 'console.tenants.edit'])]).toEqual([CONSOLE_PERMISSIONS.edit]);
    expect(permissionsForRoles(['tenant-admin']).size).toBe(0);
  });
});
