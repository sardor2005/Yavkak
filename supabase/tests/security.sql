-- Run as the local database owner after the migrations. This rolls back fixtures.
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security.sql
-- These are actual PostgreSQL role/RLS tests; Auth/Storage HTTP tests are separate.
begin;
create temporary table fixtures(key text primary key,value jsonb not null);
grant select,insert,update on fixtures to authenticated,anon;
create function pg_temp.assert(p_ok boolean,p_label text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL: %',p_label; end if; end $$;
create function pg_temp.expect_error(p_sql text,p_state text,p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlstate=p_state then return; end if;
    raise exception 'FAIL: % (expected %, got %: %)',p_label,p_state,sqlstate,sqlerrm;
  end;
  raise exception 'FAIL: % (operation unexpectedly succeeded)',p_label;
end $$;

insert into auth.users(id,raw_user_meta_data) values
 ('11111111-1111-4111-8111-111111111111','{"name":"SQL Alice"}'),
 ('22222222-2222-4222-8222-222222222222','{"name":"SQL Bob"}'),
 ('33333333-3333-4333-8333-333333333333','{"name":"SQL Stranger"}');

select pg_temp.assert((select count(*)=10 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('profiles','friend_requests','friendships','meetings','meeting_participants',
    'meeting_invitations','attendance_events','meeting_photos','rating_events','chat_messages') and c.relrowsecurity),'RLS enabled on all ten API tables');
select pg_temp.assert(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='email'),'profiles cannot disclose email');
select pg_temp.assert(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='meeting_invitations' and column_name='token_hash'),'invitation verifier not public');
select pg_temp.assert((select not public and file_size_limit=2097152 from storage.buckets where id='meeting-photos'),'private Storage bucket enforces 2 MiB');
select pg_temp.assert(not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prosecdef and not ('search_path=""'=any(p.proconfig))),'all definers fix search_path');

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error('select * from public.meetings','42501','anonymous meeting access denied');
select pg_temp.expect_error('select public.rating_summary()','42501','anonymous RPC execution denied');
select pg_temp.expect_error('select * from private.invitation_tokens','42501','anonymous token access denied');
do $$ declare v_table text; begin
  foreach v_table in array array['profiles','friend_requests','friendships','meeting_participants','meeting_invitations',
    'attendance_events','meeting_photos','rating_events','chat_messages'] loop
    perform pg_temp.expect_error(format('select * from public.%I',v_table),'42501','anonymous '||v_table||' access denied');
  end loop;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select pg_temp.assert((select count(*)=3 from public.profiles),'authenticated directory only contains public fields');
select pg_temp.expect_error('select email from public.profiles','42703','email not in directory');
update public.profiles set name='SQL Alice updated',avatar_url='https://example.com/avatar.png' where id=auth.uid();
select pg_temp.expect_error('update public.profiles set public_id=''yavka-0000000000000000'' where id=auth.uid()','42501','public identifier immutable');
with changed as (update public.profiles set name='hacked' where id='22222222-2222-4222-8222-222222222222' returning id)
  select pg_temp.assert((select count(*)=0 from changed),'cannot update another profile');
select pg_temp.expect_error('select public.request_friend(auth.uid())','P0001','self friendship rejected');
insert into fixtures values('request',to_jsonb(public.request_friend('22222222-2222-4222-8222-222222222222')));
select pg_temp.assert((public.request_friend('22222222-2222-4222-8222-222222222222')).id=(select (value->>'id')::uuid from fixtures where key='request'),'friend request retry idempotent');
select pg_temp.expect_error(format('select public.respond_friend_request(%L,true)',(select value->>'id' from fixtures where key='request')),'42501','sender cannot accept own friend request');
insert into fixtures values('meeting',to_jsonb(public.create_meeting(jsonb_build_object('title','SQL meeting','description','Private','place_name','Cafe',
  'place_address','Tashkent','starts_at',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'time_zone','Asia/Tashkent'))));
