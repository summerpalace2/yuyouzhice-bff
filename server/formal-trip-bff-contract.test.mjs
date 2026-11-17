import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const indexSource = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');

function extract(startMarker, endMarker, source = indexSource) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `route markers not found: ${startMarker}`);
  return source.slice(start, end);
}

const saveRoute = extract(
  "  if (req.method === 'POST' && url.pathname === '/api/trips/save')",
  "  if (req.method === 'POST' && /^\\/api\\/trips\\/[^/]+\\/draft\\/restore$/.test(url.pathname))"
);
const restoreRoute = extract(
  "  if (req.method === 'POST' && /^\\/api\\/trips\\/[^/]+\\/draft\\/restore$/.test(url.pathname))",
  "  if (req.method === 'POST' && /^\\/api\\/trips\\/[^/]+\\/open$/.test(url.pathname))"
);
const openRoute = extract(
  "  if (req.method === 'POST' && /^\\/api\\/trips\\/[^/]+\\/open$/.test(url.pathname))",
  "  if (['GET', 'PUT'].includes(req.method) && /^\\/api\\/trips\\/[^/]+\\/workspace$/.test(url.pathname))"
);
const plannerSessionGetRoute = extract(
  "  if (req.method === 'GET' && url.pathname.startsWith('/api/planner/sessions/'))",
  "  if (req.method === 'POST' && url.pathname.startsWith('/api/planner/sessions/') && url.pathname.endsWith('/dynamic-refresh'))"
);

const projectionStart = indexSource.indexOf('function savedTripProjection(');
const projectionEnd = indexSource.indexOf('\nfunction formalTripHistoryProjection(', projectionStart);
assert.ok(projectionStart >= 0 && projectionEnd > projectionStart);
const savedProjectionSource = indexSource.slice(projectionStart, projectionEnd);
const openSessionStart = indexSource.indexOf('function openFormalTripSession(');
const openSessionEnd = indexSource.indexOf('\nfunction plannerCapability(', openSessionStart);
assert.ok(openSessionStart >= 0 && openSessionEnd > openSessionStart);
const openSessionSource = indexSource.slice(openSessionStart, openSessionEnd);

const errorStart = indexSource.indexOf('const SAFE_JAVA_ERROR_MESSAGES = Object.freeze({');
const errorEnd = indexSource.indexOf('\nfunction plannerAdjustmentErrorResponse(', errorStart);
assert.ok(errorStart >= 0 && errorEnd > errorStart);
const javaErrorSource = indexSource.slice(errorStart, errorEnd);

class HarnessJavaCoreError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const user = { id: 'owner-1' };
const sessionFixture = () => ({
  id: 'web-session-1', userId: 'owner-1', deviceId: 'device-1', formalTripId: 'formal-1',
  javaSessionId: 'java-session-1', sessionAccessToken: 'server-capability',
  syncRevision: 4, trip: { version: 4, title: 'Draft title', formalTripId: 'formal-1' }
});

