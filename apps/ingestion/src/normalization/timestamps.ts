const NANOSECOND_THRESHOLD = 1_000_000_000_000_000n;
const MILLISECONDS_TO_NANOSECONDS = 1_000_000n;

export function toNanoseconds(value: number | bigint): bigint {
  const normalized = typeof value === "bigint" ? value : BigInt(value);

  if (normalized < 0n) {
    throw new Error("timestamp must be non-negative");
  }

  if (normalized < NANOSECOND_THRESHOLD) {
    return normalized * MILLISECONDS_TO_NANOSECONDS;
  }

  return normalized;
}
