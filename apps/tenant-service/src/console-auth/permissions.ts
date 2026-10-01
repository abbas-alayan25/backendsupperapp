export const CONSOLE_PERMISSIONS = {
  view: 'console.tenants.view',
  edit: 'console.tenants.edit',
} as const;

export const CONSOLE_ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  'platform-admin': [CONSOLE_PERMISSIONS.view, CONSOLE_PERMISSIONS.edit],
  'platform-viewer': [CONSOLE_PERMISSIONS.view],
};

export function permissionsForRoles(roles: readonly string[]): Set<string> {
  const permissions = new Set<string>();
  for (const role of roles) {
    for (const permission of CONSOLE_ROLE_PERMISSIONS[role] ?? []) {
      permissions.add(permission);
    }
    if (Object.values(CONSOLE_PERMISSIONS).includes(role as never)) {
      permissions.add(role);
    }
  }
  return permissions;
}