function harness({ route, pathname, method = 'POST', input = {}, authenticated = true,
  session = sessionFixture(), java = {}, persistFailure = false, workspaceFailure = false,
  liveSessions: suppliedLiveSessions, draftMap: suppliedDraftMap, workspaceMap: suppliedWorkspaceMap,
  openSaveGate = null, openResponse = null, headers = {} } = {}) {
  const calls = [];
  const persistedDrafts = [];
  const draftMap = suppliedDraftMap || new Map();
  const workspaceMap = suppliedWorkspaceMap || new Map();
  const persistenceOrder = [];
  const diagnostics = [];
  const registrationChecks = [];
  const workspaces = [];
  let candidateOpenSessionId = null;
  const liveSessions = suppliedLiveSessions || new Map();
  const defaultJava = {
    async savePlannerSession(...args) {
      calls.push(['savePlannerSession', ...args]);
      return { trip: { id: 'formal-1', title: 'Saved', currentVersion: 5, updatedAt: 1700000000000,
        plan: { title: 'Draft title', version: 5, formalTripId: 'formal-1' } } };
    },
    async tripVersions(...args) { calls.push(['tripVersions', ...args]); return [{ versionNumber: 5, changeReason: 'saved' }]; },
    async restorePlannerDraft(...args) {
      calls.push(['restorePlannerDraft', ...args]);
      return { trip: { title: 'Restored', version: 5, sourceTripId: 'formal-1' }, syncRevision: 7 };
    },
    async openPlannerTrip(...args) {
      calls.push(['openPlannerTrip', ...args]);
      const tripId = args[0];
      // Mirrors PlannerOpenApplicationService for USER-owned sessions:
      // owner identity authorizes the session, so there is no raw token field.
      return openResponse || {
        ok: true, sessionId: 'java-session-new', syncRevision: 2,
        formalTripId: tripId, formalTripVersion: 8,
        trip: { title: 'Opened', version: 1, formalTripId: tripId, sourceTripId: tripId, sourceTripVersion: 8 }
      };
    },
    async acknowledgeOpenedPlannerSession(...args) {
      calls.push(['acknowledgeOpenedPlannerSession', ...args]);
      return { ok: true, acknowledged: true };
    },
    async discardOpenedPlannerSession(...args) {
      calls.push(['discardOpenedPlannerSession', ...args]);
      return { ok: true, discarded: true, alreadyAbsent: false };
    },
    async getPlannerSession(...args) {
      calls.push(['getPlannerSession', ...args]);
      return { sessionId: args[0], trip: { title: 'Opened', version: 1 }, syncRevision: 2 };
    },
    async getTrip(token, tripId) {
      const args = [token, tripId];
      calls.push(['getTrip', ...args]);
      return { id: tripId, title: 'Formal', currentVersion: 8, updatedAt: 1700000000000,
        plan: { title: 'Formal', version: 8, days: [] } };
    }
  };
  const javaCore = { ...defaultJava, ...java };
  async function saveWorkspace(value) {
    persistenceOrder.push('workspace-save');
    const key = `${value.userId}:${value.formalTripId}`;
    const previous = workspaceMap.get(key);
    const snapshot = structuredClone(value.workspace);
    workspaceMap.set(key, snapshot);
    if (workspaceFailure) {
      if (previous === undefined) workspaceMap.delete(key); else workspaceMap.set(key, previous);
      throw new Error('test workspace persistence failure');
    }
    workspaces.push(snapshot);
    return structuredClone(snapshot);
  }
  const context = vm.createContext({
    req: { method, input, deviceId: 'device-1', headers: { ...headers } },
    url: { pathname },
    res: {},
    requestSignal: { marker: 'request-signal' },
    authUser: async () => authenticated ? user : null,
    body: async req => req.input,
    restorePlannerSession: async (id) => {
      calls.push(['restorePlannerSession', id]);
      if (session && session.userId === user.id && session.id === id) return session;
      const live = liveSessions.get(id);
      if (live && live.userId === user.id && live.deviceId === 'device-1') return live;
      const draft = draftMap.get(id);
      if (!draft || draft.userId !== user.id || draft.deviceId !== 'device-1') return null;
      if (!draft.javaSessionId) return null;
      const restored = await javaCore.getPlannerSession(draft.javaSessionId, {
        token: 'java-owner-token', sessionAccessToken: ''
      });
      if (!restored?.trip) return null;
      const restoredSession = { ...draft, trip: structuredClone(restored.trip) };
      liveSessions.set(id, restoredSession);
      return restoredSession;
    },
    javaTokenFor: () => 'java-owner-token',
    javaCore,
    persistentStore: {
      async savePlannerDraft(value) {
        persistenceOrder.push('draft-save');
        const previous = draftMap.get(value.id);
        draftMap.set(value.id, structuredClone(value));
        if (persistFailure) {
          if (previous === undefined) draftMap.delete(value.id); else draftMap.set(value.id, previous);
          throw new Error('test persistence failure');
        }
        persistedDrafts.push(structuredClone(value));
      },
      async deletePlannerDraft(sessionId) {
        persistenceOrder.push('draft-delete');
        draftMap.delete(String(sessionId || ''));
      },
      async savePlannerOpenState(value) {
        persistenceOrder.push('open-state-save');
        candidateOpenSessionId = value.id;
        registrationChecks.push(['open-state', liveSessions.has(value.id)]);
        if (openSaveGate) {
          openSaveGate.started.resolve();
          await openSaveGate.release.promise;
        }
        if (persistFailure || workspaceFailure) throw new Error('test atomic Open persistence failure');
        const workspaceKey = `${value.userId}:${value.formalTripId}`;
        const current = workspaceMap.get(workspaceKey) || null;
        if (current) {
          value.plannerConversationContext = current.plannerConversationContext || null;
          value.chatEpoch = current.chatEpoch || value.chatEpoch || null;
        }
        const draft = structuredClone(value);
        const workspace = {
          ownerUserId: value.userId,
          formalTripId: value.formalTripId,
          workspaceRevision: Number(current?.workspaceRevision || 0) + 1,
          chatMessages: structuredClone(current?.chatMessages || []),
          chatMode: current?.chatMode || 'chat',
          chatEpoch: value.chatEpoch || null,
          plannerConversationContext: value.plannerConversationContext || null,
          itineraryMemorySnapshot: value.itineraryMemorySnapshot || null,
          updatedAt: 'test-time'
        };
        draftMap.set(draft.id, draft);
        workspaceMap.set(workspaceKey, workspace);
        persistedDrafts.push(draft);
        workspaces.push(workspace);
        return { draft, workspace };
      },
      async deletePlannerDraft(id) { persistenceOrder.push('draft-delete'); draftMap.delete(id); },
      getTripWorkspace(userId, formalTripId) {
        return workspaceMap.get(`${userId}:${formalTripId}`) || null;
      },
      async saveTripWorkspace(value) { return saveWorkspace(value); },
      async deleteTripWorkspace(userId, formalTripId) {
        persistenceOrder.push('workspace-delete');
        workspaceMap.delete(`${userId}:${formalTripId}`);
      },
    },
    requestDeviceId: () => 'device-1',
    sessions: liveSessions,
    clone: value => structuredClone(value),
    json: (_res, status, data) => ({ status, data }),
    JavaCoreError: HarnessJavaCoreError,
    performance,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Promise,
    Map,
    structuredClone,
    randomUUID: () => 'chat-epoch-1',
    createHash,
    hydrateFormalTripWorkspace: () => null,
    itineraryMemorySnapshot: () => ({ source: 'test' }),
    persistFormalTripWorkspace: async (value) => saveWorkspace({
      userId: value.userId,
      formalTripId: value.formalTripId,
      workspace: {
        chatMessages: value.chatMessages || [],
        chatMode: value.chatMode || 'chat',
        plannerConversationContext: value.plannerConversationContext || null,
        itineraryMemorySnapshot: value.itineraryMemorySnapshot || { source: 'test' },
        chatEpoch: value.chatEpoch || null
      }
    }),
    plannerCapability: value => ({ legacyMode: !value.javaSessionId, adjustmentCapability: value.javaSessionId ? 'V1_PROPOSAL' : 'LEGACY' }),
    savedTripProjection: null,
    shadowMetrics: { record: value => value },
    compareShadow: value => ({ operation: value.operation, compared: true }),
    writeBffDiagnostic: async (...args) => { diagnostics.push(args); },
    diagnosticError: error => ({ message: error.message })
  });
  vm.runInContext(savedProjectionSource, context);
  vm.runInContext(openSessionSource, context);
  const hydrateStart = indexSource.indexOf('function hydrateFormalTripWorkspace(');
  const hydrateEnd = indexSource.indexOf('\nfunction formalTripWorkspaceWrite(', hydrateStart);
  assert.ok(hydrateStart >= 0 && hydrateEnd > hydrateStart);
  vm.runInContext(indexSource.slice(hydrateStart, hydrateEnd), context);
  const workspaceWriteStart = indexSource.indexOf('function formalTripWorkspaceWrite(');
  const workspaceWriteEnd = indexSource.indexOf('\nasync function persistFormalTripWorkspace(', workspaceWriteStart);
  assert.ok(workspaceWriteStart >= 0 && workspaceWriteEnd > workspaceWriteStart);
  vm.runInContext(indexSource.slice(workspaceWriteStart, workspaceWriteEnd), context);
  vm.runInContext(javaErrorSource, context);
  vm.runInContext(`globalThis.handle = async function() { ${route} };`, context);
  return { handle: context.handle, calls, persistedDrafts, draftMap, workspaceMap, workspaces, persistenceOrder, diagnostics, liveSessions, registrationChecks, session, javaCore, get candidateOpenSessionId() { return candidateOpenSessionId; } };
}

