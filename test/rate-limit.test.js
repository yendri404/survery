import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRateLimiter } from '../src/rate-limit.js';

test('rate limiter blocks after the limit and resets after the window', () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(limiter.isLimited('k'), false);
  limiter.hit('k');
  limiter.hit('k');
  assert.equal(limiter.isLimited('k'), true);
  assert.equal(limiter.isLimited('other'), false);
  assert.equal(limiter.retryAfterSeconds('k'), 1);
  now = 1000;
  assert.equal(limiter.isLimited('k'), false);
});

test('rate limiter reset clears a key and limit 0 disables it', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  limiter.hit('k');
  assert.equal(limiter.isLimited('k'), true);
  limiter.reset('k');
  assert.equal(limiter.isLimited('k'), false);

  const disabled = createRateLimiter({ limit: 0, windowMs: 1000 });
  for (let i = 0; i < 5; i++) disabled.hit('k');
  assert.equal(disabled.isLimited('k'), false);
});
