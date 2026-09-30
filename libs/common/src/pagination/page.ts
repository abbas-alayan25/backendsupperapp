export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export function toPage<T>(
  rows: readonly T[],
  limit: number,
  cursorFor: (last: T) => string,
): Page<T> {
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  const hasMore = rows.length > limit && last !== undefined;
  return { data, nextCursor: hasMore ? cursorFor(last) : null };
}
