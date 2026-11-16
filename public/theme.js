// Applies the theme saved by the theme button before the page is painted (loaded in <head>).
// Without a saved choice, the CSS follows the operating system setting.
try {
  const saved = localStorage.getItem('sharevy-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch {
  // Storage can be blocked (private mode); the OS setting is used instead.
}