select pg_temp.assert((select count(*)=1 from public.meetings),'organizer reads own meeting');
select pg_temp.expect_error('insert into public.meetings(organizer_id,title,place_name,starts_at,time_zone) values(auth.uid(),''Bypass'',''Cafe'',now(),''UTC'')','42501','direct meeting insert denied');
select pg_temp.expect_error(format('update public.meetings set organizer_id=''22222222-2222-4222-8222-222222222222'' where id=%L',(select value->>'id' from fixtures where key='meeting')),'42501','direct meeting mutation denied');
select pg_temp.expect_error(format('select public.complete_meeting(%L)',(select value->>'id' from fixtures where key='meeting')),'P0001','cannot complete before scheduled start');
select pg_temp.expect_error(format('select public.update_meeting(%L,''{"organizer_id":"22222222-2222-4222-8222-222222222222"}'')',(select value->>'id' from fixtures where key='meeting')),'P0001','cannot smuggle organizer field through RPC');
select pg_temp.expect_error(format('select public.create_invite(%L,''33333333-3333-4333-8333-333333333333'',72)',(select value->>'id' from fixtures where key='meeting')),'42501','direct invite requires existing friendship');
insert into fixtures values('link',public.create_invite((select (value->>'id')::uuid from fixtures where key='meeting')));
select pg_temp.assert(length((select value->>'token' from fixtures where key='link'))=64,'link has 256-bit random token');
select pg_temp.expect_error('select * from private.invitation_tokens','42501','authenticated clients cannot read token hashes');
select pg_temp.expect_error('select private.answer_invitation(gen_random_uuid(),true)','42501','private acceptance helper cannot bypass token check');

-- A pending invite grants no meeting, participant, chat, photo, attendance or rating read.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select pg_temp.assert((select count(*)=0 from public.meetings),'pending user cannot read private meeting');
select pg_temp.assert((select count(*)=0 from public.meeting_participants),'pending user cannot list participants');
select public.respond_friend_request((select (value->>'id')::uuid from fixtures where key='request'),true);
select pg_temp.assert((select count(*)=1 from public.friendships),'friendship persisted after real acceptance');
select pg_temp.expect_error('select public.request_friend(''11111111-1111-4111-8111-111111111111'')','P0001','duplicate friendship rejected');
select pg_temp.expect_error(format('select public.update_meeting(%L,''{"title":"hacked"}'')',(select value->>'id' from fixtures where key='meeting')),'42501','nonorganizer mutation denied');
select pg_temp.expect_error(format('select public.join_invite(%L,true)',repeat('0',64)),'42501','fabricated token denied');

