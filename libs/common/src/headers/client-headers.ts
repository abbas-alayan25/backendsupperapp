import { AppError } from '../errors/app-error.js';

export const PLATFORMS = ['IOS', 'ANDROID'] as const;

export type Platform = (typeof PLATFORMS)[number];

export interface AppVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly raw: string;
}

const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const APP_VERSION_PATTERN = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

function invalid(field: string): AppError {
  return new AppError('VALIDATION_FAILED', { field, reason: 'INVALID_HEADER' });
}

export function firstHeader(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function parseDeviceId(value: string | string[] | undefined): string | undefined {
  const raw = firstHeader(value);
  if (raw === undefined) {
    return undefined;
  }
  if (!DEVICE_ID_PATTERN.test(raw)) {
    throw invalid('X-Device-Id');
  }
  return raw;
}

export function parseAppVersion(value: string | string[] | undefined): AppVersion | undefined {
  const raw = firstHeader(value);
  if (raw === undefined) {
    return undefined;
  }
  const match = APP_VERSION_PATTERN.exec(raw);
  if (!match) {
    throw invalid('X-App-Version');
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), raw };
}

export function parsePlatform(value: string | string[] | undefined): Platform | undefined {
  const raw = firstHeader(value)?.toUpperCase();
  if (raw === undefined) {
    return undefined;
  }
  if (!(PLATFORMS as readonly string[]).includes(raw)) {
    throw invalid('X-Platform');
  }
  return raw as Platform;
}

export function compareAppVersions(left: AppVersion, right: AppVersion): -1 | 0 | 1 {
  for (const part of ['major', 'minor', 'patch'] as const) {
    if (left[part] !== right[part]) {
      return left[part] < right[part] ? -1 : 1;
    }
  }
  return 0;
}
