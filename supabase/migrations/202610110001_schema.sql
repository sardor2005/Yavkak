-- Public profiles contain no email. All private changes go through checked RPCs.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  public_id text not null unique default ('yavka-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  name text not null check (length(btrim(name)) between 1 and 60),
  avatar_url text check (avatar_url is null or (length(avatar_url) <= 2000 and avatar_url ~ '^https://')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint profile_public_id check (public_id ~ '^yavka-[a-f0-9]{16}$')
);
create index profiles_name_search on public.profiles (lower(name) text_pattern_ops);

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (sender_id <> receiver_id)
);
create unique index one_pending_friend_request on public.friend_requests
  (least(sender_id, receiver_id), greatest(sender_id, receiver_id)) where status = 'pending';
create index friend_requests_receiver on public.friend_requests(receiver_id, status, created_at desc);
create index friend_requests_sender on public.friend_requests(sender_id, created_at desc);

create table public.friendships (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_a, user_b),
  check (user_a < user_b)
);
create index friendships_user_b on public.friendships(user_b);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null default '' check (length(description) <= 1000),
  place_name text not null check (length(btrim(place_name)) between 1 and 120),
  place_address text not null default '' check (length(place_address) <= 250),
  starts_at timestamptz not null,
  time_zone text not null check (length(time_zone) between 1 and 100),
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  memory_note text not null default '' check (length(memory_note) <= 2000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check ((status = 'completed') = (completed_at is not null))
);
create index meetings_organizer on public.meetings(organizer_id, starts_at desc);

create table public.meeting_participants (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  invitation_status text not null default 'accepted' check (invitation_status in ('accepted','declined')),
  arrival_status text not null default 'pending' check (arrival_status in ('pending','ready','on_way','arrived','no_show')),
  arrived_at timestamptz,
  joined_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (meeting_id,user_id),
  check ((arrival_status = 'arrived') = (arrived_at is not null)),
  check (invitation_status = 'accepted' or arrival_status = 'pending')
);
create index meeting_participants_user on public.meeting_participants(user_id,meeting_id);

create table public.meeting_invitations (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('friend','link')),
  status text not null default 'pending' check (status in ('pending','accepted','declined','revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (kind = 'link' or invitee_id is not null),
  check (invitee_id is null or inviter_id <> invitee_id),
  check (expires_at > created_at)
);
create unique index one_pending_meeting_invite on public.meeting_invitations(meeting_id,invitee_id)
  where status = 'pending' and invitee_id is not null;
create index meeting_invitations_recipient on public.meeting_invitations(invitee_id,status,created_at desc);
create index meeting_invitations_meeting on public.meeting_invitations(meeting_id,created_at desc);
-- Verifiers are never exposed by PostgREST, Realtime, or a public-table SELECT.
create table private.invitation_tokens (
  invitation_id uuid primary key references public.meeting_invitations(id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32)
);
alter table private.invitation_tokens enable row level security;

-- Rate history is independent of messages, so deleting a message cannot reset its limit.
create table private.rpc_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  occurred_at timestamptz not null default clock_timestamp()
);
create index rpc_events_window on private.rpc_events(user_id,action,occurred_at desc);
alter table private.rpc_events enable row level security;

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('accepted','declined','pending','ready','on_way','arrived','no_show','plan_reset')),
  recorded_at timestamptz not null default clock_timestamp(),
  confirmation text not null default 'manual' check (confirmation in ('manual','server'))
);
create index attendance_events_meeting on public.attendance_events(meeting_id,recorded_at);
create index attendance_events_user on public.attendance_events(user_id,recorded_at desc);

create table public.meeting_photos (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 250),
  path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 2097152),
  ready boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create index meeting_photos_meeting on public.meeting_photos(meeting_id,created_at);

create table public.rating_events (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  outcome text not null check (outcome in ('on_time','late','no_show')),
  points integer not null check (points in (10,0,-5)),
  confirmation text not null default 'manual_unverified' check (confirmation = 'manual_unverified'),
  starts_at timestamptz not null,
  arrived_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  unique (meeting_id,user_id),
  check ((outcome = 'on_time' and points = 10 and arrived_at <= starts_at)
    or (outcome = 'late' and points = 0 and arrived_at > starts_at)
    or (outcome = 'no_show' and points = -5 and arrived_at is null)),
  check (outcome = 'no_show' or arrived_at is not null)
);
create index rating_events_user on public.rating_events(user_id,created_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp()
);
create index chat_messages_history on public.chat_messages(meeting_id,created_at desc,id desc);
create index chat_messages_rate on public.chat_messages(author_id,created_at desc);

