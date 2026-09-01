function clamp(lower: number, upper: number, n: number) {
  return Math.min(Math.max(lower, n), upper);
}

function clampPrecisionArg(precision: number): number {
  return clamp(0, 8, precision);
}

// Common util between all the transformer functions for Number
// that will make sure to correctly handle the available precision decimal
// values. Here a value of `-1` refers to the "any" precision. I.e. the
// precision is "trim all trailing zeros but show all significant digits"
export const formatNumber =
  (decimals: unknown) =>
  (num: unknown): string => {
    if (
      typeof num !== "number" ||
      typeof decimals !== "number" ||
      decimals < 0
    ) {
      return String(num);
    }

    return num.toFixed(clampPrecisionArg(Math.floor(decimals)));
  };
