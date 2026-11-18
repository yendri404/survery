import { s } from '../dom.js';

/** Stroke icons drawn on a 24x24 grid, as SVG elements. */
const ICONS = {
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  copy: [['rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }], ['path', { d: 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1' }]],
  open: [['path', { d: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' }]],
  share: [['path', { d: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v13M7 8l5-5 5 5' }]],
  edit: [['path', { d: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4' }]],
  trash: [['path', { d: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6' }]],
  lock: [['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }], ['path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }]],
  unlock: [['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }], ['path', { d: 'M8 11V7a4 4 0 0 1 7.5-2' }]],
  download: [['path', { d: 'M12 4v12M6 10l6 6 6-6M4 20h16' }]],
  logout: [['path', { d: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10' }]],
  check: [['path', { d: 'M5 12l5 5 9-10' }]],
  back: [['path', { d: 'M15 6l-6 6 6 6' }]],
  forward: [['path', { d: 'M9 6l6 6-6 6' }]],
  alert: [['path', { d: 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01' }]],
  qr: [['path', { d: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM16 16h2v2h-2z' }]],
  calendar: [['rect', { x: 3, y: 5, width: 18, height: 16, rx: 2 }], ['path', { d: 'M3 10h18M8 3v4M16 3v4' }]],
  inbox: [['path', { d: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6l2-8z' }]],
  moon: [['path', { d: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z' }]],
  globe: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9s1.3-6.5 3.8-9z' }]],
  sun: [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' }]],
  // Question builder
  up: [['path', { d: 'M12 19V5M5 12l7-7 7 7' }]],
  down: [['path', { d: 'M12 5v14M19 12l-7 7-7-7' }]],
  refresh: [['path', { d: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7' }]],
  duplicate: [['path', { d: 'M9 9h11v11H9zM5 15H4V4h11v1' }]],
};

/** Decorative icon (hidden from screen readers: the text next to it says what it is). */
export const icon = (name, extraClass = '') =>
  s('svg', { class: extraClass ? `icon ${extraClass}` : 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    ICONS[name].map(([tag, attrs]) => s(tag, attrs)));