-- Revoke one token and expire another; neither can add membership.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
insert into fixtures values('revoked',public.create_invite((select (value->>'id')::uuid from fixtures where key='meeting')));
select public.revoke_invite((select (value->>'id')::uuid from fixtures where key='revoked'));
insert into fixtures values('expired',public.create_invite((select (value->>'id')::uuid from fixtures where key='meeting')));
insert into fixtures values('direct',public.create_invite((select (value->>'id')::uuid from fixtures where key='meeting'),'22222222-2222-4222-8222-222222222222'));
reset role;
update public.meeting_invitations set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour'
  where id=(select (value->>'id')::uuid from fixtures where key='expired');
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select pg_temp.assert((select count(*)=1 from public.meeting_invitations),'recipient reads only own direct invitation');
select pg_temp.expect_error(format('select public.join_invite(%L,true)',(select value->>'token' from fixtures where key='revoked')),'42501','revoked token denied');
select pg_temp.expect_error(format('select public.join_invite(%L,true)',(select value->>'token' from fixtures where key='expired')),'42501','expired token denied');
select public.respond_invitation((select (value->>'id')::uuid from fixtures where key='direct'),true);
select public.respond_invitation((select (value->>'id')::uuid from fixtures where key='direct'),true);
select pg_temp.assert((select count(*)=2 from public.meeting_participants),'invite retry creates one participant');
select pg_temp.assert((select count(*)=1 from public.meetings),'accepted participant reads meeting');
select public.join_invite((select value->>'token' from fixtures where key='link'),true);
select public.join_invite((select value->>'token' from fixtures where key='link'),true);
select pg_temp.assert((select count(*)=2 from public.meeting_participants),'link retry creates no duplicate participant');
select public.respond_attendance((select (value->>'id')::uuid from fixtures where key='meeting'),'declined');
select pg_temp.expect_error(format('select public.set_arrival(%L,''arrived'')',(select value->>'id' from fixtures where key='meeting')),'P0001','declined participant cannot mark arrival');
select public.respond_attendance((select (value->>'id')::uuid from fixtures where key='meeting'),'accepted');
select public.set_arrival((select (value->>'id')::uuid from fixtures where key='meeting'),'ready');
select public.set_arrival((select (value->>'id')::uuid from fixtures where key='meeting'),'on_way');
insert into fixtures values('arrival',to_jsonb(public.set_arrival((select (value->>'id')::uuid from fixtures where key='meeting'),'arrived')));
select pg_temp.assert((public.set_arrival((select (value->>'id')::uuid from fixtures where key='meeting'),'arrived')).arrived_at=(select (value->>'arrived_at')::timestamptz from fixtures where key='arrival'),'arrival retry retains first server timestamp');
select pg_temp.expect_error(format('update public.meeting_participants set arrived_at=now()-interval ''1 day'' where meeting_id=%L',(select value->>'id' from fixtures where key='meeting')),'42501','cannot forge server arrival timestamp');
insert into fixtures values('message',to_jsonb(public.send_message((select (value->>'id')::uuid from fixtures where key='meeting'),'Real SQL chat')));
select pg_temp.expect_error(format('select public.send_message(%L,''spam'')',(select value->>'id' from fixtures where key='meeting')),'P0001','chat rate limit rejects rapid second message');
select pg_temp.assert((select count(*)=1 from public.chat_messages),'chat history persisted');

-- A third account cannot see any private rows or redeem a token another account used.
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select pg_temp.assert((select count(*)=0 from public.friend_requests),'stranger cannot read friend requests');
select pg_temp.assert((select count(*)=0 from public.friendships),'stranger cannot read friendships');
select pg_temp.assert((select count(*)=0 from public.meeting_invitations),'stranger cannot read invitations');
select pg_temp.assert((select count(*)=0 from public.meetings),'stranger cannot read meeting');
select pg_temp.assert((select count(*)=0 from public.chat_messages),'stranger cannot read chat');
select pg_temp.assert((select count(*)=0 from public.attendance_events),'stranger cannot read attendance');
select pg_temp.assert((select count(*)=0 from public.rating_events),'stranger cannot read results');
select pg_temp.expect_error(format('select public.send_message(%L,''intrusion'')',(select value->>'id' from fixtures where key='meeting')),'42501','stranger cannot send chat');
select pg_temp.expect_error(format('select public.set_arrival(%L,''arrived'')',(select value->>'id' from fixtures where key='meeting')),'42501','stranger cannot alter attendance');
select pg_temp.expect_error(format('select public.join_invite(%L,true)',(select value->>'token' from fixtures where key='link')),'42501','used token cannot be replayed by another account');
select pg_temp.expect_error(format('select public.respond_invitation(%L,true)',(select value->>'id' from fixtures where key='direct')),'42501','cannot accept another account invitation');
with deleted as (delete from public.chat_messages where id=(select (value->>'id')::uuid from fixtures where key='message') returning id)
  select pg_temp.assert((select count(*)=0 from deleted),'stranger cannot delete chat');

reset role;
insert into private.rpc_events(user_id,action)
  select '22222222-2222-4222-8222-222222222222'::uuid,'chat_minute' from generate_series(1,30);
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
with deleted as (delete from public.chat_messages where id=(select (value->>'id')::uuid from fixtures where key='message') returning id)
  select pg_temp.assert((select count(*)=1 from deleted),'author can delete own message');
select pg_temp.expect_error(format('select public.send_message(%L,''delete-spam'')',(select value->>'id' from fixtures where key='meeting')),'P0001','deleting messages cannot evade independent rate ledger');

