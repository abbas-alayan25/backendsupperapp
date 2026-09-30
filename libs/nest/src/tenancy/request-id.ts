import { newId } from '@super-app/common';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function resolveRequestId(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && REQUEST_ID_PATTERN.test(value) ? value : newId();
}
