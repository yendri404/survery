import { MAX_DONUT_SLICES, barWidth, columnHeight, donutSlices, percent } from '../charts.js';
import { h, s } from '../dom.js';
import { formatTimestamp, localDateTime } from '../format.js';
import { icon } from './icons.js';
import { closingText, emptyState, statusKey } from './layout.js';

/*
 * Survey results, drawn from the API's /summary and /responses. The SVG charts are decorative
 * (aria-hidden); the legend or bar labels next to them carry every count and percentage as text,
 * which is also what screen readers read. Colors come from CSS classes, never inline styles.
 */

/** Single choice (radio, select, yes/no): every answer picks one option, so the shares add up to 100%. */
function donutChart(counts, answered) {
  const slices = donutSlices(counts.map((c) => c.count), answered).map(({ index, length, rest, offset }) => {
    const { label, count } = counts[index];
    // r = 15.9155 makes the circumference 100, so dash lengths are percentages.
    return s('circle', { class: `donut-slice slice-${index + 1}`, cx: 21, cy: 21, r: 15.9155, 'stroke-dasharray': `${length} ${rest}`, 'stroke-dashoffset': offset },
      s('title', {}, `${label}: ${count} (${percent(count, answered)}%)`));
  });
  const legend = counts.map(({ label, count }, i) => h('li', {},
    h('span', { class: `swatch slice-${i + 1}` }),
    h('span', { class: 'legend-label' }, label),
    h('span', { class: 'legend-value' }, `${count} (${percent(count, answered)}%)`)));
  return h('div', { class: 'donut-chart' },
    s('svg', { class: 'donut', viewBox: '0 0 42 42', 'aria-hidden': 'true', focusable: 'false' },
      slices.length ? null : s('circle', { class: 'donut-track', cx: 21, cy: 21, r: 15.9155 }), // empty track only when nothing was chosen
      slices,
      s('text', { class: 'donut-total', x: 21, y: 21 }, String(answered))),
    h('ul', { class: 'legend' }, legend));
}

/**
 * Horizontal bars. Multiple choice (checkbox) always uses them, never a pie: one person can pick
 * several options, so the percentages (of people who answered) add up to more than 100%.
 */
function barChart(counts, answered) {
  return h('ul', { class: 'hbars' }, counts.map(({ label, count }) => {
    const pct = percent(count, answered);
    return h('li', {},
      h('span', { class: 'bar-label' }, label),
      s('svg', { class: 'hbar', width: '100%', height: 12, 'aria-hidden': 'true', focusable: 'false' },
        s('rect', { class: 'hbar-track', width: '100%', height: 12 }),
        count ? s('rect', { class: 'hbar-fill', width: `${barWidth(count, answered)}%`, height: 12 }, s('title', {}, `${label}: ${count} (${pct}%)`)) : null),
      h('span', { class: 'bar-value' }, `${count} (${pct}%)`));
  }));
}

/**
 * Scale questions: a histogram, one column per value from min to max on a shared baseline, scaled
 * to the tallest column, with the count above and the value below each one, plus the average and
 * the median. Each column carries its full text ("4: 2 (40%)") for screen readers and as a tooltip.
 */
function scaleChart(q, { t, lang }) {
  const { min, max, average, median, outOfRange } = q.scale;
  const peak = Math.max(0, ...q.counts.map((c) => c.count));
  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const stat = (key, value) => h('div', {}, h('dt', {}, t(key)), h('dd', {}, value === null ? '—' : number.format(value)));
  return [
    h('dl', { class: 'scale-stats' }, stat('detail.scale.average', average), stat('detail.scale.median', median)),
    h('ul', { class: 'vbars', 'aria-label': t('detail.scale.chartLabel', { min, max }) }, q.counts.map(({ option, count }) => {
      const text = t('detail.scale.column', { value: option, count, percent: percent(count, q.answered) });
      const height = columnHeight(count, peak);
      return h('li', { title: text },
        h('span', { class: 'visually-hidden' }, text),
        h('span', { class: 'vbar-count', 'aria-hidden': 'true' }, String(count)),
        s('svg', { class: 'vbar', width: '100%', height: '100%', 'aria-hidden': 'true', focusable: 'false' },
          count ? s('rect', { class: 'vbar-fill', y: `${fixedPercent(100 - height)}%`, width: '100%', height: `${height}%` }) : null),
        h('span', { class: 'vbar-label', 'aria-hidden': 'true' }, option));
    })),
    outOfRange ? h('p', { class: 'hint' }, t('detail.scale.outOfRange', { count: outOfRange })) : null,
  ];
}

const fixedPercent = (n) => Number(n.toFixed(2));

/** Text of one option or answer: yes/no in the reader's language. */
const optionText = (type, value, t) => (type === 'yesno' && (value === 'yes' || value === 'no') ? t(`answer.${value}`) : value);