-- Real Storage row policies: reservations, content metadata, author and membership.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
insert into fixtures values('photo',public.reserve_photo((select (value->>'id')::uuid from fixtures where key='meeting'),'Friends','image/jpeg',100));
select pg_temp.expect_error(format('select public.finish_photo(%L)',(select value->>'id' from fixtures where key='photo')),'P0001','cannot finish nonexistent upload');
-- The official Storage v1.35.3 permission probe inserts no metadata and rolls
-- back before sending bytes. Newer Storage sends only MIME and contentLength.
savepoint storage_probe;
insert into storage.objects(bucket_id,name) values('meeting-photos',(select value->>'path' from fixtures where key='photo'));
select pg_temp.assert((select metadata is null from storage.objects where name=(select value->>'path' from fixtures where key='photo')),'pinned Storage NULL-metadata permission probe allowed');
rollback to savepoint storage_probe;
insert into storage.objects(bucket_id,name,metadata) values('meeting-photos',(select value->>'path' from fixtures where key='photo'),'{"contentLength":100,"mimetype":"image/jpeg"}');
select pg_temp.expect_error(format('select public.finish_photo(%L)',(select value->>'id' from fixtures where key='photo')),'P0001','preflight metadata cannot publish without final exact size');
rollback to savepoint storage_probe;
select pg_temp.expect_error(format('insert into storage.objects(bucket_id,name,metadata) values(''meeting-photos'',%L,''{"contentLength":101,"mimetype":"image/jpeg"}'')',(select value->>'path' from fixtures where key='photo')),'42501','Storage rejects mismatched declared contentLength');
select pg_temp.expect_error(format('insert into storage.objects(bucket_id,name,metadata) values(''meeting-photos'',%L,''{"size":101,"mimetype":"image/jpeg"}'')',(select value->>'path' from fixtures where key='photo')),'42501','Storage rejects mismatch to reserved size');
insert into storage.objects(bucket_id,name,metadata) values('meeting-photos',(select value->>'path' from fixtures where key='photo'),' {"size":100,"mimetype":"image/jpeg"}');
select public.finish_photo((select (value->>'id')::uuid from fixtures where key='photo'));
select pg_temp.assert((select count(*)=1 from public.meeting_photos where ready),'uploaded ready photo visible');
with deleted as (delete from public.meeting_photos where id=(select (value->>'id')::uuid from fixtures where key='photo') returning id)
  select pg_temp.assert((select count(*)=0 from deleted),'metadata cannot be deleted while Storage object remains');
select pg_temp.expect_error(format('select public.reserve_photo(%L,''bad'',''image/svg+xml'',100)',(select value->>'id' from fixtures where key='meeting')),'P0001','SVG photo rejected');
select pg_temp.expect_error(format('select public.reserve_photo(%L,''big'',''image/jpeg'',2097153)',(select value->>'id' from fixtures where key='meeting')),'P0001','oversize photo rejected');
select public.reserve_photo((select (value->>'id')::uuid from fixtures where key='meeting'),'2','image/png',100);
select public.reserve_photo((select (value->>'id')::uuid from fixtures where key='meeting'),'3','image/png',100);
select public.reserve_photo((select (value->>'id')::uuid from fixtures where key='meeting'),'4','image/png',100);
select public.reserve_photo((select (value->>'id')::uuid from fixtures where key='meeting'),'5','image/png',100);
select public.reserve_photo((select (value->>'id')::uuid from fixtures where key='meeting'),'6','image/png',100);
select pg_temp.expect_error(format('select public.reserve_photo(%L,''7'',''image/png'',100)',(select value->>'id' from fixtures where key='meeting')),'P0001','six photo quota enforced by server');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
with deleted as (delete from public.meeting_photos where id=(select (value->>'id')::uuid from fixtures where key='photo') returning id)
  select pg_temp.assert((select count(*)=0 from deleted),'organizer cannot delete another author photo');
with deleted as (delete from storage.objects where name=(select value->>'path' from fixtures where key='photo') returning id)
  select pg_temp.assert((select count(*)=0 from deleted),'organizer cannot delete another author object');
