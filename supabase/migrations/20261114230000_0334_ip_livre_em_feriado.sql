-- =============================================================================
-- 0334 · Check-in sem trava de IP também nos feriados (e a tela mostra o automático)
--
-- Pedido de 14/11/2026: "deixe sempre sábado e domingo com o IP liberado por
-- padrão ... feriados também temos que liberar". O fim de semana já era livre
-- desde a 0304, mas a tela "Dias sem trava de IP" só mostrava os dias marcados
-- à mão, e o admin seguia marcando sábado e domingo. Agora:
--   * `feriado_nome(dia)`: feriados nacionais (fixos + Carnaval, Sexta-feira
--     Santa e Corpus Christi pela Páscoa), 20/09 do RS e 02/02 de Porto Alegre;
--   * `ip_is_allowed` libera o feriado (desligável por
--     `automation_settings.checkin_ip_livre_feriado`, como o fim de semana);
--   * `checkin_dias_livres_automaticos(início, dias)` diz à tela quais dias já
--     estão livres sozinhos e por quê.
-- Feriado que não está na lista (ponte, municipal de outra cidade) continua
-- sendo marcado à mão.
-- =============================================================================

alter table public.automation_settings
  add column if not exists checkin_ip_livre_feriado boolean not null default true;
comment on column public.automation_settings.checkin_ip_livre_feriado is
  'Feriado (feriado_nome) o check-in não cobra o IP da loja (0334). Desligue para voltar a trava nos feriados.';

-- Domingo de Páscoa (algoritmo gregoriano anônimo, Meeus/Jones/Butcher).
create or replace function public.pascoa(p_ano int)
returns date
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  a int := p_ano % 19;
  b int := p_ano / 100;
  c int := p_ano % 100;
  d int := b / 4;
  e int := b % 4;
  f int := (b + 8) / 25;
  g int := (b - f + 1) / 3;
  h int := (19 * a + b - d - g + 15) % 30;
  i int := c / 4;
  k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7;
  m int := (a + 11 * h + 22 * l) / 451;
begin
  return make_date(p_ano, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end;
$$;

create or replace function public.feriado_nome(p_dia date)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case to_char(p_dia, 'MM-DD')
    when '01-01' then 'Confraternização Universal'
    when '02-02' then 'Nossa Senhora dos Navegantes'
    when '04-21' then 'Tiradentes'
    when '05-01' then 'Dia do Trabalho'
    when '09-07' then 'Independência'
    when '09-20' then 'Revolução Farroupilha'
    when '10-12' then 'Nossa Senhora Aparecida'
    when '11-02' then 'Finados'
    when '11-15' then 'Proclamação da República'
    when '11-20' then 'Consciência Negra'
    when '12-25' then 'Natal'
    else case p_dia - public.pascoa(extract(year from p_dia)::int)
      when -48 then 'Carnaval'
      when -47 then 'Carnaval'
      when -2  then 'Sexta-feira Santa'
      when 60  then 'Corpus Christi'
    end
  end;
$$;

-- O motivo pelo qual o dia é livre sem ninguém marcar (nulo = não é).
create or replace function public.checkin_motivo_livre_automatico(p_dia date)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.feriado_nome(p_dia) is not null
         and coalesce((select s.checkin_ip_livre_feriado from public.automation_settings s where s.id), true)
      then public.feriado_nome(p_dia)
    when extract(isodow from p_dia) in (6, 7)
         and coalesce((select s.checkin_ip_livre_fim_de_semana from public.automation_settings s where s.id), true)
      then 'Fim de semana'
  end;
$$;

create or replace function public.checkin_dias_livres_automaticos(p_inicio date, p_dias int default 7)
returns table (dia date, motivo text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d::date, public.checkin_motivo_livre_automatico(d::date)
    from generate_series(p_inicio, p_inicio + (least(greatest(p_dias, 1), 62) - 1), interval '1 day') d
   where public.checkin_motivo_livre_automatico(d::date) is not null;
$$;

revoke all on function public.pascoa(int) from public, anon;
revoke all on function public.feriado_nome(date) from public, anon;
revoke all on function public.checkin_motivo_livre_automatico(date) from public, anon;
revoke all on function public.checkin_dias_livres_automaticos(date, int) from public, anon;
grant execute on function public.pascoa(int) to authenticated, service_role;
grant execute on function public.feriado_nome(date) to authenticated, service_role;
grant execute on function public.checkin_motivo_livre_automatico(date) to authenticated, service_role;
grant execute on function public.checkin_dias_livres_automaticos(date, int) to authenticated, service_role;

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

  -- Fim de semana (0304) e feriado (0334), cada um desligável em automation_settings.
  if public.checkin_motivo_livre_automatico(public.current_work_date()) is not null then
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
