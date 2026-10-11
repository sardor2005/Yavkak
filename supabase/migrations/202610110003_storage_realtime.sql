-- A reservation serializes the six-photo quota before a client can upload.
create function public.reserve_photo(p_meeting_id uuid,p_name text,p_mime text,p_size integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_meeting public.meetings; v_photo public.meeting_photos; v_extension text;
begin
  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found or not private.has_meeting_access(p_meeting_id) then raise exception 'Фото доступны только участникам.' using errcode='42501'; end if;
  if v_meeting.status='cancelled' then raise exception 'Добавлять фото отменённой встречи нельзя.'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 250 then raise exception 'Укажите название фото.'; end if;
  if p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp') then raise exception 'Поддерживаются JPEG, PNG и WebP.'; end if;
  if p_size is null or p_size not between 1 and 2097152 then raise exception 'Размер фото: от 1 байта до 2 МБ.'; end if;
  -- Only expired, never-uploaded reservations may be reclaimed. Existing objects
  -- stay counted even when a client lost its connection before finish_photo.
  delete from public.meeting_photos p where p.meeting_id=p_meeting_id and not p.ready
    and p.created_at<clock_timestamp()-interval '15 minutes'
    and not exists(select 1 from storage.objects o where o.bucket_id='meeting-photos' and o.name=p.path);
  if (select count(*) from public.meeting_photos where meeting_id=p_meeting_id)>=6 then raise exception 'Можно сохранить не более 6 фотографий встречи.'; end if;
  v_extension := case p_mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end;
  v_photo.id := gen_random_uuid();
  v_photo.path := p_meeting_id::text||'/'||v_user::text||'/'||v_photo.id::text||v_extension;
  insert into public.meeting_photos(id,meeting_id,author_id,name,path,mime_type,size_bytes)
    values(v_photo.id,p_meeting_id,v_user,btrim(p_name),v_photo.path,p_mime,p_size) returning * into v_photo;
  return jsonb_build_object('id',v_photo.id,'path',v_photo.path);
end $$;

create function public.finish_photo(p_photo_id uuid) returns public.meeting_photos
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_photo public.meeting_photos; v_status text;
begin
  select m.status into v_status from public.meetings m join public.meeting_photos p on p.meeting_id=m.id
    where p.id=p_photo_id for update of m;
  if v_status is null or v_status='cancelled' then raise exception 'Встреча недоступна или отменена.' using errcode='42501'; end if;
  select * into v_photo from public.meeting_photos where id=p_photo_id for update;
  if not found or v_photo.author_id<>v_user or not private.has_meeting_access(v_photo.meeting_id) then raise exception 'Недоступная фотография.' using errcode='42501'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='meeting-photos' and o.name=v_photo.path
    and (o.metadata->>'size')::bigint=v_photo.size_bytes and o.metadata->>'mimetype'=v_photo.mime_type) then
    raise exception 'Загрузка фото не завершена или размер и тип не совпадают.';
  end if;
  update public.meeting_photos set ready=true where id=p_photo_id returning * into v_photo;
  return v_photo;
end $$;

create function private.can_read_photo(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.meeting_photos p
    where p.path=p_path and (p.ready or p.author_id=auth.uid()) and private.has_meeting_access(p.meeting_id))
