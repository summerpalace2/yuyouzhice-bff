import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createPersistentStore } from '../server/persistent-store.mjs';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'yuyouzhice-phase5b-'));
const dataFile = path.join(tempDir, 'store.json');
const previous = {
  fixtures: process.env.YUYOUZHICE_TEST_FIXTURES,
  email: process.env.YUYOUZHICE_TEST_ADMIN_EMAIL,
  password: process.env.YUYOUZHICE_TEST_ADMIN_PASSWORD,
  secret: process.env.YUYOUZHICE_AUTH_SECRET
};

try {
  process.env.YUYOUZHICE_AUTH_SECRET = 'phase5b-security-check-secret-0123456789';
  delete process.env.YUYOUZHICE_TEST_FIXTURES;
  delete process.env.YUYOUZHICE_TEST_ADMIN_EMAIL;
  delete process.env.YUYOUZHICE_TEST_ADMIN_PASSWORD;

  const persistentStore = await createPersistentStore({ filePath: dataFile, enabled: true });
  assert.equal('usersById' in persistentStore, false);
  assert.equal('usersByEmail' in persistentStore, false);
  assert.equal('createUser' in persistentStore, false);
  assert.equal('verifyPassword' in persistentStore, false);
  assert.equal('tripsByUser' in persistentStore, false);
  assert.equal('preferencesByUser' in persistentStore, false);

  process.env.YUYOUZHICE_TEST_FIXTURES = '1';
  process.env.YUYOUZHICE_TEST_ADMIN_EMAIL = 'phase5b-fixture-admin@example.invalid';
  process.env.YUYOUZHICE_TEST_ADMIN_PASSWORD = 'phase5b-fixture-admin-credential-only';
  const fixturePersistentStore = await createPersistentStore({ filePath: dataFile, enabled: true });
  assert.equal('usersByEmail' in fixturePersistentStore, false);
  await fixturePersistentStore.flush();

  const memoryStore = await createPersistentStore({ filePath: dataFile, enabled: false });
  assert.equal('usersByEmail' in memoryStore, false);
  assert.equal('publicUser' in memoryStore, false);
  assert.equal('verifyPassword' in memoryStore, false);
  assert.ok(memoryStore.feedbackByUser instanceof Map);

  console.log('Phase 5B Node 安全验收通过：Node 不持有用户/密码 authority，测试 fixture 由 Java 边界负责');
} finally {
  for (const [key, value] of Object.entries({
    YUYOUZHICE_TEST_FIXTURES: previous.fixtures,
    YUYOUZHICE_TEST_ADMIN_EMAIL: previous.email,
    YUYOUZHICE_TEST_ADMIN_PASSWORD: previous.password,
    YUYOUZHICE_AUTH_SECRET: previous.secret
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(tempDir, { recursive: true, force: true });
}
