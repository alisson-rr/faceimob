-- =============================================================================
-- 0211 — cada roleta com prazo próprio, 10 minutos por padrão
--
-- Pedido do cliente em 03/10/2026, depois das queixas de "perdi o lead antes
-- dos 10 minutos": "quero que cada grupo tenha seu tempo, por padrão 10 min".
--
-- O prazo para clicar em "Atender" é o do grupo; sem valor no grupo valia o
-- geral, e o padrão de fábrica dos dois era 300 s (5 min). Agora:
--   · todo grupo passa a ter prazo próprio: o que estava vazio ou no padrão
--     antigo (300 s) vira 600 s; prazo escolhido diferente fica como está;
--   · grupo novo nasce com 600 s;
--   · o geral (fallback) sai de 300 para 600 s, se ainda estava no padrão.
-- Leads já entregues mantêm o prazo com que chegaram.
-- =============================================================================

alter table public.distribution_groups alter column attend_timeout_seconds set default 600;
update public.distribution_groups
   set attend_timeout_seconds = 600
 where attend_timeout_seconds is null or attend_timeout_seconds = 300;

alter table public.automation_settings alter column attend_timeout_seconds set default 600;
update public.automation_settings set attend_timeout_seconds = 600 where attend_timeout_seconds = 300;

create or replace function public.effective_attend_timeout(group_id uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select g.attend_timeout_seconds from public.distribution_groups g where g.id = group_id),
    (select s.attend_timeout_seconds from public.automation_settings s where s.id),
    600
  );
$$;
