// Small progressive enhancements. Every page works without this file except the question builder.

// Interface strings in the page language, from the JSON data block the server puts in <head>.
const i18n = (() => {
  try {
    return JSON.parse(document.getElementById('i18n-client')?.textContent || '{}');
  } catch {
    return {};
  }
})();
const t = (key, params = {}) => (i18n[key] ?? key)
  .replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match));
/** Plural form: "<key>.one" or "<key>.other", like i18n.tn on the server. */
const tn = (key, count) =>
  t(`${key}.${new Intl.PluralRules(document.documentElement.lang || 'en').select(count) === 'one' ? 'one' : 'other'}`, { count });

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

// Copy-to-clipboard buttons: <button data-copy="input-id">
document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-copy]');
  if (!btn) return;
  const input = document.getElementById(btn.dataset.copy);
  if (!input) return;
  input.select();
  input.setSelectionRange(0, input.value.length); // iOS needs an explicit range
  // navigator.clipboard only exists on HTTPS/localhost; fall back for plain-HTTP intranets.
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(input.value).then(
      () => flashButton(btn, t('copied')),
      () => { document.execCommand('copy'); flashButton(btn, t('copied')); },
    );
  } else {
    flashButton(btn, document.execCommand('copy') ? t('copied') : t('copyFallback'));
  }
});

// Native share sheet (mobile): <button data-share="input-id" data-share-title="..." hidden>
// Only shown when the browser supports it (it requires HTTPS).
for (const btn of document.querySelectorAll('[data-share]')) {
  if (!navigator.share) continue;
  btn.hidden = false;
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.share);
    navigator.share({ title: btn.dataset.shareTitle, url: input.value }).catch(() => {});
  });
}

// Selecting the share link with one tap.
for (const input of document.querySelectorAll('.share-url')) {
  input.addEventListener('focus', () => input.select());
}

// Light/dark theme switch: <button data-theme-toggle hidden>. public/theme.js applies the saved choice early.
{
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  const current = () => root.dataset.theme ?? (prefersDark.matches ? 'dark' : 'light');
  const syncLabels = () => {
    const label = current() === 'dark' ? t('themeToLight') : t('themeToDark');
    for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
  };
  for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
    btn.hidden = false;
    btn.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('sharevy-theme', next); } catch { /* storage blocked: theme lasts for this page only */ }
      syncLabels();
    });
  }
  prefersDark.addEventListener('change', syncLabels);
  syncLabels();
}

