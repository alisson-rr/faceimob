-- Áudios de efeitos são públicos; configuração e escrita exigem sessão/papel.
create table public.system_sounds (
  sound_id text primary key check (sound_id in ('leadNew','leadClaimed','checkin','rankUp','sale','cashRegister','goal','success','error','birthday','premiacao')),
  storage_path text not null unique,
  file_name text not null check (length(file_name) between 1 and 255),
  duration double precision not null check (duration > 0 and duration <= 10),
  constraint system_sounds_path check (storage_path ~ ('^' || sound_id || '/[a-f0-9-]{36}\.(mp3|ogg|webm|wav)$'))
);
alter table public.system_sounds enable row level security;
revoke all on public.system_sounds from anon, authenticated;
grant select, insert, update, delete on public.system_sounds to authenticated;
create policy system_sounds_read on public.system_sounds for select to authenticated using (true);
create policy system_sounds_write on public.system_sounds for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- O harness SQL pode não ter Storage; o deploy real tem.
do $$ begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('system-sounds','system-sounds',true,2097152,array['audio/mpeg','audio/ogg','audio/webm','audio/wav','audio/x-wav']);
  execute $p$create policy system_sounds_upload on storage.objects for insert to authenticated
    with check (bucket_id = 'system-sounds' and public.is_admin()
      and name ~ '^(leadNew|leadClaimed|checkin|rankUp|sale|cashRegister|goal|success|error|birthday|premiacao)/[a-f0-9-]{36}\.(mp3|ogg|webm|wav)$')$p$;
  execute $p$create policy system_sounds_delete on storage.objects for delete to authenticated
    using (bucket_id = 'system-sounds' and public.is_admin())$p$;
  execute $p$create policy system_sounds_storage_read on storage.objects for select to authenticated
    using (bucket_id = 'system-sounds')$p$;
end $$;
