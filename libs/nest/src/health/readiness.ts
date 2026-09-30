export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<void>;
}

export type CheckOutcome = 'ok' | 'failed' | 'timeout';

export interface ReadinessReport {
  status: 'ok' | 'unavailable';
  checks: Record<string, CheckOutcome>;
}

export const DEFAULT_CHECK_TIMEOUT_MS = 2_000;

const TIMED_OUT = Symbol('TIMED_OUT');

async function runCheck(check: ReadinessCheck, timeoutMs: number): Promise<CheckOutcome> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      resolve(TIMED_OUT);
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([check.check().then(() => 'ok' as const), timeout]);
    return result === TIMED_OUT ? 'timeout' : result;
  } catch {
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

export async function evaluateReadiness(
  checks: readonly ReadinessCheck[],
  timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS,
): Promise<ReadinessReport> {
  const outcomes = await Promise.all(
    checks.map(async (check) => [check.name, await runCheck(check, timeoutMs)] as const),
  );
  const report: ReadinessReport = { status: 'ok', checks: {} };
  for (const [name, outcome] of outcomes) {
    report.checks[name] = outcome;
    if (outcome !== 'ok') {
      report.status = 'unavailable';
    }
  }
  return report;
}
