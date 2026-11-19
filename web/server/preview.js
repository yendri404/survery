/**
 * Link previews: the Open Graph tags that chat apps and social sites (WhatsApp, Telegram, Slack,
 * Discord...) read to draw a card for a pasted link. Their bots do not run JavaScript, so the tags
 * must come in the HTML the server sends. Pure functions: the server picks the data, these build
 * the markup. Every value is escaped, because survey titles and descriptions are user text.
 */
export const SITE_NAME = 'Sharevy';
export const DEFAULT_DESCRIPTION = 'Create a survey, share one link and watch the answers arrive live.';
export const SURVEY_DESCRIPTION = 'Answer this survey on Sharevy.';
/** Image shown on the card (PNG: several apps refuse SVG). */
export const PREVIEW_IMAGE = '/public/logo.png';
/** Longest description on a card; apps cut longer ones anyway. */
export const MAX_DESCRIPTION = 200;

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** Whitespace collapsed and cut to `max` characters (code points), with "…" when cut. */
export function clip(text, max) {
  const chars = [...String(text ?? '').replace(/\s+/g, ' ').trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

// A host name or bracketed IPv6 address, with an optional port. Anything else is not used in URLs.
const HOST = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

/**
 * The origin the visitor used ("https://host"), or null when it cannot be told safely. A configured
 * base URL wins; else the Host header, with https when a proxy says so (X-Forwarded-Proto).
 */
export function requestOrigin(headers, baseUrl) {
  if (baseUrl) return baseUrl;
  const host = headers.host;
  if (typeof host !== 'string' || !HOST.test(host)) return null;
  const proto = String(headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
  return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}

/** A configured base URL as an origin with no trailing slash, or null when it is not an http(s) URL. */
export function normalizeBaseUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/**
 * The preview of a page: the survey's own title and description for a share link (`survey` from
 * GET /public/surveys/:token), the generic one otherwise. `origin` null leaves out the URL tags.
 */
export function pagePreview({ survey, origin, pathname }) {
  const title = survey ? clip(survey.title, 200) || SITE_NAME : SITE_NAME;
  const description = survey ? clip(survey.description, MAX_DESCRIPTION) || SURVEY_DESCRIPTION : DEFAULT_DESCRIPTION;
  return {
    documentTitle: survey ? `${title} · ${SITE_NAME}` : SITE_NAME,
    title,
    description,
    url: origin ? origin + pathname : null,
    image: origin ? origin + PREVIEW_IMAGE : null,
  };
}

/** The <title> and <meta> tags of a preview. */
export function previewTags(preview) {
  const meta = (attr, name, content) => (content ? `\n<meta ${attr}="${name}" content="${escapeHtml(content)}">` : '');
  return `<title>${escapeHtml(preview.documentTitle)}</title>`
    + meta('property', 'og:site_name', SITE_NAME)
    + meta('property', 'og:type', 'website')
    + meta('property', 'og:title', preview.title)
    + meta('property', 'og:description', preview.description)
    + meta('property', 'og:url', preview.url)
    + meta('property', 'og:image', preview.image)
    + meta('name', 'twitter:card', 'summary')
    + meta('name', 'description', preview.description);
}

/** index.html with its <title> replaced by the preview's tags (before </head> when it has none). */
export function withPreview(html, preview) {
  const tags = previewTags(preview);
  // Replacer functions: a "$&" in a survey title must stay text, not a replacement pattern.
  if (/<title>[^<]*<\/title>/.test(html)) return html.replace(/<title>[^<]*<\/title>/, () => tags);
  return html.includes('</head>') ? html.replace('</head>', () => `${tags}\n</head>`) : html;
}