test('formal save uses the authenticated Java planner session and returns saved projection', async () => {
  const h = harness({ route: saveRoute, pathname: '/api/trips/save', input: {
    plannerSessionId: 'web-session-1', trip: { title: 'spoof', formalTripId: 'spoof-id', version: 99 }
  } });
  const result = await h.handle();

  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.data.ok, true);
  assert.equal(result.data.saved.id, 'formal-1');
  assert.equal(result.data.saved.trip.formalTripId, 'formal-1');
  assert.equal(result.data.saved.trip.version, 5);
  assert.equal(result.data.isUpdate, true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.filter(([name]) => name === 'savePlannerSession'))), [[
    'savePlannerSession', 'java-session-1', { sessionAccessToken: 'server-capability' }, 'java-owner-token'
  ]]);
  assert.equal(h.calls.some(([name]) => name === 'tripVersions'), true);
  assert.equal(h.persistedDrafts.length, 1);
  assert.equal(h.session.trip.title, 'Draft title');
  assert.equal(h.session.trip.formalTripId, 'formal-1');
});

test('save rejects unauthenticated and missing planner sessions before Java writes', async () => {
  const unauthenticated = harness({ route: saveRoute, pathname: '/api/trips/save', authenticated: false,
    input: { plannerSessionId: 'web-session-1', trip: {} } });
  assert.equal((await unauthenticated.handle()).status, 401);
  assert.equal(unauthenticated.calls.some(([name]) => name === 'savePlannerSession'), false);

  const missing = harness({ route: saveRoute, pathname: '/api/trips/save', session: null,
    input: { plannerSessionId: 'missing', trip: {} } });
  const result = await missing.handle();
  assert.equal(result.status, 404);
  assert.equal(result.data.code, 'PLANNER_SESSION_NOT_FOUND');
  assert.equal(result.data.recoverable, true);
  assert.equal(missing.calls.some(([name]) => name === 'savePlannerSession'), false);
});

test('save maps a Java stale-version response without changing the BFF draft', async () => {
  const h = harness({ route: saveRoute, pathname: '/api/trips/save',
    input: { plannerSessionId: 'web-session-1', trip: { title: 'browser copy' } },
    java: { async savePlannerSession() { throw new HarnessJavaCoreError(409, 'CONFLICT', 'stale'); } }
  });
  const result = await h.handle();
  assert.equal(result.status, 409);
  assert.equal(result.data.ok, false);
  assert.equal(result.data.code, 'CONFLICT');
  assert.equal(result.data.message, '数据版本已变化，请刷新后重试。');
  assert.equal(h.session.trip.title, 'Draft title');
  assert.equal(h.persistedDrafts.length, 0);
});

test('formal restore bridges server-owned session capability and updates cache only after Java success', async () => {
  const h = harness({ route: restoreRoute, pathname: '/api/trips/formal-1/draft/restore', input: {
    sessionId: 'web-session-1', expectedVersion: 4,
    trip: { title: 'edited backup', sourceTripVersion: 8, days: [{ day: 1, stops: [] }] }
  } });
  const result = await h.handle();

  assert.equal(result.status, 200);
  assert.equal(result.data.sessionId, 'web-session-1');
  assert.equal(result.data.trip.title, 'Restored');
  assert.equal(result.data.trip.version, 5);
  const call = h.calls.find(([name]) => name === 'restorePlannerDraft');
  assert.deepEqual(JSON.parse(JSON.stringify(call)), ['restorePlannerDraft', 'java-session-1', {
    trip: { title: 'edited backup', sourceTripVersion: 8, days: [{ day: 1, stops: [] }] },
    expectedVersion: 4, sessionAccessToken: 'server-capability'
  }, 'java-owner-token', { marker: 'request-signal' }]);
  assert.equal(h.session.trip.title, 'Restored');
  assert.equal(h.session.syncRevision, 7);
  assert.equal(h.persistedDrafts.length, 1);
  assert.equal(h.persistedDrafts[0].syncRevision, 7);
});

test('restore rejects missing Java syncRevision without overwriting the BFF draft', async () => {
  const h = harness({ route: restoreRoute, pathname: '/api/trips/formal-1/draft/restore',
    input: { sessionId: 'web-session-1', expectedVersion: 4, trip: { sourceTripVersion: 8, days: [] } },
    java: { async restorePlannerDraft() { return { trip: { title: 'Restored', version: 5 } }; } }
  });
  const result = await h.handle();
  assert.equal(result.status, 502);
  assert.equal(result.data.code, 'PLANNER_RESTORE_CONTRACT_INVALID');
  assert.equal(h.session.trip.title, 'Draft title');
  assert.equal(h.session.syncRevision, 4);
  assert.equal(h.persistedDrafts.length, 0);
});

