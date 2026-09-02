/**
 * trip-migration.mjs
 *
 * Migrates the legacy Node saved-trip wrappers into the Java formal Trip API.
 * The default is a read-only dry-run. It never edits data/yuyouzhice.json.
 *
 * Examples:
 *   node scripts/trip-migration.mjs --dry-run
 *   node scripts/trip-migration.mjs --input data/yuyouzhice.json --owner-map owner-map.json --dry-run
 *   node scripts/trip-migration.mjs --run --core-url http://localhost:8080 --tokens tokens.json
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT = path.join(PROJECT_ROOT, 'data', 'yuyouzhice.json');

function parseArgs(argv) {
  const args = { dryRun: true, run: false, input: DEFAULT_INPUT, output: '', ownerMap: '', tokens: '', coreUrl: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--run') { args.run = true; args.dryRun = false; continue; }
    if (value === '--dry-run') { args.dryRun = true; args.run = false; continue; }
    if (value === '--input') { args.input = path.resolve(argv[++index] || ''); continue; }
    if (value === '--output') { args.output = path.resolve(argv[++index] || ''); continue; }
    if (value === '--owner-map') { args.ownerMap = path.resolve(argv[++index] || ''); continue; }
    if (value === '--tokens') { args.tokens = path.resolve(argv[++index] || ''); continue; }
    if (value === '--core-url') { args.coreUrl = String(argv[++index] || '').replace(/\/$/, ''); continue; }
    if (value === '--help') { args.help = true; continue; }
    throw new Error(`未知参数：${value}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/trip-migration.mjs [--dry-run|--run]',
    '  --input <file>       legacy data file (default: data/yuyouzhice.json)',
    '  --owner-map <file>   optional JSON mapping of legacy owner id to Java owner id',
    '  --tokens <file>      JSON mapping of Java owner id to Bearer token for --run',
    '  --core-url <url>     Java Core Backend base URL for --run',
    '  --output <file>      write normalized migration manifest atomically',
    '  --dry-run            validate and summarize without network or writes',
    '  --run                POST idempotent records and perform read parity checks'
  ].join('\n');
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} 无法读取或解析：${error.message}`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function checksum(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是 JSON object`);
  return value;
}

async function loadOptionalObject(filePath, label) {
  if (!filePath) return {};
  return parseObject(await readJson(filePath, label), label);
}

function resolveOwner(legacyOwnerId, userIds, ownerMap) {
  const mapped = text(ownerMap[legacyOwnerId] || legacyOwnerId);
  if (!mapped) throw new Error(`owner mapping 为空：${legacyOwnerId}`);
  if (!userIds.has(legacyOwnerId) && !ownerMap[legacyOwnerId]) {
    throw new Error(`legacy owner 不存在且没有映射：${legacyOwnerId}`);
  }
  return mapped;
}

function migrationPlan(wrapper, ownerId, legacyOwnerId, sourcePath) {
  const trip = clone(wrapper.trip);
  const legacyHistory = Array.isArray(wrapper.versionHistory) ? clone(wrapper.versionHistory) : [];
  // The inner draft id remains payload provenance only; the Java API allocates
  // the formal id and stores it outside this draft id.
  trip.legacyProvenance = {
    source: path.basename(sourcePath),
    legacyTripId: text(wrapper.id),
    legacyOwnerId,
    ownerId,
    legacySavedAt: text(wrapper.savedAt),
    legacyHistoryMetadata: legacyHistory,
    historySnapshotsAvailable: false
  };
  return trip;
}

function validateAndNormalize(source, ownerMap, sourcePath) {
  parseObject(source, 'legacy source');
  if (source.version !== 1) throw new Error(`不支持的 legacy source version：${source.version}`);
  if (!Array.isArray(source.users)) throw new Error('legacy users 必须是数组');
  const userIds = new Set(source.users.map((user) => text(user?.id)).filter(Boolean));
  const tripsByUser = parseObject(source.tripsByUser || {}, 'tripsByUser');
  const records = [];
  const seen = new Map();
  const events = [{ event: 'source.validated', source: sourcePath, version: source.version }];

  for (const [legacyOwnerId, wrappersValue] of Object.entries(tripsByUser)) {
    if (!Array.isArray(wrappersValue)) throw new Error(`tripsByUser.${legacyOwnerId} 必须是数组`);
    const ownerId = resolveOwner(legacyOwnerId, userIds, ownerMap);
    for (const wrapperValue of wrappersValue) {
      const wrapper = parseObject(wrapperValue, `trip wrapper ${legacyOwnerId}`);
      const legacyTripId = text(wrapper.id);
      if (!legacyTripId) throw new Error(`保存行程缺少 outer wrapper id：${legacyOwnerId}`);
      const trip = parseObject(wrapper.trip, `trip ${legacyTripId}`);
      const tripDraftId = text(trip.id);
      if (tripDraftId && !tripDraftId.startsWith('draft-cq-')) {
        events.push({ event: 'validation.warning', legacyTripId, message: 'inner trip id is not draft-cq-*; it remains payload-only' });
      }
      const sourceChecksum = checksum(wrapper);
      const identity = `${ownerId}:${legacyTripId}`;
      const previous = seen.get(identity);
      if (previous) {
        if (previous.checksum !== sourceChecksum) {
          throw new Error(`同一 owner/legacyTripId 对应不同 payload：${identity}`);
        }
        events.push({ event: 'duplicate.skipped', ownerId, legacyTripId, checksum: sourceChecksum });
        continue;
      }
      seen.set(identity, { checksum: sourceChecksum });
      const plan = migrationPlan(wrapper, ownerId, legacyOwnerId, sourcePath);
      const idempotencyKey = `legacy-trip:${ownerId}:${legacyTripId}`;
      records.push({
        ownerId,
        legacyOwnerId,
        legacyTripId,
        idempotencyKey,
        checksum: sourceChecksum,
        title: text(plan.title) || `legacy ${legacyTripId}`,
        plan,
        legacy: {
          savedAt: text(wrapper.savedAt),
          versionHistoryMetadata: Array.isArray(wrapper.versionHistory) ? clone(wrapper.versionHistory) : [],
          historySnapshotsAvailable: false
        }
      });
    }
  }
  events.push({ event: 'source.normalized', records: records.length, duplicateCount: events.filter((item) => item.event === 'duplicate.skipped').length });
  return { records, events };
}

function authToken(tokens, ownerId) {
  const token = text(tokens[ownerId]);
  if (!token) throw new Error(`--run 缺少 owner 的 Java Bearer token：${ownerId}`);
  return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { accept: 'application/json', 'content-type': 'application/json', ...(options.headers || {}) } });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!response.ok) throw new Error(`${response.status} ${data?.message || data?.error || raw.slice(0, 240)}`.trim());
  return data;
}

function extractTrip(response) {
  return response?.data?.id ? response.data : response?.data?.trip?.id ? response.data.trip : response?.trip?.id ? response.trip : null;
}

function assertReadParity(expected, actual) {
  if (!actual?.id || actual.id !== expected.id) throw new Error(`read parity Trip id 不一致：${expected.id} / ${actual?.id || '(missing)'}`);
  if (Number(actual.currentVersion) !== Number(expected.currentVersion)) throw new Error(`read parity currentVersion 不一致：${expected.currentVersion} / ${actual.currentVersion}`);
  if (canonicalJson(actual.plan) !== canonicalJson(expected.plan)) throw new Error(`read parity snapshot 不一致：${expected.id}`);
  return { tripId: expected.id, version: expected.currentVersion, status: 'verified' };
}

async function runRemote(records, coreUrl, tokens) {
  if (!coreUrl) throw new Error('--run 必须提供 --core-url');
  const results = [];
  for (const record of records) {
    const authorization = authToken(tokens, record.ownerId);
    const response = await requestJson(`${coreUrl}/ai/trips`, {
      method: 'POST',
      headers: { authorization },
      body: JSON.stringify({ title: record.title, plan: record.plan, idempotencyKey: record.idempotencyKey })
    });
    const trip = extractTrip(response);
    if (!trip) throw new Error(`Java create response 缺少 Trip：${record.legacyTripId}`);
    const expectedPlan = clone(record.plan);
    expectedPlan.formalTripId = trip.id;
    if (canonicalJson(trip.plan) !== canonicalJson(expectedPlan)) {
      throw new Error(`create parity snapshot 不一致：${record.legacyTripId}`);
    }
    const readResponse = await requestJson(`${coreUrl}/ai/trips/${encodeURIComponent(trip.id)}`, {
      headers: { authorization }
    });
    const actual = extractTrip(readResponse);
    const parity = assertReadParity(trip, actual);
    results.push({ legacyTripId: record.legacyTripId, ownerId: record.ownerId, tripId: trip.id, version: trip.currentVersion, idempotencyStatus: response?.data?.operationStatus || 'accepted', parity });
  }
  return results;
}

async function writeManifest(filePath, value) {
  if (!filePath) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, filePath);
}

export async function runMigration(options = {}) {
  const input = path.resolve(options.input || DEFAULT_INPUT);
  const ownerMap = await loadOptionalObject(options.ownerMap, 'owner map');
  const tokens = await loadOptionalObject(options.tokens, 'token map');
  const source = await readJson(input, 'legacy source');
  const normalized = validateAndNormalize(source, ownerMap, input);
  const summary = {
    source: input,
    mode: options.run ? 'run' : 'dry-run',
    records: normalized.records.length,
    duplicateSkipped: normalized.events.filter((item) => item.event === 'duplicate.skipped').length,
    validation: 'passed',
    historyPolicy: 'metadata-only-no-fake-snapshots',
    events: normalized.events,
    migration: []
  };

  if (options.run) {
    summary.migration = await runRemote(normalized.records, options.coreUrl, tokens);
    summary.readParity = { status: 'verified', count: summary.migration.length };
  } else {
    summary.readParity = { status: 'not-run', reason: 'dry-run does not call Java Core Backend' };
  }
  const manifest = { summary, records: normalized.records };
  await writeManifest(options.output, manifest);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
  } else {
    runMigration(args)
      .then((result) => console.log(JSON.stringify(result.summary, null, 2)))
      .catch((error) => {
        console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
        process.exitCode = 1;
      });
  }
}
