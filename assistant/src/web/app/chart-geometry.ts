/** Smallest "nice" axis top at or above value, falling back to 100 for zero, negative, or non-finite input. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 100;
  const mag = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * mag;
    if (candidate >= value) return candidate;
  }
  return 10 * mag;
}

/** Horizontal position for point index on an axis of width, centered when count is one or less. */
export function scaleX(index: number, count: number, width: number): number {
  if (count <= 1) return width / 2;
  return (index / (count - 1)) * width;
}

/** Vertical position for value on an axis of height, clamped to the chart box. */
export function scaleY(value: number, max: number, height: number): number {
  if (max <= 0) return height;
  const y = height - (value / max) * height;
  return Math.min(height, Math.max(0, y));
}

/** SVG path for a polyline through values, or an empty string when there are no values. */
export function linePath(
  values: number[],
  width: number,
  height: number,
  max: number,
  count = values.length,
): string {
  if (values.length === 0) return '';
  const commands: string[] = [];
  for (const [index, value] of values.entries()) {
    const x = format(scaleX(index, count, width));
    const y = format(scaleY(value, max, height));
    commands.push(index === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
  }
  return commands.join(' ');
}

/** SVG path for the area under a line, closed to the baseline, or an empty string when there are no values. */
export function areaPath(
  values: number[],
  width: number,
  height: number,
  max: number,
  count = values.length,
): string {
  if (values.length === 0) return '';
  const line = linePath(values, width, height, max, count);
  const xFirst = format(scaleX(0, count, width));
  const xLast = format(scaleX(values.length - 1, count, width));
  const baseline = format(height);
  return `${line} L ${xLast} ${baseline} L ${xFirst} ${baseline} Z`;
}

/** Rounds to one decimal and renders with String, so 12.50 becomes "12.5". */
function format(n: number): string {
  return String(Math.round(n * 10) / 10);
}
