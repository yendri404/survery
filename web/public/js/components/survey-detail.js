import { h, withParts } from '../dom.js';
import { icon } from './icons.js';
import { closingText, notice, statusBadge } from './layout.js';
import { kpiTiles, responsesTable, summaryCharts } from './results.js';

/*
 * Presentational parts of one survey's page: plain data and callbacks in, DOM out. The container
 * (pages/detail.js) fetches, runs the actions and keeps these parts current with live updates.
 */

// ---------- The survey's state (rebuilt on each live update) ----------

export const surveyHeading = (survey, { t }) => h('h1', {}, `${survey.title} `, statusBadge(survey.status, t));

export const closingLine = (survey, i18n) => h('p', { class: 'meta' }, icon('calendar'), ` ${closingText(survey.closesOn, survey.status, i18n)}`);

export const surveyDescription = (survey) => (survey.description ? h('p', { class: 'description' }, survey.description) : null);

/** Closed or expired: what respondents will see, with a link to change the date. Open: nothing. */
export function statusNotice(survey, { t }, editHref) {
  if (survey.status === 'closed') return notice('lock', t('detail.closedNotice'));
  if (survey.status === 'expired') {
    return notice('calendar', ...withParts(t('detail.expiredNotice'), { link: h('a', { href: editHref }, t('detail.expiredNoticeLink')) }));
  }
  return null;
}

export const openCloseButton = (survey, { t }) => (survey.isOpen
  ? h('button', { type: 'submit', class: 'secondary' }, icon('lock'), ` ${t('detail.close')}`)
  : h('button', { type: 'submit', class: 'secondary' }, icon('unlock'), ` ${t('detail.reopen')}`));

// ---------- Side panels ----------

/**
 * Share link with copy / native share / open buttons, and the QR code. `onCopy(button, input)`,
 * `onShare(url)`; the share button shows only when `canShare`. `qrImage` is filled by the page.
 */
export function sharePanel({ t, shareUrl, statusNode, qrImage, canShare, onCopy, onShare, onDownloadQr }) {
  const shareInput = h('input', { id: 'share-url', class: 'share-url', value: shareUrl, readOnly: true, 'aria-label': t('detail.shareLinkLabel'), onfocus: (e) => e.currentTarget.select() });
  return h('section', { class: 'panel share' },
    h('h2', {}, icon('share'), ` ${t('detail.shareHeading')}`),
    h('p', {}, t('detail.shareText')),
    statusNode,
    shareInput,
    h('div', { class: 'button-row' },
      h('button', { type: 'button', 'data-copy': 'share-url', onclick: (e) => onCopy(e.currentTarget, shareInput) }, icon('copy'), ' ', h('span', {}, t('detail.copyLink'))),
      h('button', { type: 'button', class: 'secondary', hidden: !canShare, onclick: () => onShare(shareInput.value) }, icon('share'), ` ${t('detail.share')}`),
      h('a', { class: 'button secondary', href: shareUrl, target: '_blank', rel: 'noopener' }, icon('open'), ` ${t('detail.openForm')}`)),
    h('div', { class: 'qr-block' },
      h('div', { class: 'qr' }, qrImage),
      h('div', { class: 'qr-help' },
        h('h3', {}, icon('qr'), ` ${t('detail.qrHeading')}`),
        h('p', {}, t('detail.qrText')),
        h('button', { type: 'button', class: 'secondary', onclick: onDownloadQr }, icon('download'), ` ${t('detail.qrDownload')}`))));
}

/**
 * Public results switch. While on, the results link with a copy button and a warning: anyone with
 * the link sees every answer and name. `onToggle(on)` gets the new state; `onCopy(button, input)`.
 * `survey` is the creator's survey JSON ({ publicResults, resultsUrl }).
 */
export function publicResultsPanel({ t, survey, onToggle, onCopy }) {
  const on = survey.publicResults && Boolean(survey.resultsUrl);
  const toggle = h('input', { type: 'checkbox', checked: on, 'aria-describedby': 'public-results-warning', onchange: (e) => onToggle(e.currentTarget.checked) });
  const linkInput = on ? h('input', { id: 'results-url', class: 'share-url', value: survey.resultsUrl, readOnly: true, 'aria-label': t('detail.resultsLinkLabel'), onfocus: (e) => e.currentTarget.select() }) : null;
  const warning = t('detail.publicResultsWarning');
  // data-on makes the two states differ for slot(), which compares attributes, not the checked property.
  return h('section', { class: 'panel public-results', 'data-on': String(on) },
    h('label', { class: 'choice switch' }, toggle,
      h('span', {}, h('strong', {}, t('detail.publicResults')),
        on ? null : h('span', { class: 'hint', id: 'public-results-warning' }, warning))),
    on ? [
      h('div', { id: 'public-results-warning' }, notice('alert', warning)),
      linkInput,
      h('div', { class: 'button-row' },
        h('button', { type: 'button', 'data-copy': 'results-url', onclick: (e) => onCopy(e.currentTarget, linkInput) }, icon('copy'), ' ', h('span', {}, t('detail.copyResultsLink'))),
        h('a', { class: 'button secondary', href: survey.resultsUrl, target: '_blank', rel: 'noopener' }, icon('open'), ` ${t('detail.openResults')}`)),
      h('p', { class: 'hint' }, t('detail.publicResultsHint')),
    ] : null);
}

/** Edit link, open/close (`toggleNode` is its current button) and delete. */
export function managePanel({ t, editHref, toggleNode, onToggle, onDelete }) {
  const submitTo = (action) => (event) => {
    event.preventDefault();
    action();
  };
  return h('section', { class: 'panel' },
    h('h2', {}, t('detail.manage')),
    h('div', { class: 'button-row' },
      h('a', { class: 'button secondary', href: editHref }, icon('edit'), ` ${t('detail.edit')}`),
      h('form', { class: 'inline', onsubmit: submitTo(onToggle) }, toggleNode),
      h('form', { class: 'inline', onsubmit: submitTo(onDelete) },
        h('button', { type: 'submit', class: 'danger' }, icon('trash'), ` ${t('detail.delete')}`))),
    h('p', { class: 'hint' }, t('detail.manageHint')));
}

// ---------- Results ----------

/**
 * Heading with the CSV export, key figures, charts and the responses table. `onExport()`: one CSV
 * (the API picks "," or ";" from the answers).
 * Without actions (public results) everything is read-only: no exports, no delete buttons.
 */
export const resultsContent = ({ survey, summary, responses }, i18n, { onExport, onDeleteResponse } = {}) => [
  h('div', { class: 'page-head' },
    h('h2', {}, i18n.t('detail.responses', { count: responses.length })),
    onExport && h('div', { class: 'button-row' },
      h('button', { type: 'button', class: 'secondary', onclick: () => onExport() }, icon('download'), ` ${i18n.t('detail.exportCsv')}`))),
  kpiTiles(summary, i18n),
  summaryCharts(summary, i18n),
  responsesTable(survey.fields, responses, i18n, onDeleteResponse),
];
