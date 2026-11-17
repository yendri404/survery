// Small progressive enhancements. Every page works without this file except the question builder.

// Interface strings in the page language, from the JSON data block the server puts in <head>.
const i18n = (() => {
  try {
    return JSON.parse(document.getElementById('i18n-client')?.textContent || '{}');
  } catch {
    return {};
  }
})();
const t = (key) => i18n[key] ?? key;

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

// Confirmation for destructive forms: <form data-confirm="Are you sure?">
document.addEventListener('submit', (event) => {
  const message = event.target.dataset?.confirm;
  if (message && !window.confirm(message)) event.preventDefault();
});
