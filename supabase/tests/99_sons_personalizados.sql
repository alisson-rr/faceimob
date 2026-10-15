\set ON_ERROR_STOP on
begin;
-- O Storage real já tem grants e RLS; o stub precisa habilitá-los neste teste.
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
alter table storage.objects enable row level security;
create function pg_temp.sound_ok(value boolean) returns void language plpgsql as $$
begin if not coalesce(value,false) then raise exception 'Falha em sons personalizados'; end if; end $$;

insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000028001','admin@sons.test','{"full_name":"Admin sons"}'),
 ('00000000-0000-0000-0000-000000028002','broker@sons.test','{"full_name":"Corretor sons"}'),
 ('00000000-0000-0000-0000-000000028003','partner@sons.test','{"full_name":"Sócio sons"}');
insert into public.user_roles(profile_id,role) values
 ('00000000-0000-0000-0000-000000028001','admin'),
 ('00000000-0000-0000-0000-000000028002','broker'),
 ('00000000-0000-0000-0000-000000028003','partner') on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000028001',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000028001","role":"authenticated"}',true);
insert into public.system_sounds values ('checkin','checkin/00000000-0000-0000-0000-000000028001.mp3','teste.mp3',1);
select pg_temp.sound_ok((select count(*) = 1 from public.system_sounds));
update public.system_sounds set file_name='novo.mp3' where sound_id='checkin';
insert into storage.objects(bucket_id,name) values ('system-sounds','checkin/00000000-0000-0000-0000-000000028001.mp3');
do $$ begin
  begin
    update public.system_sounds set duration=11 where sound_id='checkin';
    raise exception 'Aceitou duração inválida';
  exception when check_violation then null; end;
  begin
    update public.system_sounds set storage_path='../outro.mp3' where sound_id='checkin';
    raise exception 'Aceitou caminho inválido';
  exception when check_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000028002',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000028002","role":"authenticated"}',true);
select pg_temp.sound_ok((select file_name = 'novo.mp3' from public.system_sounds where sound_id='checkin'));
do $$ begin
  begin
    insert into public.system_sounds values ('error','error/00000000-0000-0000-0000-000000028002.mp3','erro.mp3',1);
    raise exception 'Corretor conseguiu gravar';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects(bucket_id,name) values ('system-sounds','error/00000000-0000-0000-0000-000000028002.mp3');
    raise exception 'Corretor conseguiu subir áudio';
  exception when insufficient_privilege then null; end;
end $$;
delete from storage.objects where bucket_id='system-sounds';
select pg_temp.sound_ok((select count(*)=1 from storage.objects where bucket_id='system-sounds'));
update public.system_sounds set file_name='proibido.mp3';
delete from public.system_sounds;
select pg_temp.sound_ok((select file_name = 'novo.mp3' from public.system_sounds where sound_id='checkin'));

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000028003',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000028003","role":"authenticated"}',true);
update public.system_sounds set file_name='socio.mp3' where sound_id='checkin';
select pg_temp.sound_ok((select file_name = 'socio.mp3' from public.system_sounds where sound_id='checkin'));
delete from public.system_sounds where sound_id='checkin';
select pg_temp.sound_ok((select count(*) = 0 from public.system_sounds));
insert into storage.objects(bucket_id,name) values ('system-sounds','goal/00000000-0000-0000-0000-000000028003.mp3');
delete from storage.objects where bucket_id='system-sounds';
select pg_temp.sound_ok((select count(*)=0 from storage.objects where bucket_id='system-sounds'));
reset role;
select pg_temp.sound_ok(not has_table_privilege('anon','public.system_sounds','select'));
select pg_temp.sound_ok((select file_size_limit=2097152 and public and array_length(allowed_mime_types,1)=5 from storage.buckets where id='system-sounds'));
rollback;
