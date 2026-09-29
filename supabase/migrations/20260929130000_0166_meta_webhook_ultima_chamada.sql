-- =============================================================================
-- 0166 — a última chamada da Meta ao webhook de leads
--
-- Pedido de 29/09/2026: "preciso ver por que os leads da Meta não estão
-- chegando, já que inseri todas as chaves e tirei a pausa". O webhook recusava
-- (401 por assinatura, 403 na verificação) e ignorava (pausa, evento sem lead)
-- sem deixar rastro que a tela lesse: não havia como separar "a Meta não chama"
-- de "a Meta chama e nós recusamos".
--
-- Duas colunas no singleton de automação, gravadas pelo `meta-ads-webhook` com
-- a chave de serviço e lidas pelo diagnóstico de /admin/meta-ads. Guardam SÓ a
-- hora e um código curto do resultado — nada do corpo, nenhum dado do lead.
-- =============================================================================
alter table public.automation_settings
  add column if not exists meta_webhook_last_at timestamptz,
  add column if not exists meta_webhook_last_result text
    check (meta_webhook_last_result is null or meta_webhook_last_result in (
      'verificacao_ok', 'verificacao_recusada', 'sem_app_secret', 'assinatura_invalida',
      'pausado', 'sem_lead', 'aceito', 'falha'
    ));

comment on column public.automation_settings.meta_webhook_last_at is
  'Hora da última chamada ao meta-ads-webhook (0166). Gravada pela edge function; diagnóstico em /admin/meta-ads.';
comment on column public.automation_settings.meta_webhook_last_result is
  'Resultado curto da última chamada ao meta-ads-webhook (0166): verificação, assinatura, pausa, sem lead ou aceito.';
