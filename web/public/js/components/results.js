import { MAX_DONUT_SLICES, barWidth, donutSlices, percent } from '../charts.js';
import { h, s } from '../dom.js';
import { formatTimestamp } from '../format.js';
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

/** Text of one option or answer: yes/no in the reader's language. */
const optionText = (type, value, t) => (type === 'yesno' && (value === 'yes' || value === 'no') ? t(`answer.${value}`) : value);

/** One chart per choice question. Nothing when there are no answers yet. */
export function summaryCharts(summary, { t }) {
  if (!summary.questions.length || !summary.kpis.total) return [];
  return [
    h('h3', {}, t('detail.summary')),
    h('div', { class: 'charts' }, summary.questions.map((q) => {
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
  const newest = kpis.lastResponseAt; // ISO 8601 UTC
  const tile = (label, value, sub) => h('div', { class: 'kpi' },
    h('dt', {}, label), h('dd', { class: 'kpi-value' }, value), sub ? h('dd', { class: 'kpi-sub' }, sub) : null);
  return h('dl', { class: 'kpis' },
    tile(t('detail.kpi.responses'), String(kpis.total)),
    tile(t('detail.kpi.named'), String(kpis.named), kpis.total ? t('detail.kpi.anonymous', { count: kpis.anonymous }) : ''),
    tile(t('detail.kpi.lastResponse'), newest ? formatDate(newest.slice(0, 10)) : '—', newest ? `${newest.slice(11, 16)} UTC` : ''),
    tile(t('detail.kpi.closing'), closing, closingText(kpis.closesOn, kpis.status, i18n)));
}

/** Every answer: a table on wide screens, one card per response on phones (CSS). */
export function responsesTable(fields, responses, { t }, onDelete) {
  if (!responses.length) return [emptyState(t('detail.noAnswers'))];
  const answerText = (field, value) => {
    const text = Array.isArray(value) ? value.join(', ') : optionText(field.type, value ?? '', t);
    return text || h('span', { class: 'muted' }, '-');
  };
  const rows = responses.map((r) => h('tr', {},
    h('td', { 'data-label': t('detail.columnResponse') }, `#${r.id}`),
    h('td', { 'data-label': t('detail.columnSent'), class: 'nowrap' }, formatTimestamp(r.submittedAt)),
    h('td', { 'data-label': t('detail.columnName') }, r.respondentName ? r.respondentName : h('span', { class: 'muted' }, t('detail.anonymous'))),
    fields.map((f) => h('td', { 'data-label': f.label }, answerText(f, r.answers[f.id]))),
    h('td', { class: 'row-actions' },
      h('form', { onsubmit: (event) => { event.preventDefault(); onDelete(r); } },
        h('button', { type: 'submit', class: 'icon-button danger', 'aria-label': t('detail.deleteResponseLabel', { id: r.id }), title: t('detail.deleteResponseTitle') }, icon('trash'))))));
  return [
    h('h3', {}, t('detail.allAnswers')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'responsive' },
      h('thead', {}, h('tr', {},
        h('th', {}, '#'), h('th', {}, t('detail.columnSent')), h('th', {}, t('detail.columnName')),
        fields.map((f) => h('th', {}, f.label)),
        h('th', {}, h('span', { class: 'visually-hidden' }, t('detail.columnActions'))))),
      h('tbody', {}, rows))),
  ];
}
