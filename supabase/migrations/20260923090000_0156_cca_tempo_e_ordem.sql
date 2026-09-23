-- Tempo por coluna independente de edição de notas; reentrada reinicia o relógio.
-- Não inventar datas para casos antigos: até o próximo movimento a tela informa
-- o tempo na esteira, calculado de submitted_at, em vez do tempo no status.
alter table public.cca_cases add column stage_entered_at timestamptz;

create or replace function public.cca_cases_track_stage_entry()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.stage_entered_at := coalesce(new.submitted_at, now());
  elsif new.stage_id is distinct from old.stage_id
     or new.status is distinct from old.status
     or new.submitted_at is distinct from old.submitted_at then
    new.stage_entered_at := now();
  else
    new.stage_entered_at := old.stage_entered_at;
  end if;
  return new;
end;
$$;
revoke all on function public.cca_cases_track_stage_entry() from public, anon, authenticated;
create trigger cca_cases_track_stage_entry before insert or update on public.cca_cases
  for each row execute function public.cca_cases_track_stage_entry();

-- Troca atômica da ordem: uma falha não deixa metade da lista reordenada.
create or replace function public.reorder_cca_stages(p_stage_ids uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Só administrador e sócio organizam as colunas da CCA.' using errcode = '42501';
  end if;
  lock table public.cca_stages in share row exclusive mode;
  if p_stage_ids is null
     or cardinality(p_stage_ids) <> (select count(*) from public.cca_stages where active)
     or cardinality(p_stage_ids) <> (select count(distinct id) from unnest(p_stage_ids) id)
     or exists (select 1 from unnest(p_stage_ids) requested(id)
                 where not exists (select 1 from public.cca_stages s where s.id = requested.id and s.active)) then
    raise exception 'A lista de colunas mudou. Recarregue antes de reordenar.' using errcode = 'P0001';
  end if;
  update public.cca_stages s set position = ordered.pos::integer
    from unnest(p_stage_ids) with ordinality ordered(id, pos)
   where s.id = ordered.id;
end;
$$;
revoke all on function public.reorder_cca_stages(uuid[]) from public, anon;
grant execute on function public.reorder_cca_stages(uuid[]) to authenticated, service_role;