with deleted as (delete from public.chat_messages where id=(select (value->>'id')::uuid from fixtures where key='message') returning id)
  select pg_temp.assert((select count(*)=0 from deleted),'organizer cannot delete another author message');
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select pg_temp.assert((select count(*)=0 from public.meeting_photos),'stranger cannot read photo metadata');
select pg_temp.assert((select count(*)=0 from storage.objects where bucket_id='meeting-photos'),'stranger cannot read Storage objects');
select pg_temp.expect_error(format('insert into storage.objects(bucket_id,name,metadata) values(''meeting-photos'',%L,''{"size":100,"mimetype":"image/png"}'')',(select value->>'path' from fixtures where key='photo')||'other'),'42501','unreserved Storage path denied');

-- Removing a participant revokes every subsequent private read and chat mutation.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.remove_participant((select (value->>'id')::uuid from fixtures where key='meeting'),'22222222-2222-4222-8222-222222222222');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select pg_temp.assert((select count(*)=0 from public.meetings),'removed participant loses meeting read');
select pg_temp.assert((select count(*)=0 from public.chat_messages),'removed participant loses chat read');
select pg_temp.assert((select count(*)=0 from storage.objects where bucket_id='meeting-photos'),'removed participant loses new photo read');
select pg_temp.expect_error(format('select public.send_message(%L,''removed'')',(select value->>'id' from fixtures where key='meeting')),'42501','removed participant cannot send chat');
select pg_temp.expect_error(format('select public.join_invite(%L,true)',(select value->>'token' from fixtures where key='link')),'42501','removed participant cannot reuse accepted old token');

-- Restore via a new invitation, then verify experimental scoring and reversal.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
insert into fixtures values('restore',public.create_invite((select (value->>'id')::uuid from fixtures where key='meeting'),'22222222-2222-4222-8222-222222222222'));
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select public.respond_invitation((select (value->>'id')::uuid from fixtures where key='restore'),true);
select public.set_arrival((select (value->>'id')::uuid from fixtures where key='meeting'),'arrived');
reset role;
-- The owner controls only test fixture scheduling. The client cannot backdate starts_at.
update public.meetings set starts_at=clock_timestamp()-interval '1 hour' where id=(select (value->>'id')::uuid from fixtures where key='meeting');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.complete_meeting((select (value->>'id')::uuid from fixtures where key='meeting'));
select public.complete_meeting((select (value->>'id')::uuid from fixtures where key='meeting'));
select pg_temp.assert((select count(*)=2 from public.rating_events),'completion creates one event per accepted member once');
select pg_temp.assert((select outcome='no_show' and points=-5 and confirmation='manual_unverified' from public.rating_events where user_id=auth.uid()),'no-show experimental score is server computed and unverified');
select pg_temp.assert((select outcome='late' and points=0 from public.rating_events where user_id='22222222-2222-4222-8222-222222222222'),'late score uses server arrival compared with scheduled time');
select pg_temp.assert(public.rating_summary()->>'total_score'='-5','full server aggregate excludes no rows');
select pg_temp.expect_error('update public.rating_events set points=10','42501','client cannot change score');
select pg_temp.expect_error(format('insert into public.rating_events(meeting_id,user_id,outcome,points,starts_at) values(%L,auth.uid(),''no_show'',-5,now())',(select value->>'id' from fixtures where key='meeting')),'42501','client cannot create scoring event');
select public.reverse_rating((select (value->>'id')::uuid from fixtures where key='meeting'),'11111111-1111-4111-8111-111111111111');
select public.reverse_rating((select (value->>'id')::uuid from fixtures where key='meeting'),'11111111-1111-4111-8111-111111111111');
select pg_temp.assert(public.rating_summary()->>'meeting_count'='0','reversed score excluded from aggregate');
select public.complete_meeting((select (value->>'id')::uuid from fixtures where key='meeting'));
select pg_temp.assert(public.rating_summary()->>'meeting_count'='0','repeat completion cannot restore revoked credit');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select pg_temp.expect_error(format('select public.reverse_rating(%L,auth.uid())',(select value->>'id' from fixtures where key='meeting')),'42501','participant cannot reverse own score');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.cancel_meeting((select (value->>'id')::uuid from fixtures where key='meeting'));
select pg_temp.assert((select count(*)=0 from public.rating_events where revoked_at is null),'cancellation revokes all unrevoked results');
select pg_temp.expect_error(format('select public.complete_meeting(%L)',(select value->>'id' from fixtures where key='meeting')),'P0001','cancelled meeting cannot be scored');

