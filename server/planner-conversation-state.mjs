// Pure structured snapshots and request ownership shared by the BFF and its regression tests.
const short = (value, limit = 100) => String(value ?? '').trim().slice(0, limit);
export function boundedPlanChatContext(session, activeDay = 1) {
  const constraints = session?.trip?.constraints || session?.constraints || {};
  const days = Array.isArray(session?.trip?.days) ? session.trip.days : [];
  const queues = days.map((d, index) => ({ day: Number(d.day || index + 1), date:short(d.date,32), stops: [...(d.stops || [])] }));
  queues.sort((a,b) => Number(b.day === activeDay) - Number(a.day === activeDay));
  const currentStops = []; const totalStops = queues.reduce((n,q) => n+q.stops.length,0);
  // Round-robin preserves visibility of later days even when the first day is long.
  while (queues.some(q => q.stops.length) && currentStops.length < 24) for (const q of queues) {
    if (!q.stops.length || currentStops.length >= 24) continue;
    const stop=q.stops.shift(); if (!stop?.name) continue;
    currentStops.push({ day:q.day, date:q.date, id:short(stop.id,60), name:short(stop.name,80), time:short(stop.time || stop.startTime,16), duration:short(stop.duration,24), address:short(stop.address,60), summary:short(stop.summary || stop.intro,60) });
  }
  const snapshot = { activeDay:Number(activeDay), companions:short(constraints.companions), walkingTolerance:short(constraints.walkingTolerance), interests:(constraints.interests || []).slice(0,12).map(x=>short(x,40)), transportPreference:short(constraints.transportPreference), dietPreference:short(constraints.dietPreference), stayArea:short(constraints.stayArea), budget:constraints.budget ? { min:short(constraints.budget.min,24),max:short(constraints.budget.max,24) } : null, totalDays:days.length,totalStops,omittedStops:totalStops-currentStops.length,currentStops };
  if (JSON.stringify(snapshot).length > 3600) for (const stop of currentStops) { delete stop.summary; delete stop.address; }
  while (JSON.stringify(snapshot).length > 3600 && currentStops.length) { currentStops.pop(); snapshot.omittedStops++; }
  return JSON.stringify(snapshot);
}
export function claimPlannerRound(session) {
  session.plannerRequestGeneration = Number(session.plannerRequestGeneration || 0)+1;
  return { generation:session.plannerRequestGeneration, revision:Number(session.trip?.version || 1) };
}
export function ownsPlannerRound(session, round) {
  return session.plannerRequestGeneration === round.generation && Number(session.trip?.version || 1) === round.revision;
}
