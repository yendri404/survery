/*
 * Chart math for the survey summary (the API counts; the client only draws): a donut for
 * single-choice questions with up to MAX_DONUT_SLICES options, horizontal bars otherwise, a histogram for
 * scale questions. Colors come from CSS classes (.slice-1 to .slice-6), never inline styles.
 */
export const MAX_DONUT_SLICES = 6; // categorical colors are never cycled; more options use bars
const DONUT_GAP = 0.6; // surface gap between slices, in percent of the circle

const fixed = (n) => Number(n.toFixed(2));

export const percent = (count, answered) => (answered ? Math.round((count / answered) * 100) : 0);

/**
 * Drawn slices of a donut whose circle has a circumference of 100 (r = 15.9155): `length` and
 * `rest` are the stroke-dasharray, `offset` the stroke-dashoffset (25 starts at the top).
 * Options nobody chose get no slice; `index` keeps the option's color.
 */
export function donutSlices(counts, answered) {
  const drawn = counts.filter((count) => count > 0).length;
  const slices = [];
  let start = 0;
  counts.forEach((count, index) => {
    const share = answered ? (count / answered) * 100 : 0;
    const from = start;
    start += share;
    if (!count) return;
    const length = Math.max(share - (drawn > 1 ? DONUT_GAP : 0), 0.01);
    slices.push({ index, length: fixed(length), rest: fixed(100 - length), offset: fixed(25 - from) });
  });
  return slices;
}

/** Width of a bar, in percent of the track. */
export const barWidth = (count, answered) => fixed(answered ? (count / answered) * 100 : 0);

/** Height of a histogram column (scale questions), in percent of the tallest one (`peak`). */
export const columnHeight = (count, peak) => fixed(peak ? (count / peak) * 100 : 0);