-- On-time outcome: a real server mark is made before the future scheduled start,
-- then only the database owner advances the test fixture's schedule to that mark.
insert into fixtures values('on_time_meeting',to_jsonb(public.create_meeting(jsonb_build_object('title','On time','place_name','Cafe',
  'starts_at',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'time_zone','UTC'))));
insert into fixtures values('on_time_arrival',to_jsonb(public.set_arrival((select (value->>'id')::uuid from fixtures where key='on_time_meeting'),'arrived')));
reset role;
update public.meetings set starts_at=(select (value->>'arrived_at')::timestamptz from fixtures where key='on_time_arrival') where id=(select (value->>'id')::uuid from fixtures where key='on_time_meeting');
set local role authenticated;
select public.complete_meeting((select (value->>'id')::uuid from fixtures where key='on_time_meeting'));
select pg_temp.assert((select outcome='on_time' and points=10 from public.rating_events where meeting_id=(select (value->>'id')::uuid from fixtures where key='on_time_meeting')),'on-time experimental score +10');
select pg_temp.assert(public.rating_summary()->>'total_score'='10','server summary includes only active scores');

reset role;
select pg_temp.expect_error(format('update storage.objects set metadata='' {"size":101,"mimetype":"image/jpeg"}'' where name=%L',(select value->>'path' from fixtures where key='photo')),'42501','final Storage superuser write still enforces reserved size');
update storage.objects set metadata=metadata||'{"uploaded":true}' where name=(select value->>'path' from fixtures where key='photo');
select pg_temp.assert((select metadata->>'uploaded'='true' from storage.objects where name=(select value->>'path' from fixtures where key='photo')),'matching administrative restore permitted for existing ready reservation');
select pg_temp.expect_error(format('insert into storage.objects(bucket_id,name,metadata) values(''meeting-photos'',%L,''{"size":100,"mimetype":"image/jpeg"}'')','11111111-1111-4111-8111-111111111111/11111111-1111-4111-8111-111111111111/'||gen_random_uuid()||'.jpg'),'42501','Storage superuser cannot create unreserved final object');
set local role authenticated;
insert into fixtures values('reclaimed_photo',public.reserve_photo((select (value->>'id')::uuid from fixtures where key='on_time_meeting'),'Reclaimed upload','image/jpeg',100));
reset role;
delete from public.meeting_photos where id=(select (value->>'id')::uuid from fixtures where key='reclaimed_photo');
select pg_temp.expect_error(format('insert into storage.objects(bucket_id,name,metadata) values(''meeting-photos'',%L,''{"size":100,"mimetype":"image/jpeg"}'')',(select value->>'path' from fixtures where key='reclaimed_photo')),'42501','final internal Storage write cannot outlive reclaimed reservation');
set local role authenticated;

insert into fixtures values('cancelled_photo',public.reserve_photo((select (value->>'id')::uuid from fixtures where key='on_time_meeting'),'Cancelled upload','image/jpeg',100));
insert into storage.objects(bucket_id,name,metadata) values('meeting-photos',(select value->>'path' from fixtures where key='cancelled_photo'),'{"size":100,"mimetype":"image/jpeg"}');
select public.cancel_meeting((select (value->>'id')::uuid from fixtures where key='on_time_meeting'));
select pg_temp.expect_error(format('select public.finish_photo(%L)',(select value->>'id' from fixtures where key='cancelled_photo')),'42501','cancellation between upload and finish blocks publication');

