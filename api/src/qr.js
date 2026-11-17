import QRCode from 'qrcode';

// Medium error correction survives small print damage while keeping the code simple to scan.
const OPTIONS = { errorCorrectionLevel: 'M', margin: 2 };

/**
 * SVG of a QR code for `text`. The library output only contains numeric path data
 * (no user text), so it is safe to embed as-is; an accessible name (`label`, plain text without quotes) is added for screen readers.
 */
export async function qrSvg(text, label) {
  const svg = await QRCode.toString(text, { ...OPTIONS, type: 'svg' });
  return svg.trim().replace('<svg ', `<svg role="img" aria-label="${label}" `);
}

/** PNG image of a QR code for `text`, large enough to print. */
export function qrPng(text) {
  return QRCode.toBuffer(text, { ...OPTIONS, type: 'png', width: 600 });
}
