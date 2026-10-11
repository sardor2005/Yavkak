import { spawnSync } from 'node:child_process'

// Keys come from the running local stack and are passed only to the test process.
// Nothing is written to a tracked file or printed to the console.
const executable = process.env.SUPABASE_CLI || 'npx'
const args = process.env.SUPABASE_CLI
  ? ['status', '--output', 'json']
  : ['--yes', 'supabase@2.75.0', 'status', '--output', 'json']
const status = spawnSync(executable, args, {
  encoding: 'utf8',
  env: {
    ...process.env,
    npm_config_cache: process.env.npm_config_cache || '/tmp/yavka-npm-cache',
    npm_config_https_proxy: process.env.npm_config_https_proxy || process.env.HTTPS_PROXY || '',
    NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS || process.env.CODEX_PROXY_CERT || '',
  },
})
if (status.status !== 0) {
  console.error('Local Supabase is unavailable. Start it with supabase start, then retry.')
  process.exit(1)
}
let configuration
try {
  configuration = JSON.parse(status.stdout)
} catch {
  console.error('Supabase status did not return valid JSON.')
  process.exit(1)
}
if (!configuration.API_URL || !configuration.ANON_KEY || !configuration.SERVICE_ROLE_KEY) {
  console.error('Local Supabase status is missing its API URL or generated local keys.')
  process.exit(1)
}
const hostname = new URL(configuration.API_URL).hostname
if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
  console.error('These tests may create and remove fixtures only on a local Supabase stack.')
  process.exit(1)
}
const browserRun = process.argv.includes('--e2e')
const result = spawnSync(browserRun ? 'npm' : process.execPath, browserRun ? ['run', 'test:e2e'] : ['--test', 'tests/integration/supabase.test.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    SUPABASE_TEST_URL: configuration.API_URL,
    SUPABASE_TEST_ANON_KEY: configuration.ANON_KEY,
    SUPABASE_TEST_SERVICE_ROLE_KEY: configuration.SERVICE_ROLE_KEY,
    SUPABASE_TEST_MAILPIT_URL: configuration.INBUCKET_URL || 'http://127.0.0.1:54324',
    ...(browserRun ? { YAVKA_E2E_LIVE: '1', VITE_SUPABASE_URL: configuration.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: configuration.ANON_KEY } : {}),
  },
})
process.exit(result.status ?? 1)
