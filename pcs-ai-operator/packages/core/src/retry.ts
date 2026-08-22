export const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000] as const;

export function retryDelayMs(attemptsMade: number): number {
  if (!Number.isInteger(attemptsMade) || attemptsMade < 1) return RETRY_DELAYS_MS[0];
  return RETRY_DELAYS_MS[Math.min(attemptsMade - 1, RETRY_DELAYS_MS.length - 1)];
}