$$;
create function private.can_upload_photo(p_path text,p_metadata jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_photo public.meeting_photos; v_status text;
begin
  if auth.uid() is null then return false; end if;
  -- Same meeting-then-photo order as quota reclamation and finish_photo for the
  -- permission transaction. Storage v1.35.3 performs this probe before upload
  -- with NULL metadata; newer versions provide MIME/declared contentLength.
  select m.status into v_status from public.meetings m join public.meeting_photos p on p.meeting_id=m.id
    where p.path=p_path for update of m;
  if v_status is null or v_status='cancelled' then return false; end if;
  select * into v_photo from public.meeting_photos where path=p_path for key share;
  return found and v_photo.author_id=auth.uid() and not v_photo.ready
    and private.has_meeting_access(v_photo.meeting_id)
    and (p_metadata is null or (
      p_metadata->>'mimetype'=v_photo.mime_type
      and (p_metadata->>'size' is null or p_metadata->>'size'=v_photo.size_bytes::text)
      and (p_metadata->>'contentLength' is null or p_metadata->>'contentLength'=v_photo.size_bytes::text)
    ));
end
$$;
create function private.can_delete_photo_object(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.meeting_photos p
    where p.path=p_path and p.author_id=auth.uid() and private.has_meeting_access(p.meeting_id))
$$;
create function private.can_delete_photo_metadata(p_photo_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.meeting_photos p
    where p.id=p_photo_id and p.author_id=auth.uid() and private.has_meeting_access(p.meeting_id)
    and not exists(select 1 from storage.objects o where o.bucket_id='meeting-photos' and o.name=p.path))
$$;

-- Storage v1.35.3 rolls its caller permission probe back, then writes final
-- object metadata as its internal superuser. RLS alone therefore cannot enforce
-- the final write or prevent an upload completing after reservation reclamation.
-- This trigger also runs for that final internal write and administrative restore.
create function private.enforce_photo_object() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_photo public.meeting_photos; v_status text;
begin
  if tg_op='UPDATE' and (old.bucket_id='meeting-photos' or new.bucket_id='meeting-photos')
    and (old.bucket_id is distinct from new.bucket_id or old.name is distinct from new.name) then
    raise exception 'Перемещать фото между объектами нельзя.' using errcode='42501';
  end if;
  if new.bucket_id<>'meeting-photos' then return new; end if;
  select m.status into v_status from public.meetings m join public.meeting_photos p on p.meeting_id=m.id
    where p.path=new.name for update of m;
  select * into v_photo from public.meeting_photos where path=new.name for key share;
  if not found then raise exception 'Для объекта требуется действующая запись фотографии.' using errcode='42501'; end if;
  if v_status='cancelled' and not v_photo.ready then
    raise exception 'Загрузка отменённой встречи прекращена.' using errcode='42501';
  end if;
  if new.metadata is null then
    if v_photo.ready then raise exception 'Метаданные опубликованного фото обязательны.' using errcode='42501'; end if;
    return new; -- v1.35.3 caller permission probe; it is rolled back by Storage.
  end if;
  if jsonb_typeof(new.metadata) is distinct from 'object'
    or new.metadata->>'mimetype' is distinct from v_photo.mime_type
    or (new.metadata->>'size' is not null and new.metadata->>'size'<>v_photo.size_bytes::text)
    or (new.metadata->>'contentLength' is not null and new.metadata->>'contentLength'<>v_photo.size_bytes::text)
    or (v_photo.ready and new.metadata->>'size' is null) then
    raise exception 'Тип и размер объекта должны совпадать с фотографией.' using errcode='42501';
  end if;
  -- A newer preflight can have MIME/contentLength but no final size. Such a row
  -- cannot be published: finish_photo requires the final backend metadata.size.
  -- Existing ready rows allow an admin to restore identical size/MIME metadata,
  -- including uploaded=true, without a service-role exemption from these checks.
  return new;
end $$;
create trigger meeting_photo_object_integrity before insert or update on storage.objects
  for each row execute function private.enforce_photo_object();
revoke all on function private.enforce_photo_object() from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('meeting-photos','meeting-photos',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create policy meeting_photos_storage_read on storage.objects for select to authenticated
  using (bucket_id='meeting-photos' and private.can_read_photo(name));
create policy meeting_photos_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id='meeting-photos' and private.can_upload_photo(name,metadata));
create policy meeting_photos_storage_delete on storage.objects for delete to authenticated
  using (bucket_id='meeting-photos' and private.can_delete_photo_object(name));
-- Upload with upsert=false; no object UPDATE grant is supplied by these policies.
drop policy photos_delete_self on public.meeting_photos;
create policy photos_delete_self on public.meeting_photos for delete to authenticated
  using (private.can_delete_photo_metadata(id));

revoke all on function public.reserve_photo(uuid,text,text,integer),public.finish_photo(uuid) from public,anon,authenticated;
grant execute on function public.reserve_photo(uuid,text,text,integer),public.finish_photo(uuid) to authenticated;
revoke all on function private.can_read_photo(text),private.can_upload_photo(text,jsonb),
  private.can_delete_photo_object(text),private.can_delete_photo_metadata(uuid) from public,anon,authenticated;
grant execute on function private.can_read_photo(text),private.can_upload_photo(text,jsonb),
  private.can_delete_photo_object(text),private.can_delete_photo_metadata(uuid) to authenticated;

-- Realtime uses the same SELECT RLS policies; token hashes are deliberately excluded.
-- DELETE events expose old primary keys and cannot be row-filtered by Postgres Changes.
-- Clients therefore resync bounded views after events and after reconnecting.
do $$
declare v_table text;
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['profiles','friend_requests','friendships','meetings','meeting_participants',
      'meeting_invitations','attendance_events','meeting_photos','rating_events','chat_messages'] loop
      if not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
        execute format('alter publication supabase_realtime add table public.%I',v_table);
      end if;
    end loop;
  end if;
end $$;