test('restore rejects wrong owner or formal trip and preserves state on stale Java conflict', async () => {
  const unauthenticated = harness({ route: restoreRoute, pathname: '/api/trips/formal-1/draft/restore',
    authenticated: false, input: { sessionId: 'web-session-1', trip: {} }
  });
  assert.equal((await unauthenticated.handle()).status, 401);
  assert.equal(unauthenticated.calls.some(([name]) => name === 'restorePlannerDraft'), false);

  for (const overrides of [
    { session: null },
    { session: { ...sessionFixture(), userId: 'other-owner' } },
    { session: { ...sessionFixture(), formalTripId: 'other-trip' } },
    { session: { ...sessionFixture(), javaSessionId: '' } }
  ]) {
    const h = harness({ ...overrides, route: restoreRoute, pathname: '/api/trips/formal-1/draft/restore',
      input: { sessionId: 'web-session-1', expectedVersion: 4, trip: {} } });
    assert.equal((await h.handle()).status, 404);
    assert.equal(h.calls.some(([name]) => name === 'restorePlannerDraft'), false);
  }

  const stale = harness({ route: restoreRoute, pathname: '/api/trips/formal-1/draft/restore',
    input: { sessionId: 'web-session-1', expectedVersion: 4, trip: {} },
    java: { async restorePlannerDraft() { throw new HarnessJavaCoreError(409, 'CONFLICT', 'stale'); } }
  });
  const result = await stale.handle();
  assert.equal(result.status, 409);
  assert.equal(result.data.ok, false);
  assert.equal(result.data.code, 'CONFLICT');
  assert.equal(result.data.message, '数据版本已变化，请刷新后重试。');
  assert.equal(stale.session.trip.version, 4);
  assert.equal(stale.persistedDrafts.length, 0);
});

test('formal open creates and persists a new owner-scoped planner session', async () => {
  const h = harness({ route: openRoute, pathname: '/api/trips/formal%2F1/open',
    headers: { 'x-planner-open-idempotency-key': 'open-attempt-1' } });
  const result = await h.handle();

  assert.equal(result.status, 200);
  assert.equal(result.data.javaSessionId, 'java-session-new');
  assert.equal(result.data.sessionAccessToken, '');
  assert.equal(result.data.savedTripId, 'formal/1');
  assert.equal(result.data.formalTripVersion, 8);
  assert.equal(result.data.trip.sourceTripVersion, 8);
  assert.equal(result.data.trip.savedTripId, 'formal/1');
  assert.equal(result.data.legacyMode, false);
  assert.equal(result.data.adjustmentCapability, 'V1_PROPOSAL');
  assert.equal(h.calls[0][0], 'openPlannerTrip');
  assert.deepEqual(h.calls[0].slice(1), ['formal/1', 'java-owner-token', { marker: 'request-signal' }, 'open-attempt-1']);
  assert.deepEqual(h.calls.find(([name]) => name === 'acknowledgeOpenedPlannerSession').slice(1),
    ['formal/1', 'java-session-new', 'java-owner-token']);
  assert.equal(h.calls.some(([name]) => name === 'getTrip'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.workspace)), {
    ownerUserId: 'owner-1', formalTripId: 'formal/1', workspaceRevision: 1,
    chatMessages: [], chatMode: 'chat', plannerConversationContext: null,
    itineraryMemorySnapshot: { source: 'test' }, chatEpoch: 'chat-epoch-1', updatedAt: 'test-time'
  });
  assert.equal(h.persistedDrafts.length, 1);
  const opened = [...h.liveSessions.values()][0];
  assert.equal(opened.userId, 'owner-1');
  assert.equal(opened.deviceId, 'device-1');
  assert.equal(opened.formalTripId, 'formal/1');
  assert.equal(opened.javaSessionId, 'java-session-new');
  assert.equal(opened.sessionAccessToken, '');
  assert.equal(opened.syncRevision, 2);
  assert.equal(h.persistedDrafts[0].syncRevision, 2);
  assert.deepEqual(h.registrationChecks, [['open-state', false]]);
  assert.deepEqual(h.persistenceOrder, ['open-state-save']);
});

test('same Open operation key retries a lost Java response and reuses one BFF session identity', async () => {
  const key = 'open-retry-1';
  const javaSessions = new Map();
  const h = harness({ route: openRoute, pathname: '/api/trips/formal-1/open',
    headers: { 'x-planner-open-idempotency-key': key },
    java: {
      async openPlannerTrip(tripId, token, signal, operationKey) {
        h?.calls?.push(['openPlannerTrip', tripId, token, signal, operationKey]);
        let value = javaSessions.get(operationKey);
        if (!value) {
          value = { ok: true, sessionId: 'java-session-stable', syncRevision: 2,
            formalTripId: tripId, formalTripVersion: 8,
            trip: { title: 'Opened', version: 1, formalTripId: tripId,
              sourceTripId: tripId, sourceTripVersion: 8 } };
          javaSessions.set(operationKey, value);
          throw new HarnessJavaCoreError(502, 'JAVA_UNAVAILABLE', 'simulated response lost after Java commit');
        }
        return value;
      }
    }
  });
  // The first request is lost after Java has created the idempotent session.
  const first = await h.handle();
  assert.equal(first.status, 502);
  const firstSessionId = h.candidateOpenSessionId;
  const second = await h.handle();
  assert.equal(second.status, 200);
  assert.equal(second.data.javaSessionId, 'java-session-stable');
  assert.equal(second.data.sessionId, firstSessionId || second.data.sessionId);
  assert.equal(javaSessions.size, 1);
  assert.equal([...h.liveSessions.values()].length, 1);
});

