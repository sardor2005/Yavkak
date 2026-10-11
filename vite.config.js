import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  let role;
  if (key.split('.').length === 3) {
    try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch { /* non-JWT publishable keys remain supported */ }
  }
  if (key.startsWith('sb_secret_') || role === 'service_role') throw new Error('Frontend requires a public Supabase key; privileged keys are forbidden.');
  if (env.VITE_SUPABASE_URL) {
    const url = new URL(env.VITE_SUPABASE_URL);
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Supabase URL must use HTTPS, or HTTP for local development.');
  }
  return { plugins: [react()], build: { rollupOptions: { output: { manualChunks(id) {
  if (id.includes('node_modules/@supabase/') || id.includes('node_modules/iceberg-js/')) return 'supabase';
  if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react';
} } } } };
});
