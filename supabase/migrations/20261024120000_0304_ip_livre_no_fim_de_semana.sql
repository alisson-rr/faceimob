-- =============================================================================
-- 0304 · Check-in sem trava de IP no sábado e no domingo
--
-- Pedido de 24/10/2026: "deixe o IP desbloqueado por padrão no sábado e
-- domingo". Soma-se aos dias marcados um a um (0191): no fim de semana, pelo
-- dia operacional de São Paulo (`current_work_date`), qualquer IP passa.
-- `automation_settings.checkin_ip_livre_fim_de_semana` (ligado por padrão)
-- desliga a regra sem deploy, se um fim de semana pedir a trava.
-- =============================================================================

alter table public.automation_settings
  add column if not exists checkin_ip_livre_fim_de_semana boolean not null default true;

comment on column public.automation_settings.checkin_ip_livre_fim_de_semana is
  'Sábado e domingo o check-in não cobra o IP da loja (0304). Desligue para voltar a trava no fim de semana.';

create or replace function public.ip_is_allowed(candidate inet, who uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.can_probe_profile(who) then
    raise exception 'Sem permissão para consultar a cobertura de IP deste perfil.'
      using errcode = '42501';
  end if;

  -- Dia liberado (0191): a trava de IP não vale hoje para ninguém.
  if exists (select 1 from public.checkin_dias_sem_ip d where d.dia = public.current_work_date()) then
    return true;
  end if;

  -- Fim de semana (0304): sábado e domingo liberados, salvo se desligado.
  if extract(isodow from public.current_work_date()) in (6, 7)
     and coalesce((select s.checkin_ip_livre_fim_de_semana from public.automation_settings s where s.id), true) then
    return true;
  end if;

  -- `<<=` (contido OU igual) desde a 0024: com `<<` um /32 nunca liberava.
  return coalesce((select p.bypass_ip_check from public.profiles p where p.id = who), false)
    or exists (
      select 1
      from public.allowed_ips a
      where a.active
        and candidate <<= a.ip_range
        and (
          a.team_id is null
          or a.team_id in (
            select tm.team_id from public.team_members tm
            where tm.profile_id = who and tm.left_at is null
          )
        )
    );
end;
$$;