-- Exercise the real RPCs twenty times, rather than merely seeding rate counters.
-- The stranger now creates its own isolated fixture, after all outsider checks.
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
insert into fixtures values('abuse_meeting',to_jsonb(public.create_meeting(jsonb_build_object('title','Status anti-abuse','place_name','Cafe',
  'starts_at',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'time_zone','UTC'))));
select public.respond_attendance((select (value->>'id')::uuid from fixtures where key='abuse_meeting'),'accepted');
select pg_temp.assert((select count(*)=0 from public.attendance_events where meeting_id=(select (value->>'id')::uuid from fixtures where key='abuse_meeting')),'unchanged attendance produces no event');
do $$ declare v_meeting uuid := (select (value->>'id')::uuid from fixtures where key='abuse_meeting'); v_index integer; begin
  for v_index in 1..20 loop
    perform public.respond_attendance(v_meeting,case when v_index%2=1 then 'declined' else 'accepted' end);
  end loop;
end $$;
select pg_temp.expect_error(format('select public.respond_attendance(%L,''declined'')',(select value->>'id' from fixtures where key='abuse_meeting')),'P0001','21st attendance change within minute denied');
select pg_temp.assert((select invitation_status='accepted' from public.meeting_participants where meeting_id=(select (value->>'id')::uuid from fixtures where key='abuse_meeting') and user_id=auth.uid()),'denied attendance change preserves participant state');
select public.respond_attendance((select (value->>'id')::uuid from fixtures where key='abuse_meeting'),'accepted');
select pg_temp.assert((select count(*)=20 from public.attendance_events where meeting_id=(select (value->>'id')::uuid from fixtures where key='abuse_meeting')),'idempotent attendance retry does not consume event after cap');
do $$ declare v_meeting uuid := (select (value->>'id')::uuid from fixtures where key='abuse_meeting'); v_index integer; begin
  for v_index in 1..20 loop
    perform public.set_arrival(v_meeting,case when v_index%2=1 then 'ready' else 'pending' end);
  end loop;
end $$;
select pg_temp.expect_error(format('select public.set_arrival(%L,''arrived'')',(select value->>'id' from fixtures where key='abuse_meeting')),'P0001','21st arrival change within minute denied');
select pg_temp.assert((select arrival_status='pending' and arrived_at is null from public.meeting_participants where meeting_id=(select (value->>'id')::uuid from fixtures where key='abuse_meeting') and user_id=auth.uid()),'denied arrival change cannot create timestamp');
select public.set_arrival((select (value->>'id')::uuid from fixtures where key='abuse_meeting'),'pending');
select pg_temp.assert((select count(*)=40 from public.attendance_events where meeting_id=(select (value->>'id')::uuid from fixtures where key='abuse_meeting')),'duplicate arrival retry does not create event after cap');

-- The owner advances only this fixture's rate window; no long test sleeps are needed.
reset role;
update private.rpc_events set occurred_at=clock_timestamp()-interval '2 minutes'
  where user_id='33333333-3333-4333-8333-333333333333' and action='arrival';
set local role authenticated;
insert into fixtures values('abuse_first_arrival',to_jsonb(public.set_arrival((select (value->>'id')::uuid from fixtures where key='abuse_meeting'),'arrived')));
select pg_temp.assert((public.set_arrival((select (value->>'id')::uuid from fixtures where key='abuse_meeting'),'arrived')).arrived_at=(select (value->>'arrived_at')::timestamptz from fixtures where key='abuse_first_arrival'),'idempotent arrival retains first server timestamp after rate window');
select pg_temp.expect_error(format('select public.set_arrival(%L,''pending'')',(select value->>'id' from fixtures where key='abuse_meeting')),'P0001','first arrival cannot be reset after window');
select pg_temp.assert((select count(*)=41 from public.attendance_events where meeting_id=(select (value->>'id')::uuid from fixtures where key='abuse_meeting')),'arrival retry and forbidden reset create no duplicate events');

select 'PASS: PostgreSQL positive and negative access, invitations, Storage, arrival, quota and rating tests' as result;
rollback;
