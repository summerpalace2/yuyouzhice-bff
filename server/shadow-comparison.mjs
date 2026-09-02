/**
 * Stateless normalization and process-local metrics for Java candidate
 * observations. Nothing in this module persists a Trip or business state.
 */

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function allStops(trip) {
  return (Array.isArray(asObject(trip).days) ? trip.days : [])
    .flatMap((day) => Array.isArray(asObject(day).stops) ? day.stops : []);
}

function stopIds(stops) {
  return stops
    .map((stop) => String(stop?.venueId || stop?.entityId || stop?.id || '').trim())
    .filter(Boolean);
}

function routeCoverage(trip) {
  const days = Array.isArray(asObject(trip).days) ? trip.days : [];
  let expected = 0;
  let complete = 0;
  for (const day of days) {
    const stops = Array.isArray(asObject(day).stops) ? day.stops : [];
    expected += Math.max(0, stops.length - 1);
    for (let index = 1; index < stops.length; index += 1) {
      const stop = asObject(stops[index]);
      const route = stop.routeFromPrevious || asObject(stop.mapContext).routeFromPrevious;
      if (route && route.fallback !== true) complete += 1;
    }
  }
  return { expected, complete, ratio: expected ? Number((complete / expected).toFixed(2)) : 1 };
}

function expectedVisits(input = {}) {
  const constraints = asObject(input.constraints);
  const listed = [
    ...(Array.isArray(constraints.mustVisitIds) ? constraints.mustVisitIds : []),
    ...(Array.isArray(constraints.mustVisit) ? constraints.mustVisit : []),
    input.candidateVenueId,
    ['add', 'replace'].includes(String(input.operation || '')) ? input.attractionId : ''
  ];
  return [...new Set(listed.map((item) => String(item || '').trim()).filter(Boolean))];
}

function visitCheck(stops, expected) {
  const actual = new Set(stopIds(stops));
  const missing = expected.filter((item) => !actual.has(item));
  return {
    required: expected,
    satisfied: missing.length === 0,
    missing,
    status: expected.length ? (missing.length ? 'FAILED' : 'SATISFIED') : 'NOT_APPLICABLE'
  };
}

export function compareShadow({ operation, input, candidate, candidateLatencyMs, candidateError } = {}) {
  const candidateTrip = asObject(candidate?.trip || candidate);
  const candidateStops = allStops(candidateTrip);
  const candidateSucceeded = !candidateError && candidate?.ok !== false && Object.keys(candidateTrip).length > 0;
  return {
    operation: String(operation || 'plan'),
    recordedAt: new Date().toISOString(),
    mode: 'java-only',
    java: {
      succeeded: candidateSucceeded,
      latencyMs: Number(candidateLatencyMs || 0),
      error: candidateError ? String(candidateError.message || candidateError) : '',
      stopCount: stopIds(candidateStops).length,
      dayCount: Array.isArray(candidateTrip.days) ? candidateTrip.days.length : 0
    },
    routeCompleteness: routeCoverage(candidateTrip),
    mustVisitCorrectness: visitCheck(candidateStops, expectedVisits(input))
  };
}

export function createShadowMetrics({ limit = 100 } = {}) {
  const entries = [];
  return {
    record(entry) {
      entries.push(entry);
      if (entries.length > limit) entries.splice(0, entries.length - limit);
      return entry;
    },
    status() {
      const total = entries.length;
      const javaSucceeded = entries.filter((entry) => entry.java?.succeeded).length;
      return {
        mode: 'java-only',
        persisted: false,
        total,
        javaCandidateSuccessRate: total ? Number((javaSucceeded / total).toFixed(2)) : 1,
        javaCandidateErrorRate: total ? Number(((total - javaSucceeded) / total).toFixed(2)) : 0,
        recent: entries.slice(-20).reverse()
      };
    }
  };
}
