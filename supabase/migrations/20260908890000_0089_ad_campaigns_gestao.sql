-- =============================================================================
-- 0089 · O que a gestão de campanha precisa guardar além do gasto
--
-- A ata pede gerenciar campanha (verba, pausar, copiar) e a tabela só tinha
-- `daily_budget` e `total_spend`. Faltavam três coisas que a operação usa todo
-- mês e que hoje moram em planilha:
--
--   * `lifetime_budget` — a verba CONTRATADA da campanha. `total_spend` é o
--     gasto REALIZADO; os dois juntos respondem "quanto ainda posso gastar",
--     que é a pergunta que faz alguém pausar. Um campo só não responde.
--   * `starts_on` / `ends_on` — o período de veiculação. Sem ele, campanha
--     encerrada continua indistinguível de campanha ativa que não gastou.
--   * `lead_source_id` — a origem de lead que a campanha alimenta. É o vínculo
--     que liga a verba ao caminho do lead (`lead_sources` escolhe o agente de
--     SDR e a roleta), e sem ele o operador tem de guardar esse par de cabeça.
--
-- O que esta migration NÃO faz: nada aqui sincroniza com a Meta. Todas as
-- colunas continuam DIGITADAS — `synced_at` segue nulo porque nenhum código o
-- escreve. Apertar o CHECK de `status` para exatamente ('ACTIVE','PAUSED')
-- ficou de fora de propósito: a Graph API também devolve ARCHIVED, IN_PROCESS e
-- WITH_ISSUES, e travar o banco nos dois estados que a tela oferece hoje faria
-- a primeira sincronização real ser recusada pelo próprio banco. A recusa com
-- frase legível vive na fronteira do app (`problemaNaCampanha`, analytics.ts),
-- onde dá para dizer o que corrigir; o CHECK de 0084 (maiúscula) continua.
--
-- Idempotente: `add column if not exists` e constraint criada por `pg_constraint`.
-- =============================================================================

alter table public.ad_campaigns
  add column if not exists lifetime_budget numeric(14,2),
  add column if not exists starts_on       date,
  add column if not exists ends_on         date,
  add column if not exists lead_source_id  uuid references public.lead_sources(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ad_campaigns_lifetime_budget_not_negative') then
    alter table public.ad_campaigns
      add constraint ad_campaigns_lifetime_budget_not_negative
      check (lifetime_budget is null or lifetime_budget >= 0);
  end if;

  -- Período invertido não é opinião de tela: 01/09 a 01/08 é dado impossível e
  -- o banco é o único lugar que vale para todo caminho de escrita.
  if not exists (select 1 from pg_constraint where conname = 'ad_campaigns_periodo_coerente') then
    alter table public.ad_campaigns
      add constraint ad_campaigns_periodo_coerente
      check (starts_on is null or ends_on is null or ends_on >= starts_on);
  end if;
end
$$;

comment on column public.ad_campaigns.lifetime_budget is
  'Verba total CONTRATADA da campanha, digitada. Não confundir com total_spend, que é o gasto realizado.';
comment on column public.ad_campaigns.starts_on is
  'Início da veiculação, digitado. Nenhum código sincroniza com a Meta.';
comment on column public.ad_campaigns.ends_on is
  'Fim da veiculação, digitado. Nulo = sem data de encerramento definida.';
comment on column public.ad_campaigns.lead_source_id is
  'Origem de lead que esta campanha alimenta (lead_sources escolhe agente de SDR e roleta). Vínculo declarado à mão.';
