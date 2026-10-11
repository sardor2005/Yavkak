import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('built frontend excludes privileged Supabase credentials and active demo imports', () => {
  assert.ok(existsSync('dist/assets'), 'Run npm run build before npm test');
  const code = readdirSync('dist/assets').filter(file => file.endsWith('.js')).map(file => readFileSync(`dist/assets/${file}`, 'utf8')).join('\n');
  assert.doesNotMatch(code, /sb_secret_[A-Za-z0-9_-]{20,}/);
  for (const token of code.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
    let payload;
    try { payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { continue; }
    assert.notEqual(payload.role, 'service_role', 'Privileged JWT found in build');
  }
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY']) {
    const known = process.env[name];
    if (known && known.length > 20) assert.ok(!code.includes(known), 'Privileged runtime credential found in build');
  }
  assert.doesNotMatch(code, /yavka:repository:v1|demo-yavka|#invite=/);
});

test('Vite rejects a privileged key before creating a frontend bundle', () => {
  const attempted = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    encoding: 'utf8', env: { ...process.env, VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_TEST_FIXTURE_NOT_A_REAL_CREDENTIAL' },
  });
  assert.notEqual(attempted.status, 0);
  assert.match(attempted.stderr, /privileged keys are forbidden/);
  assert.doesNotMatch(attempted.stderr, /sb_secret_TEST_FIXTURE/);
});
