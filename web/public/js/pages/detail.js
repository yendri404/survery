import { saveBlob } from '../api.js';
import { backLink } from '../components/layout.js';
import {
  closingLine, managePanel, openCloseButton, publicResultsPanel, resultsContent, sharePanel, statusNotice, surveyDescription, surveyHeading,
} from '../components/survey-detail.js';
import { h, slot } from '../dom.js';
import { viewerTimeZone } from '../format.js';

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


/** Container: one survey's link, QR code, public results link, management actions and live results. */
export async function detailPage(app, { params, signal }) {
  const { t, i18n } = app;
  const { id } = params;
  const path = `/surveys/${id}`;
  const editHref = `${path}/edit`;

  const load = async () => {
    const [survey, summary, responses] = await Promise.all([
      app.api.get(path, { signal }).then((r) => r.survey),
      app.api.get(`${path}/summary`, { signal }),
      app.api.get(`${path}/responses`, { signal }).then((r) => r.responses),
    ]);
    return { survey, summary, responses };
  };
  const data = await load();
  // The latest survey state: live updates replace it, so actions never use a stale one.
  let current = data.survey;

  // ---------- Actions ----------
  /** Runs an action (download, open/close, delete); a failure replaces the page with an error panel. */
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
  const resultsActions = {
    // Comma is the API's default delimiter; semicolon suits Excel with regional settings that use ";".
    // tz: times in the CSV match the ones on screen (the viewer's zone).
    onExport: (delimiter) => download(`${path}/export.csv?${delimiter === 'semicolon' ? 'delimiter=semicolon&' : ''}lang=${i18n.lang}&tz=${encodeURIComponent(viewerTimeZone())}`, `sharevy-survey-${id}-responses.csv`),
    onDeleteResponse: (response) => {
      if (!window.confirm(t('detail.deleteResponseConfirm', { number: response.number }))) return;
      act(async () => {
        await app.api.del(`${path}/responses/${response.id}`);
        await app.navigate(`${path}?msg=response-deleted`);
      });
    },
  };
  const toggleOpen = () => {
    const closing = current.isOpen;
    act(async () => {
      await app.api.patch(path, { isOpen: !closing });
      await app.navigate(`${path}?msg=${closing ? 'closed' : 'opened'}`);
    });
  };
  /** Public results on or off: updated in place, keeping the focus on the switch. */
  const setPublicResults = (on) => act(async () => {
    const { survey } = await app.api.patch(path, { publicResults: on });
    if (signal.aborted) return;
    showSurvey(survey);
    publicSlot.node.querySelector?.('input[type="checkbox"]')?.focus();
  });
  const deleteSurvey = () => {
    if (!window.confirm(t('detail.deleteConfirm'))) return;
    act(async () => {
      await app.api.del(path);
      await app.navigate('/surveys?msg=deleted');
    });
  };

  // ---------- Survey state shown outside the results (kept current by live updates) ----------
  const stateParts = [
    (s) => surveyHeading(s, i18n),
    (s) => closingLine(s, i18n),
    surveyDescription,
    (s) => statusNotice(s, i18n, editHref),
    (s) => openCloseButton(s, i18n),
    (s) => publicResultsPanel({ t, survey: s, onToggle: setPublicResults, onCopy: (button, input) => copyLink(button, input, t) }),
  ];
  const slots = stateParts.map((build) => slot(build(current)));
  const [headingSlot, closingSlot, descriptionSlot, noticeSlot, toggleSlot, publicSlot] = slots;
  // Green while the survey accepts answers, blue once it is closed or expired (kept live).
  const toneOf = (survey) => (survey.status === 'open' ? 'open' : undefined);
  const showSurvey = (survey) => {
    current = survey;
    stateParts.forEach((build, i) => slots[i].set(build(survey)));
    app.setTone(toneOf(survey));
  };

  // ---------- Layout ----------
  const results = h('section', { id: 'responses' }, resultsContent(data, i18n, resultsActions));
  const qrImage = h('img', { alt: t('detail.qrLabel'), width: 240, height: 240 });
  const side = h('aside', { class: 'detail-side' },
    sharePanel({
      t,
      shareUrl: current.shareUrl,
      statusNode: noticeSlot.node,
      qrImage,
      // Native share sheet (mobile): only shown when the browser supports it (it requires HTTPS).
      canShare: Boolean(navigator.share),
      onCopy: (button, input) => copyLink(button, input, t),
      onShare: (url) => navigator.share({ title: current.title, url }).catch(() => {}),
      onDownloadQr: () => download(`${path}/qr.png`, `sharevy-survey-${id}-qr.png`),
    }),
    publicSlot.node,
    managePanel({ t, editHref, toggleNode: toggleSlot.node, onToggle: toggleOpen, onDelete: deleteSurvey }));

  return {
    title: current.title,
    tone: toneOf(current),
    body: [
      backLink('/surveys', t('detail.back')),
      headingSlot.node,
      closingSlot.node,
      descriptionSlot.node,
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
      // A change may be new answers or a new state (closed in another tab, edited): both are refreshed.
      app.liveRegion(results, `${path}/events`, async () => {
        const fresh = await load();
        if (!signal.aborted) showSurvey(fresh.survey);
        return resultsContent(fresh, i18n, resultsActions);
      }, signal);
    },
  };
}
