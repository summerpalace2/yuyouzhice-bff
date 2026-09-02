import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'yuyouzhice-phase5a-auth-'));
const dataFile = path.join(tempDir, 'store.json');
const testAuthSecret = 'phase5a-node-test-secret-0123456789';
const legacyAuthSecret = 'legacy-secret-must-not-be-reused-012345';
const originalAuthSecret = process.env.YUYOUZHICE_AUTH_SECRET;
const originalMemoryMode = process.env.YUYOUZHICE_MEMORY;
let server;

const baseState = {
  version: 1,
  authSecret: legacyAuthSecret,
  nextTripId: 1,
  users: [],
  tripsByUser: {},
  historyByUser: {},
  preferencesByUser: {},
  preferenceHistoryByUser: {},
  feedbackByUser: {}
};

try {
  await writeFile(dataFile, `${JSON.stringify(baseState)}\n`, 'utf8');
  process.env.YUYOUZHICE_AUTH_SECRET = testAuthSecret;
  delete process.env.YUYOUZHICE_MEMORY;

  const { createPersistentStore } = await import('../server/persistent-store.mjs');
  const store = await createPersistentStore({ rootDir: tempDir, filePath: dataFile, enabled: true });
  assert.equal(store.authSecret, testAuthSecret);
  const normalized = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'authSecret'), false);

  delete process.env.YUYOUZHICE_AUTH_SECRET;
  await assert.rejects(
    () => createPersistentStore({ rootDir: tempDir, filePath: dataFile, enabled: true }),
    /受保护配置设置 YUYOUZHICE_AUTH_SECRET/
  );

  process.env.YUYOUZHICE_MEMORY = '1';
  const { createAppServer } = await import('../server/index.mjs');
  server = createAppServer({ port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/data/yuyouzhice.json`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.ok, false);

  console.log('Phase 5A Node auth foundation checks passed');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(tempDir, { recursive: true, force: true });
  if (originalAuthSecret === undefined) delete process.env.YUYOUZHICE_AUTH_SECRET;
  else process.env.YUYOUZHICE_AUTH_SECRET = originalAuthSecret;
  if (originalMemoryMode === undefined) delete process.env.YUYOUZHICE_MEMORY;
  else process.env.YUYOUZHICE_MEMORY = originalMemoryMode;
}
