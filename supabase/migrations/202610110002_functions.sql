-- Every exposed definer checks auth.uid(), fixes search_path and has an explicit grant.
create function private.require_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Войдите в аккаунт.' using errcode = '42501'; end if;
  return v_user;
end $$;

create function private.check_rate(p_action text,p_limit integer,p_window interval) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user();
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rate:'||p_action||':'||v_user::text,0));
  delete from private.rpc_events where user_id=v_user and occurred_at<clock_timestamp()-interval '1 day';
  if (select count(*) from private.rpc_events where user_id=v_user and action=p_action and occurred_at>clock_timestamp()-p_window)>=p_limit then
    raise exception 'Слишком много запросов. Подождите перед повторной отправкой.';
  end if;
  insert into private.rpc_events(user_id,action) values(v_user,p_action);
end $$;

create function private.validate_meeting_input(p_input jsonb) returns void
language plpgsql stable set search_path = '' as $$
declare v_key text; v_start timestamptz;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Укажите данные встречи.'; end if;
  for v_key in select jsonb_object_keys(p_input) loop
    if v_key not in ('title','description','place_name','place_address','starts_at','time_zone') then
      raise exception 'Недопустимое поле встречи: %', v_key;
    end if;
    if jsonb_typeof(p_input->v_key) is distinct from 'string' then raise exception 'Поля встречи должны быть строками.'; end if;
  end loop;
  if length(btrim(coalesce(p_input->>'title',''))) not between 1 and 120
    or length(coalesce(p_input->>'description','')) > 1000
    or length(btrim(coalesce(p_input->>'place_name',''))) not between 1 and 120
    or length(coalesce(p_input->>'place_address','')) > 250 then
    raise exception 'Проверьте название, описание и место встречи.';
  end if;
  if coalesce(p_input->>'starts_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$' then
    raise exception 'Дата встречи должна содержать часовой пояс.';
  end if;
  v_start := (p_input->>'starts_at')::timestamptz;
  if not isfinite(v_start) then raise exception 'Укажите конечную дату встречи.'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = p_input->>'time_zone') then
    raise exception 'Укажите корректный часовой пояс IANA.';
  end if;
end $$;

create function public.create_meeting(p_input jsonb) returns public.meetings
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_meeting public.meetings;
begin
  perform private.validate_meeting_input(p_input);
  if (p_input->>'starts_at')::timestamptz <= clock_timestamp() then raise exception 'Выберите время встречи в будущем.'; end if;
  perform private.check_rate('meeting',20,interval '1 day');
  insert into public.meetings(organizer_id,title,description,place_name,place_address,starts_at,time_zone)
  values(v_user,btrim(p_input->>'title'),coalesce(p_input->>'description',''),btrim(p_input->>'place_name'),
    coalesce(p_input->>'place_address',''),(p_input->>'starts_at')::timestamptz,p_input->>'time_zone') returning * into v_meeting;
  insert into public.meeting_participants(meeting_id,user_id) values(v_meeting.id,v_user);
  return v_meeting;
end $$;

