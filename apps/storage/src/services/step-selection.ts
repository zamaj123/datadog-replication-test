const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export function autoSelectStep(startMs: number, endMs: number): string {
  const rangeMs = endMs - startMs;

  if (rangeMs <= 3 * MS_PER_HOUR) {
    return "raw";
  }

  if (rangeMs <= 2 * MS_PER_DAY) {
    return "1m";
  }

  if (rangeMs <= 14 * MS_PER_DAY) {
    return "1h";
  }

  return "1d";
}

export function stepToBucketMs(step: string): number | null {
  switch (step) {
    case "1m":
      return 60_000;
    case "5m":
      return 5 * 60_000;
    case "15m":
      return 15 * 60_000;
    case "1h":
      return 60 * 60_000;
    case "6h":
      return 6 * 60 * 60_000;
    case "1d":
      return 24 * 60 * 60_000;
    case "raw":
      return null;
    default:
      return null;
  }
}

