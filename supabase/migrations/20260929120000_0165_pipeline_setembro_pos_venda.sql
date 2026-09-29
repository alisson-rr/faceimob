-- 0159 · Consolida os vínculos do Pipeline pedidos para as propostas de 09/2026.
--
-- Status 2 já aponta para Status 1 pelo catálogo `deal_statuses`, mas negócios
-- importados ou corrigidos antes desse catálogo podiam conservar o grupo antigo.
-- A etapa continua sendo a etapa escolhida no próprio negócio; o desfecho passa
-- a ser sempre o definido pela etapa. Assim uma etapa cadastrada como Pós-venda
-- é venda em todas as contagens que usam `deals.outcome`.

-- Pós-venda é uma continuação operacional da venda, não uma proposta aberta.
-- Aceita tanto código quanto rótulo para respeitar o nome cadastrado no app.
update public.pipeline_stages
   set outcome = 'won'
 where upper(translate(coalesce(code, '') || ' ' || coalesce(label, ''),
                       'ÁÀÃÂÉÊÍÓÔÕÚÜÇ', 'AAAAEEIOOOUUC'))
       like '%POS%VENDA%'
   and outcome is distinct from 'won';

-- Reaplica em todas as propostas do mês (não apenas nas que estavam nulas):
-- Status 2 → Status 1 do catálogo e Etapa → desfecho da etapa cadastrada.
update public.deals d
   set status_group_id = public.deal_status_group_for(d.status_detail, s.outcome, d.lost_reason),
       outcome         = s.outcome
  from public.pipeline_stages s
 where s.id = d.stage_id
   and d.month_base = date '2026-09-01'
   and (
     d.status_group_id is distinct from
       public.deal_status_group_for(d.status_detail, s.outcome, d.lost_reason)
     or d.outcome is distinct from s.outcome
   );

comment on column public.deals.status_group_id is
  'Status 1 do negócio. O Status 2 selecionado resolve o grupo pelo catálogo; propostas de 09/2026 foram reconciliadas na 0159.';