// Language menu: <details data-lang-menu>. It opens and closes natively; this only closes it on a
// click outside or on Escape, like other menus.
{
  const menus = [...document.querySelectorAll('[data-lang-menu]')];
  document.addEventListener('click', (event) => {
    for (const menu of menus) if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const menu of menus) {
      if (!menu.open) continue;
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
}

// Live updates: <section id="..." data-live="/events-url">. When the server reports a change, the
// page re-fetches its own HTML and swaps that section, so it shows exactly what a refresh would.
if (window.EventSource) {
  let announcer;
  const announce = (text) => {
    if (!announcer) {
      announcer = Object.assign(document.createElement('div'), { className: 'visually-hidden' });
      announcer.setAttribute('aria-live', 'polite');
      document.body.append(announcer);
    }
    announcer.textContent = '';
    setTimeout(() => { announcer.textContent = text; }, 50);
  };

  for (const region of document.querySelectorAll('[data-live][id]')) {
    let running = false;
    let queued = false;

    const refresh = async () => {
      if (running) { queued = true; return; }
      running = true;
      try {
        const res = await fetch(window.location.href, { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) return;
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const fresh = doc.getElementById(region.id);
        if (fresh && fresh.innerHTML !== region.innerHTML) {
          region.innerHTML = fresh.innerHTML;
          region.classList.remove('live-updated');
          void region.offsetWidth; // restart the highlight animation
          region.classList.add('live-updated');
          announce(t('resultsUpdated'));
        }
      } catch {
        // Network hiccup: the next event or reconnection triggers another refresh.
      } finally {
        running = false;
        if (queued) { queued = false; refresh(); }
      }
    };

    const source = new EventSource(region.dataset.live);
    let opened = false;
    source.addEventListener('change', refresh);
    // After a reconnection, events may have been missed while offline: refresh once.
    source.addEventListener('open', () => { if (opened) refresh(); opened = true; });
    window.addEventListener('pagehide', () => source.close());
  }
}

/*
 * Number questions accept only a number: digits, one decimal point and a minus sign at the start.
 * Letters, "e", "+" and a second point are blocked while typing, pasting or dropping; a comma is
 * turned into a point ("4,5" -> "4.5"). The field becomes a text input with a decimal keyboard
 * (inputmode="decimal", set by the server), because a number input hides the typed text and the
 * cursor position from scripts. Up/Down arrows still add or subtract 1. Without JavaScript the
 * field stays a native number input, and the server always validates the value.
 */
{
  const NUMBER_TEXT = /^-?\d*\.?\d*$/;
  const normalize = (text) => text.replace(/,/g, '.').replace(/\s+/g, '');

  for (const input of document.querySelectorAll('.respondent-form input[type="number"]')) {
    input.type = 'text';
    if (!input.inputMode) input.inputMode = 'decimal';
    let lastGood = NUMBER_TEXT.test(input.value) ? input.value : '';

    input.addEventListener('beforeinput', (event) => {
      if (!event.inputType.startsWith('insert') || event.inputType === 'insertCompositionText') return;
      const data = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
      const text = normalize(data);
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      const next = input.value.slice(0, start) + text + input.value.slice(end);
      if (!NUMBER_TEXT.test(next)) {
        event.preventDefault();
      } else if (text !== data) {
        // Insert the cleaned text ourselves (comma -> point) and report it like a normal edit.
        event.preventDefault();
        input.setRangeText(text, start, end, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    // Safety net for what beforeinput cannot cancel (IME composition, autofill, old browsers).
    input.addEventListener('input', () => {
      const value = normalize(input.value);
      if (NUMBER_TEXT.test(value)) {
        if (value !== input.value) input.value = value;
        lastGood = value;
      } else {
        input.value = lastGood;
      }
    });

    input.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const current = Number(input.value || 0);
      if (!Number.isFinite(current)) return;
      event.preventDefault();
      // Rounding keeps 0.1 + 1 from showing as 1.1000000000000001.
      input.value = String(Number((current + (event.key === 'ArrowUp' ? 1 : -1)).toFixed(10)));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

// Open the calendar when tapping anywhere on a date field, not only on its small icon.
document.addEventListener('click', (event) => {
  const input = event.target.closest?.('input[type="date"]');
  if (!input || typeof input.showPicker !== 'function') return;
  try {
    input.showPicker();
  } catch {
    // Some browsers refuse outside a direct user gesture; the native picker still works.
  }
});

/** The alert icon, built like icon('alert') in src/views.js. */
function alertIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01');
  svg.append(path);
  return svg;
}

/*
 * Respondent form: answers are checked here with the same rules and messages as validateAnswers()
 * and parseRespondentName() in src/surveys.js, so a mistake shows at once, without sending the
 * form and reloading the page. Errors use the server's markup (a .field-error under the question,
 * the .errors summary above the form). The server still checks everything; without JavaScript the
 * browser's own checks and the server's error page work as before.
 */
{
  const form = document.querySelector('form.respondent-form');
  if (form) {
    let limits = {};
    try { limits = JSON.parse(form.dataset.limits || '{}'); } catch { /* keep server-only checks */ }
    const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValidDate = (value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const d = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
    };
    const tooLong = (value, max) => max !== undefined && value.length > max;

    // One entry per question (plus the optional name), in page order.
    const nameWrap = form.querySelector('.respondent-name');
    const entries = [
      ...(nameWrap ? [{ wrap: nameWrap, type: 'name', control: nameWrap.querySelector('#respondent_name'), label: t('respond.yourName') }] : []),
      ...[...form.querySelectorAll('.field[data-type]')].map((wrap) => ({
        wrap,
        type: wrap.dataset.type,
        required: wrap.hasAttribute('data-required'),
        label: wrap.dataset.label,
        control: wrap.querySelector('[id^="fld_"]'),
      })),
    ].filter((entry) => entry.control);

    /** The message for one entry's current value, or undefined when it is valid. */
    function check(entry) {
      const inputs = [...entry.wrap.querySelectorAll('input, select, textarea')];
      if (entry.type === 'name') {
        const max = limits.respondentName;
        return tooLong(entry.control.value.trim(), max) ? t('validation.respondentNameTooLong', { max }) : undefined;
      }
      if (entry.type === 'checkbox') {
        return entry.required && !inputs.some((i) => i.checked) ? t('validation.required') : undefined;
      }
      const value = ['radio', 'yesno'].includes(entry.type)
        ? (inputs.find((i) => i.checked)?.value ?? '').trim()
        : entry.control.value.trim();
      if (!value) return entry.required ? t('validation.required') : undefined;
      switch (entry.type) {
        case 'text':
          return tooLong(value, limits.text) ? t('validation.tooLong', { max: limits.text }) : undefined;
        case 'textarea':
          return tooLong(value, limits.textarea) ? t('validation.tooLong', { max: limits.textarea }) : undefined;
        case 'number':
          return Number.isFinite(Number(value)) ? undefined : t('validation.number');
        case 'email':
          return value.length > 254 || !EMAIL.test(value) ? t('validation.email') : undefined;
        case 'date':
          return isValidDate(value) ? undefined : t('validation.date');
        case 'select':
          return [...entry.control.options].some((o) => o.value && o.value === value) ? undefined : t('validation.invalidOption');
        case 'radio':
        case 'yesno':
          return inputs.some((i) => i.value === value) ? undefined : t('validation.invalidOption');
        default:
          return undefined;
      }
    }

    // Messages shown now, by entry; server-rendered errors (after a rejected submission) count too.
    const shown = new Map();
    for (const entry of entries) {
      const text = entry.wrap.querySelector(':scope > .field-error')?.textContent.trim();
      if (text) shown.set(entry, text);
    }

    function show(entry, message) {
      const errorId = `${entry.control.id}_error`;
      entry.wrap.querySelector(':scope > .field-error')?.remove();
      if (message) {
        const p = Object.assign(document.createElement('p'), { className: 'field-error', id: errorId });
        p.append(alertIcon(), ` ${message}`);
        entry.wrap.append(p);
        entry.wrap.classList.add('has-error');
        entry.control.setAttribute('aria-describedby', errorId);
        entry.control.setAttribute('aria-invalid', 'true');
        shown.set(entry, message);
      } else {
        entry.wrap.classList.remove('has-error');
        entry.control.removeAttribute('aria-describedby');
        entry.control.removeAttribute('aria-invalid');
        shown.delete(entry);
      }
    }

    // The summary above the form, like errorList() in src/views.js.
    function renderSummary() {
      const old = form.previousElementSibling?.classList.contains('errors') ? form.previousElementSibling : null;
      const problems = entries.filter((entry) => shown.has(entry));
      if (!problems.length) {
        old?.remove();
        return;
      }
      const list = document.createElement('ul');
      list.append(Object.assign(document.createElement('li'), { textContent: tn('respond.checkAnswers', problems.length) }));
      for (const entry of problems) {
        const link = Object.assign(document.createElement('a'), { href: `#${entry.control.id}`, textContent: entry.label });
        const item = document.createElement('li');
        item.append(link, `: ${shown.get(entry)}`);
        list.append(item);
      }
      const summary = Object.assign(document.createElement('div'), { className: 'errors' });
      summary.setAttribute('role', 'alert');
      summary.append(alertIcon(), list);
      if (old) old.replaceWith(summary);
      else form.before(summary);
    }

    // The browser's own bubbles would compete with the inline messages.
    form.noValidate = true;

    form.addEventListener('submit', (event) => {
      for (const entry of entries) show(entry, check(entry));
      renderSummary();
      const first = entries.find((entry) => shown.has(entry));
      if (!first) return;
      event.preventDefault();
      first.wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const focusable = first.control.matches('fieldset') ? first.control.querySelector('input') : first.control;
      focusable.focus({ preventScroll: true });
    });

    // A question that shows an error updates as soon as its answer changes, and clears when valid.
    const recheck = (event) => {
      const entry = entries.find((e) => e.wrap.contains(event.target));
      if (!entry || !shown.has(entry)) return;
      const message = check(entry);
      if (message === shown.get(entry)) return;
      show(entry, message);
      renderSummary();
    };
    form.addEventListener('input', recheck);
    form.addEventListener('change', recheck);
  }
}

// Confirmation for destructive forms: <form data-confirm="Are you sure?">
document.addEventListener('submit', (event) => {
  const message = event.target.dataset?.confirm;
  if (message && !window.confirm(message)) event.preventDefault();
});
