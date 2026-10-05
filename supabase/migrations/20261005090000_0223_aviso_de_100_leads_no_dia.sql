-- =============================================================================
-- 0223 — aviso quando o dia chega a 100 leads
--
-- Pedido de 05/10/2026: "me mande um aviso de quando chegarmos a 100 leads",
-- contando por dia (horário de Brasília), para admin e sócios. Um aviso por
-- dia: o lead que faz o dia passar de 99 dispara; os seguintes não repetem.
--
-- A trava (advisory lock) só entra a partir do 100º lead e serializa quem
-- confere se o aviso de hoje já saiu: sem ela, dois leads chegando juntos
-- podiam avisar duas vezes. Falhar no aviso nunca impede o lead de entrar.
-- =============================================================================

create or replace function public.leads_avisa_marca_do_dia()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_marca  constant int := 100;
  v_inicio timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_total  int;
begin
  select count(*) into v_total from public.leads where created_at >= v_inicio;
  if v_total < v_marca then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext('leads_avisa_marca_do_dia'));
  if exists (select 1 from public.notifications
              where kind = 'lead_marca_do_dia' and created_at >= v_inicio) then
    return null;
  end if;

  insert into public.notifications (profile_id, kind, title, body, link)
  select distinct p.id,
         'lead_marca_do_dia',
         format('Chegamos a %s leads hoje!', v_marca),
         format('O dia %s bateu %s leads no CRM.',
                to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM'), v_total),
         '/leads'
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id
   where ur.role in ('admin', 'partner')
     and p.status = 'active';

  return null;
exception when others then
  raise warning 'leads_avisa_marca_do_dia: aviso não saiu: %', sqlerrm;
  return null;
end;
$$;

revoke all on function public.leads_avisa_marca_do_dia() from public, anon, authenticated;

drop trigger if exists leads_avisa_marca_do_dia on public.leads;
create trigger leads_avisa_marca_do_dia
  after insert on public.leads
  for each row execute function public.leads_avisa_marca_do_dia();

comment on function public.leads_avisa_marca_do_dia() is
  'Avisa admin e sócios, uma vez por dia (horário de Brasília), quando os leads do dia chegam a 100 (0223).';
