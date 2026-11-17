/**
 * Notices a new client on the server. Every answer of the web server carries `X-Sharevy-Version`, a
 * fingerprint of the client files. The first one seen is the client this tab runs; a different one
 * later means the server was updated while the tab stayed open, so its modules and texts are old.
 */
export function createVersionWatch({ onChange }) {
  let current = null;
  let stale = false;
  return {
    see(version) {
      if (!version) return; // answers without the header (another server) say nothing
      if (current === null) current = version;
      else if (version !== current && !stale) {
        stale = true;
        onChange?.();
      }
    },
    get stale() {
      return stale;
    },
  };
}