/** One chart per choice question. Nothing when there are no answers yet. */
export function summaryCharts(summary, i18n) {
  const { t } = i18n;
  if (!summary.questions.length || !summary.kpis.total) return [];
  return [
    h('h3', {}, t('detail.summary')),
    h('div', { class: 'charts' }, summary.questions.map((q) => {
      if (q.type === 'scale' && q.scale) {
        return h('section', { class: 'panel summary' },
          h('h4', {}, `${q.label} `, h('span', { class: 'muted' }, t('detail.answered', { count: q.answered }))),
          scaleChart(q, i18n));
      }
      const counts = q.counts.map(({ option, count }) => ({ label: optionText(q.type, option, t), count }));
      const chart = !q.multiple && counts.length <= MAX_DONUT_SLICES ? donutChart(counts, q.answered) : barChart(counts, q.answered);
      return h('section', { class: 'panel summary' },
        h('h4', {}, `${q.label} `, h('span', { class: 'muted' }, t('detail.answered', { count: q.answered }))),
        chart,
        q.multiple ? h('p', { class: 'hint' }, t('detail.chart.multipleNote')) : null);
    })),
  ];
}

/** Key figures at the top of the results. */
export function kpiTiles({ kpis }, i18n) {
  const { t, tn, formatDate } = i18n;
  const closing = kpis.status === 'open'
    ? (kpis.daysLeft > 0 ? tn('detail.kpi.daysLeft', kpis.daysLeft) : t('detail.kpi.lastDay'))
    : t(statusKey(kpis.status));
  const newest = localDateTime(kpis.lastResponseAt); // the viewer's local date and time
  const tile = (label, value, sub) => h('div', { class: 'kpi' },
    h('dt', {}, label), h('dd', { class: 'kpi-value' }, value), sub ? h('dd', { class: 'kpi-sub' }, sub) : null);
  return h('dl', { class: 'kpis' },
    tile(t('detail.kpi.responses'), String(kpis.total)),
    tile(t('detail.kpi.named'), String(kpis.named), kpis.total ? t('detail.kpi.anonymous', { count: kpis.anonymous }) : ''),
    tile(t('detail.kpi.lastResponse'), newest ? formatDate(newest.date) : '—', newest ? newest.time : ''),
    tile(t('detail.kpi.closing'), closing, closingText(kpis.closesOn, kpis.status, i18n)));
}

/** A paragraph answer is "long" past 5 lines or about 5 lines of text in a table column. */
const LONG_TEXT = { lines: 5, chars: 240 };
export const isLongText = (text) => text.split('\n').length > LONG_TEXT.lines || text.length > LONG_TEXT.chars;

/**
 * A long paragraph answer: cut to 5 lines with "…" (CSS) so one answer does not stretch every row;
 * a tap (or Enter/Space, it is a button) shows the whole text, another tap cuts it again.
 */
function clampedAnswer(text, t) {
  let open = false;
  const button = h('button', { type: 'button', class: 'answer-clamp', 'aria-expanded': 'false', title: t('detail.showFullAnswer') }, text);
  button.addEventListener('click', () => {
    open = !open;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('title', t(open ? 'detail.showLessAnswer' : 'detail.showFullAnswer'));
  });
  return button;
}

/**
 * One answer as the results show it: choice lists joined, yes/no translated, a muted "-" when
 * empty, and long paragraph answers (textarea) cut to 5 lines; short answers never need it.
 */
export function answerText(field, value, t) {
  const text = Array.isArray(value) ? value.join(', ') : optionText(field.type, value ?? '', t);
  if (!text) return h('span', { class: 'muted' }, '-');
  return field.type === 'textarea' && isLongText(text) ? clampedAnswer(text, t) : text;
}

/** The respondent's name, or a muted "Anonymous". */
export const respondentName = (response, t) => response.respondentName || h('span', { class: 'muted' }, t('detail.anonymous'));

/** The creator's delete button for one response: `onDelete(response)` asks and deletes. */
export const deleteResponseForm = (response, t, onDelete) => h('form', { onsubmit: (event) => { event.preventDefault(); onDelete(response); } },
  h('button', { type: 'submit', class: 'icon-button danger', 'aria-label': t('detail.deleteResponseLabel', { number: response.number }), title: t('detail.deleteResponseTitle') }, icon('trash')));

/**
 * Calls `sync` when one of `nodes` changes size, starting when they are first shown, until `signal`
 * aborts or they leave the page (a live update replaced them). No ResizeObserver (tests): nothing.
 */
function watchSize(nodes, sync, signal) {
  if (typeof ResizeObserver !== 'function' || signal?.aborted) return;
  let shown = false;
  const observer = new ResizeObserver(() => {
    if (nodes[0].isConnected) {
      shown = true;
      sync();
    } else if (shown) {
      observer.disconnect();
    }
  });
  for (const node of nodes) observer.observe(node);
  signal?.addEventListener('abort', () => observer.disconnect(), { once: true });
}

/**
 * Where the table's scroll bar goes (`top`, in the table box's coordinates): under the header
 * (`resting`) while that is in the window; once the header scrolls away, at the window's top edge
 * (`viewportTop`), so it follows the reader down; never below `last`, the end of the table.
 */
