import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('local startup refuses unknown occupied ports before starting any service', async () => {
  const script = await readFile(path.join(repositoryRoot, 'start-local.ps1'), 'utf8');
  const preflightIndex = script.indexOf('$requiredPorts = @(');
  const firstProcessStartIndex = script.indexOf('Start-Process -FilePath');

  assert.notEqual(preflightIndex, -1, 'startup preflight should enumerate required ports');
  assert.ok(firstProcessStartIndex > preflightIndex, 'all port checks must run before the first process starts');
  assert.match(script, /if \(Test-PortOpen -Port \$entry\.Port\)[\s\S]*?exit 1/);
  assert.match(script, /unknown processes are never reused/);
  assert.doesNotMatch(script, /ALREADY READY \(reuse existing process\)/);
});