test('failed Java Open acknowledgement returns retryable response and never registers the local session', async () => {
  let failAck = true;
  const h = harness({ route: openRoute, pathname: '/api/trips/formal-1/open',
    headers: { 'x-planner-open-idempotency-key': 'open-ack-retry' },
    java: { async acknowledgeOpenedPlannerSession(...args) {
      h?.calls?.push(['acknowledgeOpenedPlannerSession', ...args]);
      if (failAck) throw new HarnessJavaCoreError(503, 'TEMPORARY', 'temporary');
      return { ok: true, acknowledged: true };
    } }
  });
  const first = await h.handle();
  assert.equal(first.status, 503);
  const firstBffSessionId = h.candidateOpenSessionId;
  assert.equal(first.data.code, 'PLANNER_OPEN_ACK_PENDING');
  assert.equal(first.data.retrySameOperation, true);
  assert.equal(h.liveSessions.size, 0);
  assert.equal(h.draftMap.size, 0);
  failAck = false;
  const second = await h.handle();
  assert.equal(second.status, 200);
  assert.equal(second.data.sessionId, firstBffSessionId);
  assert.equal(second.data.javaSessionId, 'java-session-new');
  const openCalls = h.calls.filter(([name]) => name === 'openPlannerTrip');
  assert.equal(openCalls.length, 2);
  assert.equal(openCalls[0][4], 'open-ack-retry');
  assert.equal(openCalls[1][4], openCalls[0][4]);
});

test('open fails closed when Java omits sessionId before reading Trip or creating BFF state', async () => {
  const h = harness({ route: openRoute, pathname: '/api/trips/formal-1/open',
    openResponse: { sessionAccessToken: 'orphan-capability', formalTripVersion: 8, trip: { title: 'Opened' } }
  });
  const result = await h.handle();
  assert.equal(result.status, 502);
  assert.equal(result.data.code, 'PLANNER_OPEN_CONTRACT_INVALID');
  assert.equal(result.data.ok, false);
  assert.equal(h.calls.some(([name]) => name === 'openPlannerTrip'), true);
  assert.equal(h.calls.some(([name]) => name === 'getTrip'), false);
  assert.equal(h.liveSessions.size, 0);
  assert.equal(h.persistedDrafts.length, 0);
  assert.equal(h.draftMap.size, 0);
  assert.equal(h.workspaces.length, 0);
});

test('open rejects missing or inconsistent Java snapshot fields before creating BFF state', async () => {
  const valid = {
    ok: true, sessionId: 'java-session-new', syncRevision: 2,
    formalTripId: 'formal-1', formalTripVersion: 8,
    trip: { title: 'Opened', version: 1, formalTripId: 'formal-1', sourceTripId: 'formal-1', sourceTripVersion: 8 }
  };
  const invalidResponses = [
    ...[{ id: 'fake' }, ['java-session'], 123, '', '   '].map(sessionId => ({ ...valid, sessionId })),
    { ...valid, formalTripId: undefined },
    { ...valid, formalTripVersion: undefined },
    { ...valid, formalTripVersion: '8' },
    { ...valid, syncRevision: undefined },
    { ...valid, syncRevision: '2' },
    { ...valid, sessionAccessToken: 123 },
    { ...valid, sessionAccessToken: null },
    { ...valid, sessionAccessToken: {} },
    { ...valid, trip: undefined },
    { ...valid, trip: { ...valid.trip, version: '1' } },
    { ...valid, trip: { ...valid.trip, formalTripId: 'another-trip' } },
    { ...valid, trip: { ...valid.trip, sourceTripId: 'another-trip' } },
    { ...valid, trip: { ...valid.trip, sourceTripVersion: 7 } }
  ];
  for (const openResponse of invalidResponses) {
    const h = harness({ route: openRoute, pathname: '/api/trips/formal-1/open',
      openResponse
    });
    const result = await h.handle();
    assert.equal(result.status, 502, `response=${JSON.stringify(openResponse)}`);
    assert.equal(result.data.code, 'PLANNER_OPEN_CONTRACT_INVALID');
    assert.equal(h.calls.some(([name]) => name === 'getTrip'), false);
    assert.equal(h.liveSessions.size, 0);
    assert.equal(h.persistedDrafts.length, 0);
    assert.equal(h.draftMap.size, 0);
    assert.equal(h.workspaces.length, 0);
    const hasOwnedCandidate = typeof openResponse.sessionId === 'string'
      && openResponse.sessionId.trim() && openResponse.formalTripId === 'formal-1';
    assert.equal(h.calls.some(([name]) => name === 'discardOpenedPlannerSession'), Boolean(hasOwnedCandidate));
  }
});

test('open accepts an empty USER capability while retaining owner-scoped session state', async () => {
  const h = harness({ route: openRoute, pathname: '/api/trips/formal-1/open', openResponse: {
    ok: true, sessionId: 'java-session-new', sessionAccessToken: '', syncRevision: 2,
    formalTripId: 'formal-1', formalTripVersion: 8,
    trip: { title: 'Opened', version: 1, formalTripId: 'formal-1', sourceTripId: 'formal-1', sourceTripVersion: 8 }
  } });
  const result = await h.handle();
  assert.equal(result.status, 200);
  assert.equal(result.data.sessionAccessToken, '');
  assert.equal([...h.liveSessions.values()][0].sessionAccessToken, '');
});