export const scrollbarTop = ({ resting, viewportTop, last }) => Math.min(Math.max(resting, viewportTop), last);

/**
 * The table in its horizontal scroll box. Its own scroll bar is hidden and replaced by an accent
 * bar under the header row that follows the reader down the table (scrollbarTop), plus a hint;
 * both only while the table overflows. Phones show cards instead (CSS), which never scroll sideways.
 */
function scrollableTable(table, t, signal) {
  // The table scrolls inside `box` (focusable, so arrow keys scroll it too). Its own scroll bar is
  // hidden and replaced by `bar`: a thick accent-colored bar placed right under the header row, a
  // copy that moves the table and follows it. Both appear only while the table overflows.
  const box = h('div', { class: 'table-wrap', tabindex: 0, role: 'region', 'aria-label': t('detail.allAnswers') }, table);
  const size = h('div', { class: 'table-scrollbar-size' });
  const bar = h('div', { class: 'table-scrollbar', hidden: true, 'aria-hidden': 'true' }, size);
  const hint = h('p', { class: 'table-scroll-hint', hidden: true }, icon('forward'), ` ${t('detail.scrollHint')}`);
  const scroller = h('div', { class: 'table-scroller' }, hint, bar, box);
  // Setting the same value fires no scroll event, so the two never loop.
  const follow = (from, to) => { if (Math.abs(to.scrollLeft - from.scrollLeft) > 0.5) to.scrollLeft = from.scrollLeft; };
  bar.addEventListener('scroll', () => follow(bar, box), { passive: true });
  box.addEventListener('scroll', () => follow(box, bar), { passive: true });
  // The bar is drawn 17px above its `top` (CSS margin) and is 16px tall.
  const BAR_OFFSET = 17;
  const place = () => {
    if (bar.hidden) return;
    const head = table.querySelector('thead');
    const top = scrollbarTop({
      resting: box.offsetTop + (head ? head.offsetHeight : 0),
      viewportTop: BAR_OFFSET - scroller.getBoundingClientRect().top,
      last: box.offsetTop + box.offsetHeight - 16 + BAR_OFFSET,
    });
    // CSSOM writes (not style attributes), which the strict CSP allows.
    bar.style.top = `${Math.round(top)}px`;
    bar.classList.toggle('is-floating', top > box.offsetTop + (head ? head.offsetHeight : 0));
  };
  const sync = () => {
    const overflows = box.scrollWidth - box.clientWidth > 1;
    bar.hidden = !overflows;
    hint.hidden = !overflows;
    scroller.classList.toggle('has-scrollbar', overflows);
    if (!overflows) return;
    size.style.width = `${box.scrollWidth}px`;
    place();
    follow(box, bar);
  };
  watchSize([box, table], sync, signal);
  // Follow the page as it scrolls down (once per frame). The listener goes away when the page is
  // left (its signal) or when a live refresh replaces this table (no longer in the document).
  if (typeof window !== 'undefined' && !signal?.aborted) {
    const listening = new AbortController();
    signal?.addEventListener('abort', () => listening.abort(), { once: true });
    let queued = false;
    let shown = false;
    window.addEventListener('scroll', () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (!scroller.isConnected) {
          if (shown) listening.abort();
          return;
        }
        shown = true;
        place();
      });
    }, { passive: true, signal: listening.signal });
  }
  return scroller;
}

/**
 * Every answer: a table on wide screens, one column per question, and one card per response on
 * phones (CSS). The whole table scrolls sideways (accent scroll bar that follows the reader). Without
 * `onDelete(response)` the table is read-only (public results): no
 * delete buttons, no actions column. `signal` ends the scroll buttons' size watching.
 */
export function responsesTable(fields, responses, { t }, onDelete, { signal } = {}) {
  if (!responses.length) return [emptyState(t(onDelete ? 'detail.noAnswers' : 'results.noAnswers'))];
  const rows = responses.map((r) => h('tr', {},
    h('td', { 'data-label': t('detail.columnResponse') }, `#${r.number}`),
    h('td', { 'data-label': t('detail.columnSent'), class: 'nowrap' }, formatTimestamp(r.submittedAt)),
    h('td', { 'data-label': t('detail.columnName') }, respondentName(r, t)),
    fields.map((f) => h('td', { 'data-label': f.label }, answerText(f, r.answers[f.id], t))),
    onDelete && h('td', { class: 'row-actions' }, deleteResponseForm(r, t, onDelete))));
  return [
    h('h3', {}, t('detail.allAnswers')),
    scrollableTable(h('table', { class: 'responsive responses-table' },
      h('thead', {}, h('tr', {},
        h('th', { }, '#'),
        h('th', {}, t('detail.columnSent')),
        h('th', {}, t('detail.columnName')),
        fields.map((f) => h('th', {}, f.label)),
        onDelete && h('th', { class: 'row-actions' }, h('span', { class: 'visually-hidden' }, t('detail.columnActions'))))),
      h('tbody', {}, rows)), t, signal),
  ];
}
