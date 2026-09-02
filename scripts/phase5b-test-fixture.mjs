import { spawn } from 'node:child_process';

// Synthetic-only credentials for isolated in-memory regression processes.
export const PHASE5B_FIXTURE_ADMIN_EMAIL = 'phase5b-admin@example.invalid';
export const PHASE5B_FIXTURE_ADMIN_PASSWORD = 'phase5b-test-admin-credential-only';
export const PHASE5B_FIXTURE_TRAVELER_PASSWORD = 'phase5b-test-traveler-credential-only';

export function spawnPhase5bFixtureServer(port, overrides = {}) {
  return spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      YUYOUZHICE_MEMORY: '1',
      YUYOUZHICE_TEST_FIXTURES: '1',
      YUYOUZHICE_TEST_ADMIN_EMAIL: PHASE5B_FIXTURE_ADMIN_EMAIL,
      YUYOUZHICE_TEST_ADMIN_PASSWORD: PHASE5B_FIXTURE_ADMIN_PASSWORD,
      PORT: String(port),
      ...overrides
    },
    stdio: 'pipe'
  });
}