test('USER Open snapshot without capability supports later Java action with owner authorization', async () => {
  const opened = harness({ route: openRoute, pathname: '/api/trips/formal-1/open' });
  const openResult = await opened.handle();
  assert.equal(openResult.status, 200);
  const webSessionId = [...opened.liveSessions.keys()][0];
  const followupCalls = [];
  const followup = harness({ route: plannerSessionGetRoute, method: 'GET',
    pathname: `/api/planner/sessions/${webSessionId}`, session: null, liveSessions: opened.liveSessions,
    java: { async getPlannerSession(...args) {
      followupCalls.push(args);
      return { sessionId: 'java-session-new', trip: { version: 1 }, syncRevision: 2 };
    } }
  });
  const result = await followup.handle();
  assert.equal(result.status, 200);
  assert.equal(followupCalls.length, 1);
  assert.equal(followupCalls[0][0], 'java-session-new');
  assert.deepEqual(JSON.parse(JSON.stringify(followupCalls[0][1])), { sessionAccessToken: '', token: 'java-owner-token' });
  assert.equal(followupCalls[0][2], 'java-owner-token');
});

test('open leaves no BFF state when the atomic persistence operation fails', async () => {
  for (const options of [{ workspaceFailure: true }, { persistFailure: true }]) {
    const h = harness({ ...options, route: openRoute, pathname: '/api/trips/formal-1/open' });
    await assert.rejects(h.handle());
    assert.equal(h.liveSessions.size, 0, JSON.stringify(options));
    assert.equal(h.draftMap.size, 0, JSON.stringify(options));
    assert.equal(h.workspaceMap.size, 0, JSON.stringify(options));
    assert.equal(h.registrationChecks.every(([, registered]) => registered === false), true);
    assert.equal(h.calls.some(([name]) => name === 'openPlannerTrip'), true);
    assert.equal(h.calls.some(([name, tripId, sessionId, token]) => name === 'discardOpenedPlannerSession'
      && tripId === 'formal-1' && sessionId === 'java-session-new' && token === 'java-owner-token'), true);
    assert.equal(h.calls.some(([name]) => name === 'getTrip'), false);
    assert.equal(h.workspaces.length, 0);
    assert.equal(h.persistedDrafts.length, 0);
    assert.deepEqual(h.persistenceOrder, ['open-state-save', 'draft-delete']);
    assert.equal(h.diagnostics.some(([name]) => name === 'planner-open-local-persist-error'), true);
    assert.equal(h.diagnostics.some(([name]) => name === 'planner-open-java-session-compensated'), true);
  }
});

test('open records a cleanup failure instead of hiding a possible Java orphan', async () => {
  const h = harness({ route: openRoute, pathname: '/api/trips/formal-1/open', workspaceFailure: true,
    java: { async discardOpenedPlannerSession() {
      throw new Error('synthetic Java cleanup outage');
    } }
  });
  await assert.rejects(h.handle());
  assert.equal(h.liveSessions.size, 0);
  assert.equal(h.draftMap.size, 0);
  assert.equal(h.diagnostics.some(([name]) => name === 'planner-open-java-session-compensation-failed'), true);
});

test('Open does not expose a draft to concurrent session GET before atomic rename succeeds', async () => {
  const started = deferred();
  const release = deferred();
  const gate = { started, release };
  const priorDraft = { id: 'unrelated-session', userId: 'owner-1', trip: { title: 'committed draft' } };
  const priorWorkspace = { ownerUserId: 'owner-1', formalTripId: 'formal-1',
    workspaceRevision: 7, chatMessages: [{ role: 'user', content: 'committed workspace' }] };
  const draftMap = new Map([[priorDraft.id, structuredClone(priorDraft)]]);
  const workspaceMap = new Map([['owner-1:formal-1', structuredClone(priorWorkspace)]]);
  const opening = harness({ route: openRoute, pathname: '/api/trips/formal-1/open',
    openSaveGate: gate, workspaceFailure: true, draftMap, workspaceMap });
  const pendingOpen = opening.handle();
  await started.promise;

  const concurrentGet = harness({ route: plannerSessionGetRoute, method: 'GET',
    pathname: `/api/planner/sessions/${opening.candidateOpenSessionId}`, session: null,
    liveSessions: opening.liveSessions, draftMap: opening.draftMap, workspaceMap: opening.workspaceMap });
  const getResult = await concurrentGet.handle();
  assert.equal(getResult.status, 404);
  assert.equal(getResult.data.code, 'PLANNER_SESSION_NOT_FOUND');
  assert.equal(opening.draftMap.has(opening.candidateOpenSessionId), false,
    'uncommitted draft must not be visible to restorePlannerSession');
  assert.equal(opening.liveSessions.size, 0, 'concurrent GET must not register a candidate session');

  release.resolve();
  await assert.rejects(pendingOpen);
  assert.deepEqual(opening.draftMap.get(priorDraft.id), priorDraft);
  assert.equal(opening.draftMap.has(opening.candidateOpenSessionId), false);
  assert.deepEqual(opening.workspaceMap.get('owner-1:formal-1'), priorWorkspace);
  assert.equal(opening.liveSessions.size, 0);
});

test('Open rebases on a workspace update committed while it waits in the persistence queue', async () => {
  const started = deferred();
  const release = deferred();
  const opening = harness({ route: openRoute, pathname: '/api/trips/formal-1/open',
    openSaveGate: { started, release } });
  const pendingOpen = opening.handle();
  await started.promise;

  const concurrentPut = {
    ownerUserId: 'owner-1', formalTripId: 'formal-1', workspaceRevision: 9,
    chatMessages: [{ role: 'user', content: 'newer PUT message' }], chatMode: 'planner',
    chatEpoch: 'latest-epoch', plannerConversationContext: { turn: 'latest-context' },
    itineraryMemorySnapshot: { source: 'latest-workspace' }
  };
  opening.workspaceMap.set('owner-1:formal-1', structuredClone(concurrentPut));
  release.resolve();

  const result = await pendingOpen;
  assert.equal(result.status, 200);
  const persistedDraft = opening.draftMap.get(opening.candidateOpenSessionId);
  assert.equal(persistedDraft.chatEpoch, 'latest-epoch');
  assert.deepEqual(persistedDraft.plannerConversationContext, { turn: 'latest-context' });
  const registeredSession = opening.liveSessions.get(opening.candidateOpenSessionId);
  assert.equal(registeredSession.chatEpoch, 'latest-epoch');
  assert.deepEqual(registeredSession.plannerConversationContext, { turn: 'latest-context' });
  const persistedWorkspace = opening.workspaceMap.get('owner-1:formal-1');
  assert.equal(persistedWorkspace.chatEpoch, 'latest-epoch');
  assert.deepEqual(persistedWorkspace.plannerConversationContext, { turn: 'latest-context' });
  assert.equal(persistedWorkspace.chatMode, 'planner');
  assert.equal(persistedWorkspace.chatMessages[0].content, 'newer PUT message');
});

