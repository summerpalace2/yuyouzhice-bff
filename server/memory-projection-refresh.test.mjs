import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRefreshMemoryProjection, readPreferencesWithCurrentProjection } from './memory-projection-refresh.mjs';

test('only stale generated images qualify, manual edits and current images stay intact', () => {
  assert.equal(shouldRefreshMemoryProjection({ promptLastSynthesizedAt: 20, promptLastEditedAt: 10 }), true);
  for (const metadata of [{}, { promptLastSynthesizedAt: 20, promptLastEditedAt: 21 },
    { memoryProjectionVersion: 1, promptLastSynthesizedAt: 20 }]) {
    assert.equal(shouldRefreshMemoryProjection(metadata), false);
  }
});

test('refresh rereads the revision and preserves auth and cancellation', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const result = await readPreferencesWithCurrentProjection(async (url, options) => {
    calls.push(url);
    assert.equal(options.token, 'fixture-token');
    assert.equal(options.signal, signal);
    return calls.length === 1 ? { revision: 2, legacyMetadata: { promptLastSynthesizedAt: 20 } }
      : { revision: 3, legacyMetadata: { memoryProjectionVersion: 1 } };
  }, 'fixture-token', signal);
  assert.deepEqual(calls, ['/ai/preferences', '/ai/memories/prepend-prompt', '/ai/preferences']);
  assert.equal(result.revision, 3);
});

test('failed synthesis propagates instead of claiming the image was refreshed', async () => {
  await assert.rejects(readPreferencesWithCurrentProjection(async (url) => {
    if (url.includes('prepend-prompt')) throw new Error('synthesis unavailable');
    return { legacyMetadata: { promptLastSynthesizedAt: 20 } };
  }), /synthesis unavailable/);
});
