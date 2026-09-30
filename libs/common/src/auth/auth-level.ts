export const AUTH_LEVEL_METADATA = 'super-app:auth-level';

export type SimpleAuthLevel = 'Public' | 'Reg' | 'User' | 'Step-up' | 'Staff' | 'Rider' | 'Key';

export interface AdminAuthLevel {
  readonly admin: string;
}

export type AuthLevel = SimpleAuthLevel | AdminAuthLevel;
