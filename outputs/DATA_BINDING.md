# 渝游智策｜UI → 数据绑定清单

## Planning

- `TravelConstraintSlots`: arrivalAt, departureAt, durationDays, companions, walkingTolerance, budget, interests, stayArea, transportPreference, dietPreference
- `TripPlan`: version, days[], stops[], stableStopId, entityId, startTime, duration, reason, matchedConstraints, estimatedCost, walkingInfo, facts[], citations[]
- `MapContext`: entity coordinates, route polyline, walking distance/duration, transit options

## Attraction Detail

- `Attraction`: entityId, name, description, images, address, navi entry/exit, open status
- `Fact`: key, value, status ∈ VERIFIED | PARTIALLY_VERIFIED | UNVERIFIED | UNKNOWN | CONFLICT | STALE | DYNAMIC
- `Citation`: title, publisher, url, updatedAt, verificationStatus

## Local Replan

- Request: currentTripPlanVersion, targetStableStopId, reason, constraints
- Response: replacementStop, decisionReason, changedSegments, unchangedStops, facts, citations, newPlanVersion, diffSummary

## Auth and memory

- Anonymous session stores raw request, slots, plan, version, replan history, session feedback, temporary preferences.
- Save requires auth but must preserve pending anonymous plan through login/register.
- `MemoryProposal`: candidatePreference, scope, userDecision; only “记住” creates long-term preference.
