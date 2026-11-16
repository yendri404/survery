// Small progressive enhancements. Every page works without this file except the question builder.

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
      () => flashButton(btn, 'Copied!'),
      () => { document.execCommand('copy'); flashButton(btn, 'Copied!'); },
    );
  } else {
    flashButton(btn, document.execCommand('copy') ? 'Copied!' : 'Select and copy the link');
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

// Confirmation for destructive forms: <form data-confirm="Are you sure?">
document.addEventListener('submit', (event) => {
  const message = event.target.dataset?.confirm;
  if (message && !window.confirm(message)) event.preventDefault();
});
