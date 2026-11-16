// Small progressive enhancements. Every page works without this file except the question builder.

// Copy-to-clipboard buttons: <button data-copy="input-id">
document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-copy]');
  if (!btn) return;
  const input = document.getElementById(btn.dataset.copy);
  if (!input) return;
  const done = () => {
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  };
  input.select();
  // navigator.clipboard only exists on HTTPS/localhost; fall back for plain-HTTP intranets.
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(input.value).then(done, () => { document.execCommand('copy'); done(); });
  } else {
    document.execCommand('copy');
    done();
  }
});

// Confirmation for destructive forms: <form data-confirm="Are you sure?">
document.addEventListener('submit', (event) => {
  const message = event.target.dataset?.confirm;
  if (message && !window.confirm(message)) event.preventDefault();
});
