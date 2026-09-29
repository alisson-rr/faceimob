-- =============================================================================
-- 0171 — etapa dos negócios abertos alinhada ao Status 2
--
-- Pedido do cliente em 29/09/2026: "etapa não acompanhando o status 2" (negócio
-- em "04. EM CONTRATO" parado na etapa Incompleto).
--
-- A 0164 faz a etapa seguir o Status 2 a cada TROCA de Status 2; o que já
-- estava gravado antes dela ficou onde estava, e a 0168 só realinhou setembro
-- em PROPOSTA e LEGADO. Aqui, uma vez, todo negócio ABERTO cujo Status 2 tem
-- etapa vinculada no cadastro vai para essa etapa.
--
-- Recortes, de propósito (os mesmos da 0168):
--   · só a etapa: Status 1, Status 2 e desfecho não mudam;
--   · só negócio aberto, e só para etapa aberta: levar a Fechado ou Perdido
--     mudaria o desfecho (venda nascendo, perda sumindo) sem ninguém ter mexido;
--   · sem e-mail de movimentação e sem as travas de mês fechado e de etapa (é
--     correção de cadastro, não gesto de alguém). O `deal_history` registra
--     cada troca de etapa, como sempre.
-- =============================================================================
do $$
declare
  v_linhas int;
begin
  alter table public.deals disable trigger deals_guard_closed_month;
  alter table public.deals disable trigger deals_guard_stage;
  alter table public.deals disable trigger deals_queue_status_email;

  with alvo as (
    select distinct on (d.id) d.id, s.stage_id
      from public.deals d
      join public.deal_statuses s
        on public.deal_status_bare(s.value) = public.deal_status_bare(d.status_detail)
      join public.pipeline_stages p on p.id = s.stage_id
     where d.outcome = 'open'
       and p.outcome = 'open'
     -- Mesmo desempate do gatilho `deals_ab_status_stage`: o status ativo manda.
     order by d.id, s.active desc
  )
  update public.deals d
     set stage_id         = a.stage_id,
         stage_entered_at = now()
    from alvo a
   where d.id = a.id
     and d.stage_id is distinct from a.stage_id;
  get diagnostics v_linhas = row_count;

  alter table public.deals enable trigger deals_guard_closed_month;
  alter table public.deals enable trigger deals_guard_stage;
  alter table public.deals enable trigger deals_queue_status_email;

  raise notice '0171: % negócios abertos com a etapa alinhada ao Status 2', v_linhas;
end
$$;