test('restore rejects invalid Java sync revisions without overwriting the BFF draft', async () => {
  for (const syncRevision of [0, -1, 4, 4.5, Number.NaN, '8', true]) {
    const h = harness({ route: restoreRoute, pathname: '/api/trips/formal-1/draft/restore',
      input: { sessionId: 'web-session-1', expectedVersion: 4, trip: { days: [] } },
      java: { async restorePlannerDraft() { return { trip: { title: 'Invalid', version: 5 }, syncRevision }; } }
    });
    const result = await h.handle();
    assert.equal(result.status, 502, `syncRevision=${syncRevision}`);
    assert.equal(result.data.code, 'PLANNER_RESTORE_CONTRACT_INVALID');
    assert.equal(h.session.trip.title, 'Draft title');
    assert.equal(h.session.syncRevision, 4);
    assert.equal(h.persistedDrafts.length, 0);
  }
});

test('restore rejects missing or invalid Java trip versions without overwriting the BFF draft', async () => {
  for (const version of [undefined, 0, -1, 4, 4.5, '5', true]) {
    const h = harness({ route: restoreRoute, pathname: '/api/trips/formal-1/draft/restore',
      input: { sessionId: 'web-session-1', expectedVersion: 4, trip: { days: [] } },
      java: { async restorePlannerDraft() {
        return { trip: { title: 'Invalid version', ...(version === undefined ? {} : { version }) }, syncRevision: 7 };
      } }
    });
    const result = await h.handle();
    assert.equal(result.status, 502, `version=${version}`);
    assert.equal(result.data.code, 'PLANNER_RESTORE_CONTRACT_INVALID');
    assert.equal(h.session.trip.title, 'Draft title');
    assert.equal(h.session.syncRevision, 4);
    assert.equal(h.persistedDrafts.length, 0);
  }
});

test('late restore response cannot overwrite a newer BFF planner snapshot', async () => {
  for (const newerState of [
    { trip: { title: 'Newer', version: 6 }, syncRevision: 8 },
    // Save/apply paths can leave the BFF sync revision behind trip.version.
    { trip: { title: 'Newer via apply', version: 6 }, syncRevision: 3 },
    // Save can refresh formal-trip source metadata without advancing either counter.
    { trip: { ...sessionFixture().trip, sourceTripVersion: 9 }, syncRevision: 4 }
  ]) {
    let resolveRestore;
    const h = harness({ route: restoreRoute, pathname: '/api/trips/formal-1/draft/restore',
      input: { sessionId: 'web-session-1', expectedVersion: 4, trip: { days: [] } },
      java: { restorePlannerDraft() {
        return new Promise(resolve => { resolveRestore = resolve; });
      } }
    });
    const pending = h.handle();
    await new Promise(resolve => setImmediate(resolve));
    h.session.trip = newerState.trip;
    h.session.syncRevision = newerState.syncRevision;
    resolveRestore({ trip: { title: 'Late stale response', version: 5 }, syncRevision: 7 });
    const result = await pending;
    assert.equal(result.status, 409);
    assert.equal(result.data.code, 'PLANNER_REVISION_CONFLICT');
    assert.equal(h.session.trip.title, newerState.trip.title);
    assert.equal(h.session.syncRevision, newerState.syncRevision);
    assert.equal(h.persistedDrafts.length, 0);
  }

  let resolveRestoreWithoutRevision;
  const h = harness({ route: restoreRoute, pathname: '/api/trips/formal-1/draft/restore',
    input: { sessionId: 'web-session-1', expectedVersion: 4, trip: { days: [] } },
    java: { restorePlannerDraft() {
      return new Promise(resolve => { resolveRestoreWithoutRevision = resolve; });
    } }
  });
  const pending = h.handle();
  await new Promise(resolve => setImmediate(resolve));
  h.session.trip = { title: 'Newer without sync movement', version: 6 };
  resolveRestoreWithoutRevision({ trip: { title: 'Late stale response without revision', version: 5 } });
  const result = await pending;
  assert.equal(result.status, 409);
  assert.equal(result.data.code, 'PLANNER_REVISION_CONFLICT');
  assert.equal(h.session.trip.title, 'Newer without sync movement');
  assert.equal(h.persistedDrafts.length, 0);
});

test('open rejects unauthenticated requests and preserves Java missing-trip status', async () => {
  const unauthenticated = harness({ route: openRoute, pathname: '/api/trips/formal-1/open', authenticated: false });
  assert.equal((await unauthenticated.handle()).status, 401);
  assert.equal(unauthenticated.calls.length, 0);

  const missing = harness({ route: openRoute, pathname: '/api/trips/formal-1/open',
    java: { async openPlannerTrip() { throw new HarnessJavaCoreError(404, 'JAVA_REQUEST_REJECTED', 'missing'); } }
  });
  const result = await missing.handle();
  assert.equal(result.status, 404);
  assert.equal(result.data.ok, false);
  assert.equal(result.data.code, 'JAVA_REQUEST_REJECTED');
  assert.equal(result.data.message, '请求未被 Java Core Backend 接受。');
  assert.equal(missing.persistedDrafts.length, 0);
});

