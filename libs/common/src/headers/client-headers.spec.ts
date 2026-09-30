import { describe, expect, it } from 'vitest';
import { AppError } from '../errors/app-error.js';
import {
  compareAppVersions,
  parseAppVersion,
  parseDeviceId,
  parsePlatform,
} from './client-headers.js';

describe('client headers', () => {
  it('parses device ids', () => {
    expect(parseDeviceId('dev-1:abc')).toBe('dev-1:abc');
    expect(parseDeviceId(['d1', 'd2'])).toBe('d1');
    expect(parseDeviceId(undefined)).toBeUndefined();
    expect(parseDeviceId('  ')).toBeUndefined();
    expect(() => parseDeviceId('bad id')).toThrow(AppError);
    expect(() => parseDeviceId('x'.repeat(129))).toThrow(AppError);
  });

  it('parses app versions', () => {
    expect(parseAppVersion('3.12.0')).toEqual({ major: 3, minor: 12, patch: 0, raw: '3.12.0' });
    expect(parseAppVersion(undefined)).toBeUndefined();
    for (const bad of ['3.12', 'v3.1.0', '3.01.0', '3.1.0-beta', 'abc']) {
      expect(() => parseAppVersion(bad)).toThrow(AppError);
    }
  });

  it('parses platforms case-insensitively', () => {
    expect(parsePlatform('ios')).toBe('IOS');
    expect(parsePlatform('Android')).toBe('ANDROID');
    expect(parsePlatform(undefined)).toBeUndefined();
    expect(() => parsePlatform('windows')).toThrow(AppError);
  });

  it('compares app versions numerically', () => {
    const v = (raw: string) => {
      const parsed = parseAppVersion(raw);
      if (!parsed) throw new Error('missing');
      return parsed;
    };
    expect(compareAppVersions(v('3.10.0'), v('3.9.9'))).toBe(1);
    expect(compareAppVersions(v('2.0.0'), v('10.0.0'))).toBe(-1);
    expect(compareAppVersions(v('1.2.3'), v('1.2.3'))).toBe(0);
  });
});