create function public.update_meeting(p_meeting_id uuid,p_input jsonb) returns public.meetings
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_meeting public.meetings; v_input jsonb; v_changed boolean;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if not found or v_meeting.organizer_id <> v_user then raise exception 'Изменять встречу может только организатор.' using errcode = '42501'; end if;
  if v_meeting.status <> 'scheduled' then raise exception 'Завершённую или отменённую встречу изменять нельзя.'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Укажите изменения встречи.'; end if;
  v_input := jsonb_build_object('title',v_meeting.title,'description',v_meeting.description,'place_name',v_meeting.place_name,
    'place_address',v_meeting.place_address,'starts_at',to_char(v_meeting.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'time_zone',v_meeting.time_zone) || p_input;
  perform private.validate_meeting_input(v_input);
  if p_input ? 'starts_at' and (v_input->>'starts_at')::timestamptz <> v_meeting.starts_at
    and (v_input->>'starts_at')::timestamptz <= clock_timestamp() then raise exception 'Новое время должно быть в будущем.'; end if;
  v_changed := (v_input->>'starts_at')::timestamptz <> v_meeting.starts_at
    or (v_input->>'place_name') <> v_meeting.place_name or (v_input->>'place_address') <> v_meeting.place_address;
  update public.meetings set title=btrim(v_input->>'title'),description=v_input->>'description',place_name=btrim(v_input->>'place_name'),
    place_address=v_input->>'place_address',starts_at=(v_input->>'starts_at')::timestamptz,time_zone=v_input->>'time_zone'
    where id=p_meeting_id returning * into v_meeting;
  if v_changed then
    update public.meeting_participants set arrival_status='pending',arrived_at=null where meeting_id=p_meeting_id;
    insert into public.attendance_events(meeting_id,user_id,actor_id,event_type,confirmation)
      select p_meeting_id,user_id,v_user,'plan_reset','server' from public.meeting_participants where meeting_id=p_meeting_id;
  end if;
  return v_meeting;
end $$;

create function public.search_profiles(p_query text)
returns table(id uuid,public_id text,name text,avatar_url text)
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_query text := btrim(p_query);
begin
  if v_query is null or length(v_query) not between 2 and 60 then raise exception 'Для поиска введите от 2 до 60 символов.'; end if;
  return query select p.id,p.public_id,p.name,p.avatar_url from public.profiles p
    where p.id <> v_user and (position(lower(v_query) in lower(p.name)) > 0 or p.public_id = lower(v_query) or p.id::text = lower(v_query))
    order by p.name,p.id limit 20;
end $$;

create function public.request_friend(p_user_id uuid) returns public.friend_requests
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_request public.friend_requests;
begin
  if p_user_id is null or p_user_id = v_user then raise exception 'Нельзя добавить себя в друзья.'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'Пользователь не найден.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('friends:' || least(v_user,p_user_id)::text || greatest(v_user,p_user_id)::text,0));
  if exists(select 1 from public.friendships where user_a=least(v_user,p_user_id) and user_b=greatest(v_user,p_user_id)) then raise exception 'Вы уже друзья.'; end if;
  select * into v_request from public.friend_requests where least(sender_id,receiver_id)=least(v_user,p_user_id)
    and greatest(sender_id,receiver_id)=greatest(v_user,p_user_id) and status='pending';
  if found then
    if v_request.sender_id=v_user then return v_request; end if;
    raise exception 'У вас уже есть входящая заявка от этого пользователя.';
  end if;
  perform private.check_rate('friend',20,interval '1 hour');
  insert into public.friend_requests(sender_id,receiver_id) values(v_user,p_user_id) returning * into v_request;
  return v_request;
end $$;

create function public.respond_friend_request(p_request_id uuid,p_accept boolean) returns public.friend_requests
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_request public.friend_requests; v_status text;
begin
  if p_accept is null then raise exception 'Укажите ответ на заявку.'; end if;
  select * into v_request from public.friend_requests where id=p_request_id for update;
  if not found or v_request.receiver_id<>v_user then raise exception 'Недоступная заявка.' using errcode='42501'; end if;
  v_status := case when p_accept then 'accepted' else 'declined' end;
  if v_request.status=v_status then return v_request; end if;
  if v_request.status<>'pending' then raise exception 'На эту заявку уже ответили.'; end if;
  if p_accept then insert into public.friendships(user_a,user_b) values(least(v_request.sender_id,v_user),greatest(v_request.sender_id,v_user)) on conflict do nothing; end if;
  update public.friend_requests set status=v_status where id=p_request_id returning * into v_request;
  return v_request;
end $$;

create function public.remove_friend(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user();
begin delete from public.friendships where user_a=least(v_user,p_user_id) and user_b=greatest(v_user,p_user_id); end $$;

create function public.create_invite(p_meeting_id uuid,p_invitee_id uuid default null,p_hours integer default 72) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_meeting public.meetings; v_invite public.meeting_invitations; v_token text;
begin
  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found or v_meeting.organizer_id<>v_user then raise exception 'Приглашать может только организатор.' using errcode='42501'; end if;
  if v_meeting.status<>'scheduled' then raise exception 'Встреча уже завершена или отменена.'; end if;
  if p_hours is null or p_hours not between 1 and 168 then raise exception 'Срок приглашения: от 1 до 168 часов.'; end if;
  if p_invitee_id is not null then
    if not exists(select 1 from public.friendships where user_a=least(v_user,p_invitee_id) and user_b=greatest(v_user,p_invitee_id)) then raise exception 'Пригласить напрямую можно только друга.' using errcode='42501'; end if;
    if exists(select 1 from public.meeting_participants where meeting_id=p_meeting_id and user_id=p_invitee_id) then raise exception 'Пользователь уже участник встречи.'; end if;
    update public.meeting_invitations set status='revoked' where meeting_id=p_meeting_id and invitee_id=p_invitee_id and status='pending' and expires_at<=clock_timestamp();
    select * into v_invite from public.meeting_invitations where meeting_id=p_meeting_id and invitee_id=p_invitee_id and status='pending';
    if found then return jsonb_build_object('id',v_invite.id,'token',null,'expires_at',v_invite.expires_at); end if;
  end if;
  perform private.check_rate('invite',30,interval '1 hour');
  insert into public.meeting_invitations(meeting_id,inviter_id,invitee_id,kind,expires_at)
    values(p_meeting_id,v_user,p_invitee_id,case when p_invitee_id is null then 'link' else 'friend' end,clock_timestamp()+p_hours*interval '1 hour') returning * into v_invite;
  if p_invitee_id is null then
    v_token := encode(extensions.gen_random_bytes(32),'hex');
    insert into private.invitation_tokens(invitation_id,token_hash) values(v_invite.id,extensions.digest(v_token,'sha256'));
  end if;
  return jsonb_build_object('id',v_invite.id,'token',v_token,'expires_at',v_invite.expires_at);
end $$;

create function private.answer_invitation(p_invitation_id uuid,p_accept boolean) returns public.meeting_invitations
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_invite public.meeting_invitations; v_meeting public.meetings; v_status text;
begin
  if p_accept is null then raise exception 'Укажите ответ на приглашение.'; end if;
  -- Meeting first, invitation second: same lock order as revocation/cancellation.
  select m.* into v_meeting from public.meetings m join public.meeting_invitations i on i.meeting_id=m.id where i.id=p_invitation_id for update of m;
  select * into v_invite from public.meeting_invitations where id=p_invitation_id for update;
  if not found or (v_invite.invitee_id is not null and v_invite.invitee_id<>v_user) or v_invite.inviter_id=v_user then raise exception 'Недоступное приглашение.' using errcode='42501'; end if;
  v_status := case when p_accept then 'accepted' else 'declined' end;
  if v_invite.status=v_status and v_invite.invitee_id=v_user then return v_invite; end if;
  if v_invite.status<>'pending' or v_invite.expires_at<=clock_timestamp() or v_meeting.status<>'scheduled' then raise exception 'Приглашение недействительно или истекло.' using errcode='42501'; end if;
  if p_accept then
    if not exists(select 1 from public.meeting_participants where meeting_id=v_meeting.id and user_id=v_user)
      and (select count(*) from public.meeting_participants where meeting_id=v_meeting.id)>=8 then raise exception 'Во встрече уже 8 участников.'; end if;
    insert into public.meeting_participants(meeting_id,user_id) values(v_meeting.id,v_user) on conflict do nothing;
    insert into public.attendance_events(meeting_id,user_id,actor_id,event_type) values(v_meeting.id,v_user,v_user,'accepted');
  end if;
  update public.meeting_invitations set status=v_status,invitee_id=v_user where id=p_invitation_id returning * into v_invite;
  return v_invite;
end $$;

create function public.respond_invitation(p_invitation_id uuid,p_accept boolean) returns public.meeting_invitations
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user();
begin
  if not exists(select 1 from public.meeting_invitations where id=p_invitation_id and invitee_id=v_user and kind='friend') then raise exception 'Недоступное приглашение.' using errcode='42501'; end if;
  return private.answer_invitation(p_invitation_id,p_accept);
end $$;

create function public.join_invite(p_token text,p_accept boolean default true) returns public.meeting_invitations
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_id uuid;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Недействительное приглашение.' using errcode='42501'; end if;
  select invitation_id into v_id from private.invitation_tokens where token_hash=extensions.digest(p_token,'sha256');
  if v_id is null then raise exception 'Недействительное приглашение.' using errcode='42501'; end if;
  return private.answer_invitation(v_id,p_accept);
end $$;

create function public.revoke_invite(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_meeting uuid;
begin
  select m.id into v_meeting from public.meetings m join public.meeting_invitations i on i.meeting_id=m.id
    where i.id=p_invitation_id and m.organizer_id=v_user for update of m;
  if not found then raise exception 'Отзывать приглашения может только организатор.' using errcode='42501'; end if;
  update public.meeting_invitations set status='revoked' where id=p_invitation_id and status='pending';
end $$;

create function public.remove_participant(p_meeting_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_meeting public.meetings;
begin
  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found or v_meeting.organizer_id<>v_user then raise exception 'Удалять участников может только организатор.' using errcode='42501'; end if;
  if p_user_id=v_user then raise exception 'Организатора удалить нельзя.'; end if;
  if v_meeting.status<>'scheduled' then raise exception 'Состав завершённой встречи сохраняется.'; end if;
  update public.meeting_invitations set status='revoked' where meeting_id=p_meeting_id and invitee_id=p_user_id and status in ('pending','accepted');
  delete from public.meeting_participants where meeting_id=p_meeting_id and user_id=p_user_id;
end $$;

create function public.respond_attendance(p_meeting_id uuid,p_response text) returns public.meeting_participants
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_person public.meeting_participants; v_status text;
begin
  select status into v_status from public.meetings where id=p_meeting_id for update;
  if v_status is distinct from 'scheduled' or not private.has_meeting_access(p_meeting_id) then raise exception 'Нет доступа к активной встрече.' using errcode='42501'; end if;
  if p_response is null or p_response not in ('accepted','declined') then raise exception 'Укажите участие или отказ.'; end if;
  select * into v_person from public.meeting_participants where meeting_id=p_meeting_id and user_id=v_user for update;
  if v_person.invitation_status=p_response then return v_person; end if;
  perform private.check_rate('attendance',20,interval '1 minute');
  update public.meeting_participants set invitation_status=p_response,
    arrival_status=case when p_response='declined' then 'pending' else arrival_status end,
    arrived_at=case when p_response='declined' then null else arrived_at end
    where meeting_id=p_meeting_id and user_id=v_user returning * into v_person;
  insert into public.attendance_events(meeting_id,user_id,actor_id,event_type) values(p_meeting_id,v_user,v_user,p_response);
  return v_person;
end $$;

create function public.set_arrival(p_meeting_id uuid,p_status text) returns public.meeting_participants
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_person public.meeting_participants; v_status text;
begin
  select status into v_status from public.meetings where id=p_meeting_id for update;
  if v_status is distinct from 'scheduled' or not private.has_meeting_access(p_meeting_id) then raise exception 'Нет доступа к активной встрече.' using errcode='42501'; end if;
  if p_status is null or p_status not in ('pending','ready','on_way','arrived') then raise exception 'Недопустимый статус прибытия.'; end if;
  select * into v_person from public.meeting_participants where meeting_id=p_meeting_id and user_id=v_user for update;
  if v_person.invitation_status<>'accepted' then raise exception 'Сначала подтвердите участие.'; end if;
  if v_person.arrival_status=p_status then return v_person; end if;
  -- The first server timestamp is immutable. Clients cannot repeatedly reset an arrival.
  if v_person.arrival_status='arrived' then
    raise exception 'Отметка прибытия уже сохранена.';
  end if;
  perform private.check_rate('arrival',20,interval '1 minute');
  update public.meeting_participants set arrival_status=p_status,
    arrived_at=case when p_status='arrived' then clock_timestamp() else null end
    where meeting_id=p_meeting_id and user_id=v_user returning * into v_person;
  insert into public.attendance_events(meeting_id,user_id,actor_id,event_type) values(p_meeting_id,v_user,v_user,p_status);
  return v_person;
end $$;

create function public.complete_meeting(p_meeting_id uuid) returns public.meetings
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_meeting public.meetings;
begin
  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found or v_meeting.organizer_id<>v_user then raise exception 'Завершить встречу может только организатор.' using errcode='42501'; end if;
  if v_meeting.status='completed' then return v_meeting; end if;
  if v_meeting.status<>'scheduled' then raise exception 'Отменённую встречу завершить нельзя.'; end if;
  if v_meeting.starts_at>clock_timestamp() then raise exception 'Встречу нельзя завершить до её начала.'; end if;
  -- No historical scoring rule existed in this repository. This is a new experimental
  -- rule: +10 at/before scheduled time, 0 late, -5 no-show. All results are unverified.
  insert into public.rating_events(meeting_id,user_id,outcome,points,starts_at,arrived_at)
    select p_meeting_id,p.user_id,
      case when p.arrived_at is null then 'no_show' when p.arrived_at<=v_meeting.starts_at then 'on_time' else 'late' end,
      case when p.arrived_at is null then -5 when p.arrived_at<=v_meeting.starts_at then 10 else 0 end,
      v_meeting.starts_at,p.arrived_at
    from public.meeting_participants p where p.meeting_id=p_meeting_id and p.invitation_status='accepted'
    on conflict (meeting_id,user_id) do nothing;
  insert into public.attendance_events(meeting_id,user_id,actor_id,event_type,confirmation)
    select p_meeting_id,p.user_id,v_user,'no_show','server' from public.meeting_participants p
    where p.meeting_id=p_meeting_id and p.invitation_status='accepted' and p.arrived_at is null;
  update public.meeting_participants set arrival_status='no_show' where meeting_id=p_meeting_id and invitation_status='accepted' and arrived_at is null;
  update public.meetings set status='completed',completed_at=clock_timestamp() where id=p_meeting_id returning * into v_meeting;
  return v_meeting;
end $$;

create function public.cancel_meeting(p_meeting_id uuid) returns public.meetings
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_meeting public.meetings;
begin
  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found or v_meeting.organizer_id<>v_user then raise exception 'Отменить встречу может только организатор.' using errcode='42501'; end if;
  if v_meeting.status='cancelled' then return v_meeting; end if;
  update public.rating_events set revoked_at=clock_timestamp() where meeting_id=p_meeting_id and revoked_at is null;
  update public.meeting_invitations set status='revoked' where meeting_id=p_meeting_id and status='pending';
  update public.meetings set status='cancelled',completed_at=null where id=p_meeting_id returning * into v_meeting;
  return v_meeting;
end $$;

create function public.reverse_rating(p_meeting_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_organizer uuid;
begin
  select organizer_id into v_organizer from public.meetings where id=p_meeting_id for update;
  if v_organizer is distinct from v_user then raise exception 'Отменить результат может только организатор.' using errcode='42501'; end if;
  update public.rating_events set revoked_at=clock_timestamp() where meeting_id=p_meeting_id and user_id=p_user_id and revoked_at is null;
end $$;

create function public.send_message(p_meeting_id uuid,p_body text) returns public.chat_messages
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_message public.chat_messages; v_status text;
begin
  -- Serialize with member removal and cancellation, then serialize the sender's rate window.
  select status into v_status from public.meetings where id=p_meeting_id for update;
  if v_status is null or v_status='cancelled' then raise exception 'Чат отменённой встречи доступен только для чтения.' using errcode='42501'; end if;
  if not private.has_meeting_access(p_meeting_id) then raise exception 'Чат доступен только участникам.' using errcode='42501'; end if;
  if p_body is null or length(btrim(p_body)) not between 1 and 2000 then raise exception 'Сообщение: от 1 до 2000 символов.'; end if;
  perform private.check_rate('chat_second',1,interval '1 second');
  perform private.check_rate('chat_minute',30,interval '1 minute');
  insert into public.chat_messages(meeting_id,author_id,body) values(p_meeting_id,v_user,btrim(p_body)) returning * into v_message;
  return v_message;
end $$;

create function public.save_memory(p_meeting_id uuid,p_note text) returns public.meetings
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_meeting public.meetings;
begin
  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found or v_meeting.organizer_id<>v_user then raise exception 'Заметку меняет организатор.' using errcode='42501'; end if;
  if v_meeting.status<>'completed' then raise exception 'Заметку можно сохранить после завершения.'; end if;
  if p_note is null or length(p_note)>2000 then raise exception 'Заметка: не более 2000 символов.'; end if;
  update public.meetings set memory_note=p_note where id=p_meeting_id returning * into v_meeting;
  return v_meeting;
end $$;

create function public.rating_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_summary jsonb;
begin
  select jsonb_build_object('total_score',coalesce(sum(points),0),'meeting_count',count(*),
    'on_time',count(*) filter(where outcome='on_time'),'late',count(*) filter(where outcome='late'),
    'no_show',count(*) filter(where outcome='no_show')) into v_summary
    from public.rating_events where user_id=v_user and revoked_at is null;
  return v_summary;
end $$;

revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.has_meeting_access(uuid),private.is_organizer(uuid) to authenticated;
revoke execute on function public.create_meeting(jsonb),public.update_meeting(uuid,jsonb),public.search_profiles(text),
  public.request_friend(uuid),public.respond_friend_request(uuid,boolean),public.remove_friend(uuid),
  public.create_invite(uuid,uuid,integer),public.respond_invitation(uuid,boolean),public.join_invite(text,boolean),public.revoke_invite(uuid),
  public.remove_participant(uuid,uuid),public.respond_attendance(uuid,text),public.set_arrival(uuid,text),
  public.complete_meeting(uuid),public.cancel_meeting(uuid),public.reverse_rating(uuid,uuid),public.send_message(uuid,text),public.save_memory(uuid,text),public.rating_summary()
  from public,anon,authenticated;
grant execute on function public.create_meeting(jsonb),public.update_meeting(uuid,jsonb),public.search_profiles(text),
  public.request_friend(uuid),public.respond_friend_request(uuid,boolean),public.remove_friend(uuid),
  public.create_invite(uuid,uuid,integer),public.respond_invitation(uuid,boolean),public.join_invite(text,boolean),public.revoke_invite(uuid),
  public.remove_participant(uuid,uuid),public.respond_attendance(uuid,text),public.set_arrival(uuid,text),
  public.complete_meeting(uuid),public.cancel_meeting(uuid),public.reverse_rating(uuid,uuid),public.send_message(uuid,text),public.save_memory(uuid,text),public.rating_summary()
  to authenticated;
