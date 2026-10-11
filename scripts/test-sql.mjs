import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Real PostgreSQL role/RLS execution; these fixtures do not emulate HTTP/Auth/Storage services.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite({ extensions: { pgcrypto } });
try {
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,storage,public to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public bool,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security; grant select,insert,delete,update on storage.objects to authenticated;
    create publication supabase_realtime;`);
  const migrations = resolve(root, 'supabase/migrations');
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(resolve(migrations, name), 'utf8'));
    console.log(`Migration ${name}: PASS`);
  }
  const results = await db.exec(await readFile(resolve(root, 'supabase/tests/security.sql'), 'utf8'));
  console.log(`SQL/RLS suite: PASS (${results.length} statements; fixtures rolled back)`);
} catch (error) {
  console.error(`SQL/RLS suite failed: ${error.message}`); process.exitCode = 1;
} finally { await db.close(); }
