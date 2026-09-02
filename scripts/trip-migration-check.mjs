import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runMigration } from './trip-migration.mjs';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'yuyouzhice-trip-migration-'));

function wrapper(id, draftId = `draft-cq-${id}`, title = `行程 ${id}`) {
  return {
    id,
    savedAt: '2026-08-16T10:00:00.000Z',
    trip: { id: draftId, title, days: [] },
    versionHistory: [{ version: 1, reason: '初始保存' }]
  };
}

function source(tripsByUser, users = [{ id: 'legacy-user' }]) {
  return { version: 1, users, tripsByUser };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function jsonResponse(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(value);
    }
  };
}

try {
  const input = path.join(tempDir, 'source.json');
  const output = path.join(tempDir, 'manifest.json');
  const ownerMap = path.join(tempDir, 'owner-map.json');
  const tokens = path.join(tempDir, 'tokens.json');
  const first = wrapper('legacy-1');
  const second = wrapper('legacy-2');
  await writeJson(input, source({ 'legacy-user': [first, first, second] }));

  const dryRun = await runMigration({ input, output });
  assert.equal(dryRun.summary.mode, 'dry-run');
  assert.equal(dryRun.summary.records, 2);
  assert.equal(dryRun.summary.duplicateSkipped, 1);
  assert.equal(dryRun.summary.readParity.status, 'not-run');
  assert.equal(dryRun.records[0].ownerId, 'legacy-user');
  assert.equal(dryRun.records[0].legacyOwnerId, 'legacy-user');
  assert.equal(dryRun.records[0].plan.id, 'draft-cq-legacy-1');
  assert.equal(dryRun.records[0].plan.formalTripId, undefined);
  assert.equal(dryRun.records[0].plan.legacyProvenance.historySnapshotsAvailable, false);
  assert.equal(dryRun.records[0].plan.legacyProvenance.legacyHistoryMetadata[0].version, 1);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), dryRun);

  const mappedInput = path.join(tempDir, 'mapped-source.json');
  await writeJson(mappedInput, source({ 'legacy-user': [wrapper('legacy-mapped')] }));
  await writeJson(ownerMap, { 'legacy-user': 'java-user' });
  await writeJson(tokens, { 'java-user': 'migration-token' });
  const mapped = await runMigration({ input: mappedInput, ownerMap });
  assert.equal(mapped.records[0].ownerId, 'java-user');
  assert.equal(mapped.records[0].legacyOwnerId, 'legacy-user');
  assert.equal(mapped.records[0].plan.legacyProvenance.ownerId, 'java-user');
  assert.equal(mapped.records[0].plan.legacyProvenance.legacyOwnerId, 'legacy-user');
  assert.equal(mapped.records[0].idempotencyKey, 'legacy-trip:java-user:legacy-mapped');

  const conflictingInput = path.join(tempDir, 'conflicting-source.json');
  await writeJson(conflictingInput, source({ 'legacy-user': [wrapper('legacy-conflict', 'draft-cq-a', 'A'), wrapper('legacy-conflict', 'draft-cq-a', 'B')] }));
  await assert.rejects(
    () => runMigration({ input: conflictingInput }),
    /同一 owner\/legacyTripId 对应不同 payload/
  );

  const invalidInput = path.join(tempDir, 'invalid-source.json');
  await writeJson(invalidInput, { version: 2, users: [], tripsByUser: {} });
  await assert.rejects(() => runMigration({ input: invalidInput }), /不支持的 legacy source version/);

  const remoteInput = path.join(tempDir, 'remote-source.json');
  await writeJson(remoteInput, source({ 'legacy-user': [wrapper('legacy-remote')] }));
  const remoteCalls = [];
  const previousFetch = globalThis.fetch;
  let remoteTrip;
  globalThis.fetch = async (url, options = {}) => {
    remoteCalls.push({ url: String(url), options });
    if (String(url).endsWith('/ai/trips')) {
      const body = JSON.parse(options.body);
      remoteTrip = {
        id: 'trip-java-remote',
        ownerId: 'java-user',
        title: body.title,
        status: 'ACTIVE',
        currentVersion: 1,
        createdAt: 1,
        updatedAt: 1,
        plan: { ...body.plan, formalTripId: 'trip-java-remote' }
      };
      return jsonResponse(201, { data: remoteTrip });
    }
    return jsonResponse(200, { data: remoteTrip });
  };
  let remoteManifest;
  try {
    remoteManifest = await runMigration({
      input: remoteInput,
      ownerMap,
      run: true,
      coreUrl: 'http://core.test',
      tokens
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(remoteManifest.summary.readParity.status, 'verified');
  assert.equal(remoteManifest.summary.readParity.count, 1);
  assert.equal(remoteCalls.length, 2);
  assert.equal(remoteCalls[0].options.headers.authorization, 'Bearer migration-token');
  assert.equal(JSON.parse(remoteCalls[0].options.body).idempotencyKey, 'legacy-trip:java-user:legacy-remote');

  console.log('Trip migration checks passed: dry-run, provenance, duplicate safety, validation, and remote parity');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
