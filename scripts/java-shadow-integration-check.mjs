import {
  PHASE5B_FIXTURE_ADMIN_EMAIL,
  PHASE5B_FIXTURE_ADMIN_PASSWORD,
  spawnPhase5bFixtureServer
} from './phase5b-test-fixture.mjs';

const port = 4337;
const base = `http://127.0.0.1:${port}`;
const server = spawnPhase5bFixtureServer(port);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(`${path}: ${data?.code || response.status} ${data?.message || 'request failed'}`);
  return data;
}

try {
  await wait(220);
  const login = await call('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: PHASE5B_FIXTURE_ADMIN_EMAIL, password: PHASE5B_FIXTURE_ADMIN_PASSWORD })
  });
  if (!login.token) throw new Error('fixture login did not return a compatibility token');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${login.token}` };

  const planned = await call('/api/plan', {
    method: 'POST', headers,
    body: JSON.stringify({ prompt: '周六下午到重庆，周日晚上离开，带父母，希望少走路，喜欢夜景。' })
  });
  if (!planned.trip?.days?.length || planned.shadow?.java?.succeeded !== true) {
    throw new Error('plan did not return a successful Java candidate');
  }
  if (planned.trip.id !== 'draft-cq-shadow' || planned.shadow?.mode !== 'java-only') throw new Error('plan did not return the Java candidate with Java-only observation');

  const replanned = await call('/api/replan', {
    method: 'POST', headers,
    body: JSON.stringify({ sessionId: planned.sessionId, targetStopId: 'day1-hongyadong', reason: '少走路' })
  });
  if (!replanned.replacementVenueId || replanned.shadow?.java?.succeeded !== true) {
    throw new Error('replan did not return the Java candidate replacement');
  }

  const added = await call('/api/trip/stops', {
    method: 'POST', headers,
    body: JSON.stringify({ sessionId: planned.sessionId, operation: 'add', attractionId: 'cq-museum', day: 1 })
  });
  const addedStop = added.trip?.days?.flatMap((day) => day.stops || []).find((stop) => stop.venueId === 'cq-museum');
  if (!addedStop?.id || added.shadow?.java?.succeeded !== true) {
    throw new Error('stop mutation did not return the Java candidate draft');
  }

  const history = await call('/api/history', { headers });
  if ((history.sessions || []).length !== 0) throw new Error('Shadow draft was persisted into Node history');

  const created = await call('/api/trips/save', {
    method: 'POST', headers,
    body: JSON.stringify({ trip: added.trip })
  });
  if (!created.saved?.id || created.saved.trip?.formalTripId !== created.saved.id || created.isUpdate !== false) {
    throw new Error('formal Trip save was not delegated to Java');
  }
  const listed = await call('/api/trips', { headers });
  if (listed.trips?.length !== 1 || listed.trips[0].id !== created.saved.id) {
    throw new Error('formal Java Trip list did not match saved Trip');
  }

  const reopened = await call(`/api/trips/${encodeURIComponent(created.saved.id)}/open`, {
    method: 'POST', headers
  });
  if (!reopened.sessionId || reopened.savedTripId !== created.saved.id || reopened.trip?.formalTripId !== created.saved.id) {
    throw new Error('formal Java Trip did not reopen as a transient Shadow session');
  }
  const reopenedMutation = await call('/api/trip/stops', {
    method: 'POST', headers,
    body: JSON.stringify({
      sessionId: reopened.sessionId,
      operation: 'delete',
      stopId: addedStop.id
    })
  });
  if (reopenedMutation.shadow?.java?.succeeded !== true || reopenedMutation.trip?.days?.flatMap((day) => day.stops || []).some((stop) => stop.id === addedStop.id)) {
    throw new Error('reopened formal Trip did not use the Java candidate mutation');
  }
  const updated = await call('/api/trips/save', {
    method: 'POST', headers,
    body: JSON.stringify({ trip: reopenedMutation.trip, savedTripId: created.saved.id })
  });
  if (updated.isUpdate !== true || updated.saved?.id !== created.saved.id) {
    throw new Error('edited formal Java Trip did not update its original authority record');
  }

  const formalHistory = await call('/api/history', { headers });
  if (!formalHistory.sessions?.some((item) => item.id === created.saved.id) || formalHistory.sync?.authority !== 'JAVA_FORMAL_TRIPS') {
    throw new Error('history did not project Java formal Trips');
  }
  const restoredHistory = await call(`/api/history/${encodeURIComponent(created.saved.id)}`, { headers });
  if (!restoredHistory.session?.id || restoredHistory.savedTripId !== created.saved.id) {
    throw new Error('history did not reopen the Java formal Trip into a transient Shadow session');
  }

  const shadowStatus = await call('/api/shadow/status');
  const operations = new Set((shadowStatus.shadow?.recent || []).map((entry) => entry.operation));
  for (const operation of ['plan', 'replan', 'stops', 'trip']) {
    if (!operations.has(operation)) throw new Error(`missing Shadow comparison for ${operation}`);
  }
  if (shadowStatus.shadow?.persisted !== false || shadowStatus.shadow?.javaCandidateErrorRate !== 0) {
    throw new Error('Shadow metrics did not report a non-persistent successful Java candidate run');
  }

  console.log('Java candidate integration passed: Java plan/replan/stops, Java-only observation, Java formal Trip persistence, and transient formal-Trip reopening.');
} finally {
  server.kill();
}
