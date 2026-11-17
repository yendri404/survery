import { saveBlob } from '../api.js';
import { icon } from '../components/icons.js';
import { backLink, closingText, notice, statusBadge } from '../components/layout.js';
import { kpiTiles, responsesTable, summaryCharts } from '../components/results.js';
import { h, withParts } from '../dom.js';

/** Briefly shows `text` on a button ("Copied!"), then restores its label. */
function flashButton(btn, text) {
  const label = btn.querySelector('span') ?? btn;
  const original = label.textContent;
  label.textContent = text;
  btn.classList.add('done');
  setTimeout(() => {
    label.textContent = original;
    btn.classList.remove('done');
  }, 2000);
}

function copyLink(btn, input, t) {
  input.select();
  input.setSelectionRange(0, input.value.length); // iOS needs an explicit range
  // navigator.clipboard only exists on HTTPS/localhost; fall back for plain-HTTP intranets.
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(input.value).then(
      () => flashButton(btn, t('client.copied')),
      () => { document.execCommand('copy'); flashButton(btn, t('client.copied')); },
    );
  } else {
    flashButton(btn, document.execCommand('copy') ? t('client.copied') : t('client.copyFallback'));
  }
}

/** Container: one survey's link, QR code, management actions and live results. */
export async function detailPage(app, { params, signal }) {
  const { t } = app;
  const { id } = params;
  const path = `/surveys/${id}`;

  const loadResults = () => Promise.all([
    app.api.get(path, { signal }).then((r) => r.survey),
    app.api.get(`${path}/summary`, { signal }),
    app.api.get(`${path}/responses`, { signal }).then((r) => r.responses),
  ]);
  const [survey, summary, responses] = await loadResults();
  const { status } = survey;

  /** Runs an action; any failure shows the error page, like a failed form post did. */
  const act = async (action) => {
    try {
      await action();
    } catch (err) {
      app.showError(err);
    }
  };

  const download = (file, fallbackName) => act(async () => {
    const { blob, name } = await app.api.file(file, fallbackName);
    saveBlob(blob, name);
  });

  // ---------- Results region (re-rendered by live updates) ----------
  const resultsContent = ([s, sum, list]) => [
    h('div', { class: 'page-head' },
      h('h2', {}, t('detail.responses', { count: list.length })),
      h('div', { class: 'button-row' },
        h('button', { type: 'button', class: 'secondary', onclick: () => download(`${path}/export.csv?delimiter=semicolon&lang=${app.i18n.lang}`, `sharevy-survey-${id}-responses.csv`) },
          icon('download'), ` ${t('detail.exportExcel')}`),
        h('button', { type: 'button', class: 'secondary', onclick: () => download(`${path}/export.csv?lang=${app.i18n.lang}`, `sharevy-survey-${id}-responses.csv`) },
          icon('download'), ` ${t('detail.exportCsv')}`))),
    kpiTiles(sum, app.i18n),
    summaryCharts(sum, app.i18n),
    responsesTable(s.fields, list, app.i18n, (response) => {
      if (!window.confirm(t('detail.deleteResponseConfirm', { id: response.id }))) return;
      act(async () => {
        await app.api.del(`${path}/responses/${response.id}`);
        await app.navigate(`${path}?msg=response-deleted`);
      });
    }),
  ];
  const results = h('section', { id: 'responses' }, resultsContent([survey, summary, responses]));

  // ---------- Share ----------
  const shareInput = h('input', { id: 'share-url', class: 'share-url', value: survey.shareUrl, readOnly: true, 'aria-label': t('detail.shareLinkLabel'), onfocus: (e) => e.currentTarget.select() });
  const copyButton = h('button', { type: 'button', 'data-copy': 'share-url', onclick: (e) => copyLink(e.currentTarget, shareInput, t) }, icon('copy'), ' ', h('span', {}, t('detail.copyLink')));
  // Native share sheet (mobile): only shown when the browser supports it (it requires HTTPS).
  const shareButton = h('button', {
    type: 'button', class: 'secondary', hidden: !navigator.share,
    onclick: () => navigator.share({ title: survey.title, url: shareInput.value }).catch(() => {}),
  }, icon('share'), ` ${t('detail.share')}`);
  const qrImage = h('img', { alt: t('detail.qrLabel'), width: 240, height: 240 });
  const expiredLink = h('a', { href: `${path}/edit` }, t('detail.expiredNoticeLink'));

  const side = h('aside', { class: 'detail-side' },
    h('section', { class: 'panel share' },
      h('h2', {}, icon('share'), ` ${t('detail.shareHeading')}`),
      h('p', {}, t('detail.shareText')),
      status === 'closed' ? notice('lock', t('detail.closedNotice')) : null,
      status === 'expired' ? notice('calendar', ...withParts(t('detail.expiredNotice'), { link: expiredLink })) : null,
      shareInput,
      h('div', { class: 'button-row' },
        copyButton,
        shareButton,
        h('a', { class: 'button secondary', href: survey.shareUrl, target: '_blank', rel: 'noopener' }, icon('open'), ` ${t('detail.openForm')}`)),
      h('div', { class: 'qr-block' },
        h('div', { class: 'qr' }, qrImage),
        h('div', { class: 'qr-help' },
          h('h3', {}, icon('qr'), ` ${t('detail.qrHeading')}`),
          h('p', {}, t('detail.qrText')),
          h('button', { type: 'button', class: 'secondary', onclick: () => download(`${path}/qr.png`, `sharevy-survey-${id}-qr.png`) },
            icon('download'), ` ${t('detail.qrDownload')}`)))),
    h('section', { class: 'panel' },
      h('h2', {}, t('detail.manage')),
      h('div', { class: 'button-row' },
        h('a', { class: 'button secondary', href: `${path}/edit` }, icon('edit'), ` ${t('detail.edit')}`),
        h('form', {
          class: 'inline',
          onsubmit: (event) => {
            event.preventDefault();
            act(async () => {
              await app.api.patch(path, { isOpen: !survey.isOpen });
              await app.navigate(`${path}?msg=${survey.isOpen ? 'closed' : 'opened'}`);
            });
          },
        }, survey.isOpen
          ? h('button', { type: 'submit', class: 'secondary' }, icon('lock'), ` ${t('detail.close')}`)
          : h('button', { type: 'submit', class: 'secondary' }, icon('unlock'), ` ${t('detail.reopen')}`)),
        h('form', {
          class: 'inline',
          onsubmit: (event) => {
            event.preventDefault();
            if (!window.confirm(t('detail.deleteConfirm'))) return;
            act(async () => {
              await app.api.del(path);
              await app.navigate('/surveys?msg=deleted');
            });
          },
        }, h('button', { type: 'submit', class: 'danger' }, icon('trash'), ` ${t('detail.delete')}`))),
      h('p', { class: 'hint' }, t('detail.manageHint'))));

  return {
    title: survey.title,
    body: [
      backLink('/surveys', t('detail.back')),
      h('h1', {}, `${survey.title} `, statusBadge(status, t)),
      h('p', { class: 'meta' }, icon('calendar'), ` ${closingText(survey.closesOn, status, app.i18n)}`),
      survey.description ? h('p', { class: 'description' }, survey.description) : null,
      h('div', { class: 'detail-layout' }, side, h('div', { class: 'detail-main' }, results)),
    ],
    mounted: () => {
      // The QR code needs the Bearer header, so it is fetched and shown from a blob URL.
      app.api.file(`${path}/qr.svg`, 'qr.svg').then(({ blob }) => {
        if (signal.aborted) return;
        const url = URL.createObjectURL(blob);
        qrImage.src = url;
        signal.addEventListener('abort', () => URL.revokeObjectURL(url), { once: true });
      }).catch(() => {});
      app.liveRegion(results, `${path}/events`, async () => resultsContent(await loadResults()), signal);
    },
  };
}
