/**
 * Survey templates on the client. The API makes them (GET /surveys/:id/template, signed) and checks
 * them (POST /templates/check): only files this Sharevy exported, unchanged, are accepted. Here the
 * picked file is only read, so obviously wrong files never reach the API. Reading uses JSON.parse
 * (data only, nothing is run) and the editor shows the content as text.
 */
/** Larger files are refused before reading them (a template is a few KB; the API takes 1 MB at most). */
export const TEMPLATE_MAX_BYTES = 1_000_000;

/** The picked file as a JSON object, or undefined when it is missing, too large, not JSON or not an object. */
export async function readTemplateFile(file) {
  if (!file || file.size > TEMPLATE_MAX_BYTES) return undefined;
  try {
    const data = JSON.parse(await file.text());
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : undefined;
  } catch {
    return undefined;
  }
}
