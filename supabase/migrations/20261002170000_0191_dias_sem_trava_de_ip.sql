-- =============================================================================
-- 0191 — dias em que o check-in não exige IP da imobiliária
--
-- Pedido do cliente em 02/10/2026: "liberar a trava hoje, sábado e domingo",
-- marcando e desmarcando dias. Num dia marcado, `ip_is_allowed` responde sim
-- para qualquer IP; turno, atrasados e o resto da elegibilidade continuam
-- valendo. O dia é o da operação (`current_work_date()`, America/Sao_Paulo).
--
-- Quem vê e mexe é quem já vê e mexe nos IPs permitidos: leitura com
-- `menu.admin_allowed_ips`, gravação só admin e sócio (`is_admin()`).
-- =============================================================================

create table if not exists public.checkin_dias_sem_ip (
  dia        date primary key,
  criado_por uuid references public.profiles(id) on delete set null default auth.uid(),
  criado_em  timestamptz not null default now()
);

alter table public.checkin_dias_sem_ip enable row level security;
revoke all on public.checkin_dias_sem_ip from public, anon;
grant select, insert, delete on public.checkin_dias_sem_ip to authenticated;

drop policy if exists checkin_dias_sem_ip_read on public.checkin_dias_sem_ip;
create policy checkin_dias_sem_ip_read on public.checkin_dias_sem_ip
  for select to authenticated
  using ((select public.has_permission('menu.admin_allowed_ips')));

drop policy if exists checkin_dias_sem_ip_admin on public.checkin_dias_sem_ip;
create policy checkin_dias_sem_ip_admin on public.checkin_dias_sem_ip
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

comment on table public.checkin_dias_sem_ip is
  'Dias em que o check-in aceita qualquer IP (0191). Marcados em Admin → IPs permitidos.';

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
