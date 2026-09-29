-- =============================================================================
-- 0162 — check-in externo feito pelo diretor (pedido do cliente em 29/09/2026)
--
-- "Diretor quer ter a possibilidade de fazer check-in sem IP para corretores
-- que estão de plantão; seria bom ele justificar e registrar o motivo."
--
-- O ponto continua sendo `perform_checkin` (IP da loja, 0020/0057/0075). Esta é
-- a única exceção, e ela fica no dado:
--
--   · só admin ou diretor, e só para quem ele enxerga (`can_probe_profile`, o
--     mesmo recorte de `checkin_eligibility`);
--   · motivo obrigatório (5 a 500 caracteres), gravado na linha junto de quem
--     liberou (`external_by`) — o ponto externo é distinguível do real sem
--     depender de `ip_address is null`, que também marca correção de admin;
--   · o resto da regra vale igual: janela de turno aberta e
--     `checkin_eligibility` (perfil ativo, leads atrasados). O diretor passa por
--     cima do IP, não do bloqueio por atraso.
--
-- A escrita direta em `checkins` segue só do admin (0075): o diretor não ganha
-- policy nova, ganha uma RPC que valida tudo acima.
-- =============================================================================

alter table public.checkins
  add column if not exists external_reason text,
  add column if not exists external_by uuid references public.profiles(id) on delete set null;

alter table public.checkins drop constraint if exists checkins_external_reason_len;
alter table public.checkins
  add constraint checkins_external_reason_len
  check (external_reason is null or char_length(btrim(external_reason)) between 5 and 500);

comment on column public.checkins.external_reason is
  'Motivo do check-in externo (sem IP), feito por diretor ou admin via director_external_checkin (0162). Nulo = ponto normal.';
comment on column public.checkins.external_by is
  'Quem fez o check-in externo (0162). Nulo = o próprio corretor pelo perform_checkin.';

create or replace function public.director_external_checkin(p_profile uuid, p_reason text)
returns public.checkins
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_who    uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_shift  uuid;
  v_ok     boolean;
  v_why    text;
  v_row    public.checkins;
begin
  if v_who is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if not (public.is_admin() or public.has_any_role('director')) then
    raise exception 'Só diretor ou administrador faz check-in externo.' using errcode = '42501';
  end if;

  if p_profile is null or not public.can_probe_profile(p_profile) then
    raise exception 'Este corretor está fora da sua equipe.' using errcode = '42501';
  end if;

  if char_length(v_reason) < 5 then
    raise exception 'Escreva o motivo do check-in externo (ex.: plantão no estande).' using errcode = 'P0001';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'O motivo passou de 500 caracteres.' using errcode = 'P0001';
  end if;

  v_shift := public.current_shift();
  if v_shift is null then
    raise exception 'Fora da janela de check-in.' using errcode = 'P0001';
  end if;

  select e.allowed, e.reason into v_ok, v_why
  from public.checkin_eligibility(p_profile) e;
  if not v_ok then
    raise exception '%', v_why using errcode = 'P0001';
  end if;

  insert into public.checkins (profile_id, shift_id, work_date, ip_address, external_reason, external_by)
  values (p_profile, v_shift, public.current_work_date(), null, v_reason, v_who)
  on conflict (profile_id, work_date, shift_id) do update
    set checked_out_at  = null,
        auto_checkout   = false,
        external_reason = excluded.external_reason,
        external_by     = excluded.external_by
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.director_external_checkin(uuid, text) is
  'Check-in sem IP feito por diretor/admin para corretor da equipe (plantão). Motivo obrigatório, gravado em checkins.external_reason/external_by (0162).';

revoke all on function public.director_external_checkin(uuid, text) from public, anon;
grant execute on function public.director_external_checkin(uuid, text) to authenticated, service_role;
