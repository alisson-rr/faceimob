-- =============================================================================
-- 0217 — o e-mail de movimentação leva o último comentário do negócio
--
-- Reclamação de 04/10/2026: "os e-mails estão vindo sem o último comentário,
-- é importante conter". O aviso só trazia a observação escrita NA troca. Agora
-- `email_detalhes_do_negocio` devolve também o último comentário do histórico
-- (texto, autor e quando), e o e-mail mostra os dois.
-- =============================================================================

create or replace function public.email_detalhes_do_negocio(p_deal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with d as (select * from public.deals where id = p_deal_id),
  gente as (
    select dp.role, pr.full_name,
           row_number() over (partition by dp.role order by dp.ordinal, dp.created_at, dp.id) as n
      from public.deal_participants dp
      join public.profiles pr on pr.id = dp.profile_id
     where dp.deal_id = p_deal_id and dp.role in ('broker', 'manager')
  ),
  ultimo as (
    select h.to_value, h.actor_id, h.created_at
      from public.deal_history h
     where h.deal_id = p_deal_id and h.kind = 'comment'
     order by h.created_at desc, h.id desc
     limit 1
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'codigo', d.code,
    'cliente', (select full_name from public.deal_clients where deal_id = d.id order by ordinal limit 1),
    'cpf', (select cpf from public.deal_clients where deal_id = d.id order by ordinal limit 1),
    'empreendimento', coalesce(nullif(btrim(d.project_name), ''),
                               (select name from public.developer_projects where id = d.project_id)),
    'construtora', (select name from public.developers where id = d.developer_id),
    'status1', (select label from public.deal_status_groups where id = d.status_group_id),
    'status2', coalesce((select label from public.deal_statuses where value = d.status_detail),
                        public.deal_status_bare(d.status_detail)),
    'status2_tom', (select tone from public.deal_statuses where value = d.status_detail),
    'corretor1', (select full_name from gente where role = 'broker' and n = 1),
    'corretor2', (select full_name from gente where role = 'broker' and n = 2),
    'gerente1', (select full_name from gente where role = 'manager' and n = 1),
    'gerente2', (select full_name from gente where role = 'manager' and n = 2),
    'quando', to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI'),
    -- 0217: o último comentário do negócio, com autor e data.
    'ultimo_comentario', (select nullif(btrim(h.to_value), '') from ultimo h),
    'ultimo_comentario_autor', (select pr.full_name from ultimo h join public.profiles pr on pr.id = h.actor_id),
    'ultimo_comentario_quando', (select to_char(h.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI') from ultimo h)
  ))
  from d;
$$;

revoke all on function public.email_detalhes_do_negocio(uuid) from public, anon, authenticated;
grant execute on function public.email_detalhes_do_negocio(uuid) to service_role;

comment on function public.email_detalhes_do_negocio(uuid) is
  'Dados do negócio para o e-mail de movimentação (cliente, CPF, empreendimento, corretores, gerentes, status e o último comentário — 0217). Só service_role e gatilhos.';