create function private.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger meetings_touch before update on public.meetings for each row execute function private.touch_updated_at();
create trigger participants_touch before update on public.meeting_participants for each row execute function private.touch_updated_at();
create trigger invitations_touch before update on public.meeting_invitations for each row execute function private.touch_updated_at();
create trigger friend_requests_touch before update on public.friend_requests for each row execute function private.touch_updated_at();

create function private.create_profile() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  v_name := left(btrim(coalesce(new.raw_user_meta_data->>'name', 'Участник')), 60);
  if v_name = '' then v_name := 'Участник'; end if;
  insert into public.profiles(id,name) values(new.id,v_name);
  return new;
end $$;
create trigger auth_user_profile after insert on auth.users for each row execute function private.create_profile();
-- Existing accounts receive profiles without copying their email into the public schema.
insert into public.profiles(id,name)
select id, coalesce(nullif(left(btrim(raw_user_meta_data->>'name'),60),''),'Участник') from auth.users
on conflict (id) do nothing;

-- These helpers bypass table RLS without recursively consulting another policy.
create function private.has_meeting_access(p_meeting_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.meeting_participants p where p.meeting_id = p_meeting_id and p.user_id = auth.uid()
  )
$$;
create function private.is_organizer(p_meeting_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.meetings m where m.id = p_meeting_id and m.organizer_id = auth.uid()
  )
$$;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_meeting_access(uuid), private.is_organizer(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.meeting_invitations enable row level security;
alter table public.attendance_events enable row level security;
alter table public.meeting_photos enable row level security;
alter table public.rating_events enable row level security;
alter table public.chat_messages enable row level security;

-- Safe directory fields only; no private contact or auth data exists in this table.
create policy profiles_directory on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy friend_requests_own on public.friend_requests for select to authenticated using (auth.uid() in (sender_id,receiver_id));
create policy friendships_own on public.friendships for select to authenticated using (auth.uid() in (user_a,user_b));
create policy meetings_members on public.meetings for select to authenticated using (private.has_meeting_access(id));
create policy participants_members on public.meeting_participants for select to authenticated using (private.has_meeting_access(meeting_id));
create policy invitations_own on public.meeting_invitations for select to authenticated using (invitee_id = auth.uid() or private.is_organizer(meeting_id));
create policy attendance_members on public.attendance_events for select to authenticated using (private.has_meeting_access(meeting_id));
create policy photos_members on public.meeting_photos for select to authenticated using (private.has_meeting_access(meeting_id) and (ready or author_id = auth.uid()));
create policy photos_delete_self on public.meeting_photos for delete to authenticated using (author_id = auth.uid() and private.has_meeting_access(meeting_id));
create policy ratings_own_or_members on public.rating_events for select to authenticated using (user_id = auth.uid() or private.has_meeting_access(meeting_id));
create policy chat_members on public.chat_messages for select to authenticated using (private.has_meeting_access(meeting_id));
create policy chat_delete_self on public.chat_messages for delete to authenticated using (author_id = auth.uid() and private.has_meeting_access(meeting_id));

-- Supabase's default grants must not allow unaudited direct writes.
revoke all on public.profiles,public.friend_requests,public.friendships,public.meetings,
  public.meeting_participants,public.meeting_invitations,public.attendance_events,
  public.meeting_photos,public.rating_events,public.chat_messages from public,anon,authenticated;
grant select on public.profiles,public.friend_requests,public.friendships,public.meetings,
  public.meeting_participants,public.meeting_invitations,public.attendance_events,
  public.meeting_photos,public.rating_events,public.chat_messages to authenticated;
grant update (name,avatar_url) on public.profiles to authenticated;
grant delete on public.chat_messages,public.meeting_photos to authenticated;
revoke all on all tables in schema private from public,anon,authenticated;
