-- =============================================================================
-- 0165 — realinhar Status 1 e etapa dos negócios de setembro/2026 pelo Status 2
--
-- Pedido do cliente em 29/09/2026: "aplicar o que é proposta e o que é legado
-- em setembro para vermos como ficam as métricas nesse novo parâmetro; não
-- alteramos o Status 2, apenas atribuímos Status 1 e etapa a cada um existente".
--
-- A 0164 fez a etapa seguir o Status 2 só a partir da próxima troca. Aqui, uma
-- vez, os negócios de mês-base setembro/2026 cujo Status 2 é do grupo PROPOSTA
-- ou LEGADO ganham:
--   · Status 1 = o grupo do Status 2 (desfaz troca manual antiga);
--   · etapa    = a etapa vinculada ao Status 2 no cadastro (0164), quando há.
--
-- Recortes, de propósito:
--   · só negócio ABERTO (`outcome = 'open'`): as etapas de PROPOSTA e LEGADO são
--     abertas, e realinhar um ganho ou perdido o reabriria — venda sumindo e
--     perda voltando ao funil sem ninguém ter mexido;
--   · o Status 2 não muda, nem o desfecho;
--   · sem e-mail de movimentação (seriam centenas de avisos de uma correção) e
--     sem a trava de mês fechado e de etapa (é correção de cadastro, não gesto
--     de alguém). O `deal_history` registra cada troca de etapa, como sempre.
-- =============================================================================
do $$
declare
  v_linhas int;
begin
  alter table public.deals disable trigger deals_guard_closed_month;
  alter table public.deals disable trigger deals_guard_stage;
  alter table public.deals disable trigger deals_queue_status_email;

  with alvo as (
    select d.id, s.group_id, s.stage_id
      from public.deals d
      join public.deal_statuses s
        on public.deal_status_bare(s.value) = public.deal_status_bare(d.status_detail)
      join public.deal_status_groups g on g.id = s.group_id
     where g.code in ('PROPOSTA', 'LEGADO')
       and d.month_base = date '2026-09-01'
       and d.outcome = 'open'
  )
  update public.deals d
     set status_group_id  = a.group_id,
         stage_id         = coalesce(a.stage_id, d.stage_id),
         stage_entered_at = case when a.stage_id is not null and a.stage_id is distinct from d.stage_id
                                 then now() else d.stage_entered_at end
    from alvo a
   where d.id = a.id
     and (d.status_group_id is distinct from a.group_id
          or (a.stage_id is not null and a.stage_id is distinct from d.stage_id));
  get diagnostics v_linhas = row_count;

  alter table public.deals enable trigger deals_guard_closed_month;
  alter table public.deals enable trigger deals_guard_stage;
  alter table public.deals enable trigger deals_queue_status_email;

  raise notice '0165: % negócios de setembro/2026 realinhados pelo Status 2', v_linhas;
end
$$;