test('open does not persist or register a BFF session if Java Open fails', async () => {
  let javaOpenCalled = false;
  const h = harness({ route: openRoute, pathname: '/api/trips/formal-1/open',
    java: { async openPlannerTrip() {
      javaOpenCalled = true;
      throw new HarnessJavaCoreError(404, 'JAVA_REQUEST_REJECTED', 'missing');
    } }
  });
  const result = await h.handle();
  assert.equal(result.status, 404);
  assert.equal(result.data.code, 'JAVA_REQUEST_REJECTED');
  assert.equal(javaOpenCalled, true);
  assert.equal(h.calls.some(([name]) => name === 'getTrip'), false);
  assert.equal(h.liveSessions.size, 0);
  assert.equal(h.persistedDrafts.length, 0);
  assert.equal(h.draftMap.size, 0);
  assert.equal(h.workspaces.length, 0);
});

test('Java client sends the Save/Open/Restore methods to the Java V1 URLs with owner and capability credentials', async () => {
  const previous = {
    coreUrl: process.env.CORE_BACKEND_URL,
    legacyUrl: process.env.YUYOUZHICE_JAVA_CORE_URL,
    stub: process.env.YUYOUZHICE_JAVA_TEST_STUB
  };
  process.env.CORE_BACKEND_URL = 'http://java-contract.test';
  process.env.YUYOUZHICE_JAVA_TEST_STUB = '0';
  const { createJavaCoreClient, javaCoreConfig, JavaCoreError } = await import(`./java-core-client.mjs?cp44=${Date.now()}`);
  assert.equal(javaCoreConfig.testStub, false);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => ({ success: true, data: { ok: true } }) };
  };
  try {
    const client = createJavaCoreClient();
    await client.savePlannerSession('java/session', { sessionAccessToken: 'plan-cap' }, 'owner-token');
    const signal = new AbortController().signal;
    await client.openPlannerTrip('formal/trip', 'owner-token', signal, 'open-key-1');
    await client.acknowledgeOpenedPlannerSession('formal/trip', 'java/session', 'owner-token');
    await client.discardOpenedPlannerSession('formal/trip', 'java/session', 'owner-token');
    await client.getPlannerSession('java/session', { sessionAccessToken: '' }, 'owner-token');
    const restoreTrip = { sourceTripVersion: 8, days: [{ day: 1, stops: [] }] };
    await client.restorePlannerDraft('java/session', { trip: restoreTrip, expectedVersion: 4,
      sessionAccessToken: 'plan-cap' }, 'owner-token', signal);

    assert.equal(calls[0].url, 'http://java-contract.test/ai/planner/v1/sessions/java%2Fsession/save');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.authorization, 'Bearer owner-token');
    assert.equal(calls[0].options.headers['x-plan-session-token'], 'plan-cap');
    assert.equal(calls[0].options.body, undefined);

    assert.equal(calls[1].url, 'http://java-contract.test/ai/planner/v1/trips/formal%2Ftrip/open');
    assert.equal(calls[1].options.method, 'POST');
    assert.equal(calls[1].options.headers.authorization, 'Bearer owner-token');
    assert.equal(calls[1].options.headers['Idempotency-Key'], 'open-key-1');
    assert.equal(calls[1].options.body, undefined);
    assert.equal(calls[1].options.signal.aborted, false);
    assert.equal(calls[2].url, 'http://java-contract.test/ai/planner/v1/trips/formal%2Ftrip/open-sessions/java%2Fsession/ack');
    assert.equal(calls[2].options.method, 'POST');
    assert.equal(calls[2].options.headers.authorization, 'Bearer owner-token');

    assert.equal(calls[3].url, 'http://java-contract.test/ai/planner/v1/trips/formal%2Ftrip/open-sessions/java%2Fsession');
    assert.equal(calls[3].options.method, 'DELETE');
    assert.equal(calls[3].options.headers.authorization, 'Bearer owner-token');

    assert.equal(calls[4].url, 'http://java-contract.test/ai/planner/v1/sessions/java%2Fsession');
    assert.equal(calls[4].options.method, 'GET');
    assert.equal(calls[4].options.headers.authorization, 'Bearer owner-token');
    assert.equal(calls[3].options.headers['x-plan-session-token'], undefined);

    assert.equal(calls[5].url, 'http://java-contract.test/ai/planner/v1/sessions/java%2Fsession/restore-draft');
    assert.equal(calls[5].options.method, 'POST');
    assert.equal(calls[5].options.headers.authorization, 'Bearer owner-token');
    assert.equal(calls[5].options.headers['x-plan-session-token'], 'plan-cap');
    assert.deepEqual(JSON.parse(calls[5].options.body), { trip: restoreTrip, expectedVersion: 4 });

    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: false, status: 409,
        json: async () => ({ success: false, code: 409, message: 'stale revision', data: { latestVersion: 9 } }) };
    };
    await assert.rejects(client.restorePlannerDraft('java-session', {
      trip: restoreTrip, expectedVersion: 4, sessionAccessToken: 'plan-cap'
    }, 'owner-token'), error => error instanceof JavaCoreError
      && error.status === 409 && error.code === 'CONFLICT'
      && error.details.latestVersion === 9);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous.coreUrl === undefined) delete process.env.CORE_BACKEND_URL; else process.env.CORE_BACKEND_URL = previous.coreUrl;
    if (previous.legacyUrl === undefined) delete process.env.YUYOUZHICE_JAVA_CORE_URL; else process.env.YUYOUZHICE_JAVA_CORE_URL = previous.legacyUrl;
    if (previous.stub === undefined) delete process.env.YUYOUZHICE_JAVA_TEST_STUB; else process.env.YUYOUZHICE_JAVA_TEST_STUB = previous.stub;
  }
});
