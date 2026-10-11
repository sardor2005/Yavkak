import { spawnSync, spawn } from 'node:child_process';

const executable = process.env.SUPABASE_CLI || 'npx';
const args = process.env.SUPABASE_CLI ? ['status', '--output', 'json'] : ['supabase', 'status', '--output', 'json'];
const status = spawnSync(executable, args, { encoding: 'utf8' });
if (status.status !== 0) { console.error('Сначала запустите локальный Supabase командой из README.'); process.exit(1); }
const settings = JSON.parse(status.stdout);
if (!settings.API_URL || !settings.ANON_KEY || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(settings.API_URL).hostname)) {
  console.error('Локальная конфигурация Supabase недоступна.'); process.exit(1);
}
// Only the public local key reaches Vite. Privileged local keys stay out of the browser.
const child = spawn('npm', ['run', 'dev', '--', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, VITE_SUPABASE_URL: settings.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: settings.ANON_KEY } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
