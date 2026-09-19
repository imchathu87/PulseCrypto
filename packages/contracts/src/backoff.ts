export type BackoffOptions = {
  baseMs: number;
  capMs: number;
};

export function backoffDelay(
  attempt: number,
  { baseMs, capMs }: BackoffOptions,
  random: () => number = Math.random,
): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError(
      `attempt must be a non-negative integer, received ${attempt}`,
    );
  }

  const maxDelay = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(random() * maxDelay);
}
