import { EventEmitter } from 'node:events';

const HEARTBEAT_MS = 25_000; // keeps proxies from closing idle streams

/**
 * In-process publish/subscribe for live updates, delivered to clients with Server-Sent Events.
 * Channels: `survey:<id>` (one survey's results) and `owner:<userId>` (a creator's survey list).
 * Events only say "something changed"; clients re-fetch the JSON they show,
 * so a live update shows exactly what a manual refresh would.
 */
export function createLiveUpdates() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // one listener per open client stream

  return {
    /** Notifies every client showing this survey or its owner's list. */
    surveyChanged(survey) {
      emitter.emit(`survey:${survey.id}`);
      emitter.emit(`owner:${survey.ownerId}`);
    },

    /** Turns the response into an SSE stream for `channel` until the client disconnects. */
    stream(req, res, channel) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // disable buffering in nginx-style proxies
      });
      res.write('retry: 3000\n: connected\n\n');

      const onChange = () => res.write(`event: change\ndata: ${Date.now()}\n\n`);
      const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
      emitter.on(channel, onChange);
      req.on('close', () => {
        clearInterval(heartbeat);
        emitter.off(channel, onChange);
      });
    },
  };
}
