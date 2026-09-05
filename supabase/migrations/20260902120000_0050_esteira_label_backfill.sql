-- =============================================================================
-- 0050 · Retroalimenta o rótulo de esteira nos casos que já estavam no CCA
--
-- A 0037 fez `deals.status_detail` receber "13. ESTEIRA AGIL" pelo trigger
-- `cca_cases_sync_esteira_label`, que dispara na TRANSIÇÃO do caso para
-- `under_review`. Quem já estava lá antes da 0037 nunca transicionou — e
-- continuou sem rótulo nenhum. Medido na homologação depois de aplicar a 0037:
-- 3 casos em `under_review`, 0 negócios rotulados.
--
-- O efeito visível era o oposto do que a 0037 quis dizer: a tela deixou de
-- permitir marcar "foi à esteira" à mão, mas também não mostrava quem tinha ido
-- de verdade. Rotular pelo estado real do caso é o que fecha o par.
--
-- Idempotente: o `where` já exclui quem tem o rótulo certo, e o rótulo de
-- encerramento continua tendo precedência — a mesma regra do trigger, para não
-- existirem duas verdades sobre quando o rótulo pode ser sobrescrito.
-- =============================================================================

update public.deals d
   set status_detail = '13. ESTEIRA AGIL'
  from public.cca_cases c
 where c.deal_id = d.id
   and c.status = 'under_review'
   and d.status_detail is distinct from '13. ESTEIRA AGIL'
   and public.deal_status_bare(d.status_detail) not in ('DISTRATO', 'QUEDA', 'REPROVADO', 'OFF');

update public.deals d
   set status_detail = 'RET. ESTEIRA AGIL'
  from public.cca_cases c
 where c.deal_id = d.id
   and c.status = 'pending_documents'
   and d.status_detail is distinct from 'RET. ESTEIRA AGIL'
   and public.deal_status_bare(d.status_detail) not in ('DISTRATO', 'QUEDA', 'REPROVADO', 'OFF');
