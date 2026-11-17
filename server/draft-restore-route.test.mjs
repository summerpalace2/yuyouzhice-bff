import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');
const start = source.indexOf("  if (req.method === 'POST' && /^\\/api\\/trips\\/[^/]+\\/draft\\/restore$/.test(url.pathname))");
const end = source.indexOf("  if (req.method === 'POST' && /^\\/api\\/trips\\/[^/]+\\/open$/.test(url.pathname))", start);
assert.ok(start >= 0 && end > start);

function harness({ userId = 'owner', formalTripId = 'trip-a', fail = false, persistFail = false } = {}) {
  const calls = [], session = { id: 'web-session', userId, formalTripId,
    javaSessionId: 'java-session', sessionAccessToken: 'capability', trip: { version: 1 } };
  const ctx = vm.createContext({ decodeURIComponent, String, Number, Date,
    req: {}, requestSignal: undefined,
    authUser: async () => ({ id: 'owner' }), body: async req => req.input,
    restorePlannerSession: async () => session, javaTokenFor: () => 'owner-token',
    javaCore: { async restorePlannerDraft(id, input) {
      calls.push({ id, input });
      if (fail) throw Object.assign(new Error('formal changed'), { status: 409 });
      return { trip: { ...input.trip, version: 2 }, syncRevision: 2 };
    } },
    persistentStore: { async savePlannerDraft() { if (persistFail) throw new Error('disk unavailable'); calls.push('persisted'); } },
    writeBffDiagnostic: async () => {}, diagnosticError: error => ({ message: error.message }),
    clone: structuredClone, json: (_res, status, data) => ({ status, data }),
    javaErrorResponse: (_res, error) => ({ status: error.status || 500 }) });
  vm.runInContext(`globalThis.run=async(input)=>{const req={method:'POST',input},url={pathname:'/api/trips/trip-a/draft/restore'},res={};${source.slice(start,end)}}`,ctx);
  return { run: ctx.run, calls, session };
}

test('restores into the owned formal planner session and persists returned snapshot', async () => {
  const h = harness(), input = { sessionId: 'web-session', expectedVersion: 1,
    trip: { sourceTripVersion: 1, days: [{ day: 1, stops: [] }] } };
  const result = await h.run(input);
  assert.equal(result.status, 200);
  assert.equal(h.calls[0].id, 'java-session');
  assert.equal(h.calls[0].input.sessionAccessToken, 'capability');
  assert.equal(h.calls[0].input.expectedVersion, 1);
  assert.equal(result.data.trip.version, 2);
  assert.equal(h.session.trip.version, 2);
  assert.equal(h.calls[1], 'persisted');
});

test('denies another user or formal trip before Java mutation', async () => {
  for (const props of [{ userId: 'other' }, { formalTripId: 'trip-other' }]) {
    const h = harness(props);
    assert.equal((await h.run({ sessionId: 'web-session' })).status, 404);
    assert.equal(h.calls.length, 0);
  }
});

test('formal revision conflict leaves the planner draft unchanged', async () => {
  const h = harness({ fail: true });
  assert.equal((await h.run({ sessionId: 'web-session', expectedVersion: 1, trip: {} })).status, 409);
  assert.equal(h.session.trip.version, 1);
  assert.equal(h.calls.length, 1);
});

test('Java committed revision still returns success when BFF draft cache write fails', async () => {
  const h = harness({ persistFail: true });
  const result = await h.run({ sessionId: 'web-session', expectedVersion: 1,
    trip: { sourceTripVersion: 1, days: [{ day: 1, stops: [] }] } });
  assert.equal(result.status, 200);
  assert.equal(h.session.trip.version, 2);
});
