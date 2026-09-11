-- =============================================================================
-- 0113 · Importar o relatório do Gerenciador de Anúncios da Meta
--
-- O PEDIDO (cliente, 10/09/2026): "Marketing: copiar o gestão de anúncios;
-- importar relatório da meta". A gestão já existe e é local
-- (`CampaignPerformancePanel`, 0089). O que falta é o GASTO: `total_spend` é
-- digitado à mão, e `synced_at` nasceu na 0011 sem nenhum código que o
-- escrevesse — a tela diz "digitado" em toda linha porque é a verdade.
--
-- POR QUE ARQUIVO E NÃO MARKETING API. Puxar gasto da Graph API exige app
-- revisado pela Meta, token de longa duração com `ads_read` e tratamento de
-- expiração; o cofre (`private.integration_credentials`, 0105) só tem o que o
-- webhook de Lead Ads usa. O relatório exportado do Gerenciador é o mesmo
-- número, sai hoje e não depende de revisão de app. Quando o token existir, a
-- API escreve NESTA MESMA tabela e nada na tela muda.
--
-- POR QUE UMA TABELA E NÃO UMA COLUNA. `total_spend` é um número só: somar o
-- relatório de setembro nele duplicaria agosto a cada reimportação, e
-- sobrescrever apagaria agosto. O gasto de anúncio tem PERÍODO — é isso que a
-- planilha traz e que a coluna não guardava. Com o período na chave, reimportar
-- o mesmo arquivo é idempotente por construção.
--
-- REGRA DA SOBREPOSIÇÃO: o relatório novo MANDA no recorte que ele cobre.
-- Importar "01-31/08" depois de "01-15/08" apaga o recorte menor antes de
-- gravar — senão os quinze primeiros dias entrariam duas vezes no mesmo
-- `total_spend`, que é o número que divide o CPL e o ROAS. Não se soma dinheiro
-- em cima de dinheiro sem saber se o período é o mesmo.
--
-- O QUE CONTINUA DIGITADO: status, verba, período de veiculação e vínculo com
-- construtora e origem. Esta migration não fala com a Meta em momento nenhum —
-- ela recebe um arquivo que uma pessoa exportou e conferiu.
--
-- Idempotente: `if not exists` em tudo, `create or replace` nas funções,
-- `drop policy/trigger if exists` antes de criar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. O livro do gasto: uma linha por campanha e por período do relatório
-- -----------------------------------------------------------------------------
create table if not exists public.ad_campaign_spend (
  campaign_id  uuid not null references public.ad_campaigns(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  spend        numeric(14,2) not null default 0,
  -- Quem e quando: o gasto decide verba, e sem autor a correção de um número
  -- errado vira discussão sem registro.
  --
  -- `clock_timestamp()` e NAO `now()`: `now()` é o instante da TRANSAÇÃO, igual
  -- para todas as linhas dela. Como `synced_at` da campanha é o `max` desta
  -- coluna, duas importações na mesma transação gravavam o mesmo carimbo — e aí
  -- o gatilho do item 3, que reconhece a importação justamente porque o carimbo
  -- se move, via "gasto mudou e ninguém re-carimbou" e apagava a procedência do
  -- número. O relógio de parede é também o que a coluna promete: quando a linha
  -- entrou, não quando a transação começou.
  imported_at  timestamptz not null default clock_timestamp(),
  imported_by  uuid references public.profiles(id) on delete set null,
  -- Nome do arquivo exportado, como o operador o vê na pasta dele. Só rastro.
  source_file  text,

  -- A chave é a IDEMPOTÊNCIA: reimportar o mesmo arquivo reescreve a mesma
  -- linha em vez de criar uma segunda.
  primary key (campaign_id, period_start, period_end),
  constraint ad_campaign_spend_nao_negativo check (spend >= 0),
  constraint ad_campaign_spend_periodo_coerente check (period_end >= period_start)
);

-- Converge o banco que já aplicou esta migration com o default antigo: o
-- `create table if not exists` acima não revisita a coluna.
alter table public.ad_campaign_spend
  alter column imported_at set default clock_timestamp();

comment on table public.ad_campaign_spend is
  'Gasto por campanha e por PERÍODO, do relatório exportado do Gerenciador de Anúncios da Meta. ad_campaigns.total_spend é a soma desta tabela quando há importação; sem linha aqui, ele é digitado.';
comment on column public.ad_campaign_spend.period_start is
  'Início do recorte do relatório ("Início dos relatórios" na exportação da Meta).';
comment on column public.ad_campaign_spend.source_file is
  'Nome do arquivo importado. Só rastro: nada no sistema decide por ele.';

-- O período coberto fica na própria campanha para a tela não precisar de uma
-- segunda consulta só para dizer de onde veio o número — e porque o gasto
-- importado vale pelo RECORTE do relatório, não pela vida da campanha. Sem
-- isso, um relatório de agosto lido como gasto vitalício subestima o CPL.
alter table public.ad_campaigns
  add column if not exists spend_period_start date,
  add column if not exists spend_period_end   date;

comment on column public.ad_campaigns.spend_period_start is
  'Menor period_start importado para esta campanha. Nulo = total_spend digitado.';
comment on column public.ad_campaigns.spend_period_end is
  'Maior period_end importado. Com o início, é o recorte que total_spend cobre.';

-- -----------------------------------------------------------------------------
-- 2. RLS: exatamente a mesma porta de `ad_campaigns`
--
-- Leitura pela matriz (`reports.view_finance`, 0045) e escrita para admin e
-- marketing (`has_any_role`, que desde a 0099 aceita sócio quando se pede
-- 'admin'). Dinheiro de campanha não pode ganhar porta mais larga do que a
-- tabela que ele alimenta.
-- -----------------------------------------------------------------------------
alter table public.ad_campaign_spend enable row level security;

drop policy if exists ad_campaign_spend_select on public.ad_campaign_spend;
create policy ad_campaign_spend_select on public.ad_campaign_spend
  for select to authenticated
  using (public.has_permission('reports.view_finance'));

drop policy if exists ad_campaign_spend_write on public.ad_campaign_spend;
create policy ad_campaign_spend_write on public.ad_campaign_spend
  for all to authenticated
  using (public.has_any_role('admin','marketing'))
  with check (public.has_any_role('admin','marketing'));

-- -----------------------------------------------------------------------------
-- 3. Gasto mexido à mão volta a ser "digitado"
--
-- `synced_at` é o que a tela lê para dizer de onde veio o número. Depois de uma
-- importação, corrigir `total_spend` no formulário deixaria o carimbo do
-- relatório de pé sobre um valor que uma pessoa digitou — a tela afirmaria uma
-- conversa com a Meta que não houve, no número que divide o CPL e o ROAS.
--
-- A importação escreve `total_spend` e `synced_at` na MESMA update, e o carimbo
-- SEMPRE avança (`imported_at` é `clock_timestamp()`), então ela não cai aqui —
-- se aquele default voltar a ser `now()`, duas importações na mesma transação
-- voltam a cair. O formulário, que reenvia o mesmo valor quando se corrige só o
-- nome, também não cai: sem mudança no gasto, nada acontece.
-- -----------------------------------------------------------------------------
create or replace function public.ad_campaigns_marca_gasto_digitado()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.total_spend is distinct from old.total_spend
     and new.synced_at is not distinct from old.synced_at then
    new.synced_at          := null;
    new.spend_period_start := null;
    new.spend_period_end   := null;
  end if;
  return new;
end;
$$;

revoke all on function public.ad_campaigns_marca_gasto_digitado() from public, anon, authenticated;

drop trigger if exists ad_campaigns_gasto_digitado on public.ad_campaigns;
create trigger ad_campaigns_gasto_digitado
  before update on public.ad_campaigns
  for each row execute function public.ad_campaigns_marca_gasto_digitado();

-- -----------------------------------------------------------------------------
-- 4. A importação, em UMA transação
--
-- Apagar o período sobreposto e gravar o novo são dois passos que não podem
-- acontecer pela metade: entre um e outro, `total_spend` ficaria menor do que a
-- realidade e a tela mostraria um CPL que nunca existiu. Por isso é função, e
-- não duas chamadas do PostgREST.
--
-- `security invoker`: a RLS de `ad_campaign_spend` e a de `ad_campaigns`
-- continuam valendo linha a linha. A guarda explícita no topo existe só para a
-- recusa chegar como frase, e não como "0 linhas importadas" — que se leria
-- como arquivo vazio.
--
-- Recebe `[{campaign_id, period_start, period_end, spend}]`: a conciliação
-- entre linha da planilha e campanha cadastrada é da tela, que a mostra antes
-- de gravar. Aqui só entra o que já casou.
-- -----------------------------------------------------------------------------
create or replace function public.marketing_import_ad_spend(p_rows jsonb, p_source_file text default null)
returns table (linhas int, campanhas int, substituidas int)
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  r           record;
  v_linhas    int := 0;
  v_troca     int := 0;
  v_removidas int;
  v_campanhas int := 0;
begin
  if not public.has_any_role('admin','marketing') then
    raise exception 'Sem permissão para importar gasto de campanha (apenas admin, sócio e marketing).'
      using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'O relatório precisa chegar como lista de linhas.' using errcode = '22023';
  end if;

  for r in
    select (x->>'campaign_id')::uuid        as campaign_id,
           (x->>'period_start')::date       as period_start,
           (x->>'period_end')::date         as period_end,
           round((x->>'spend')::numeric, 2) as spend
    from jsonb_array_elements(p_rows) as x
  loop
    -- Nulo aqui viraria linha sem período ou sem valor, e a conta seguiria como
    -- se o gasto fosse zero.
    if r.campaign_id is null or r.period_start is null or r.period_end is null or r.spend is null then
      raise exception 'Linha do relatório incompleta: campanha, período e gasto são obrigatórios.'
        using errcode = '22023';
    end if;

    -- O recorte novo manda: apaga o que se sobrepõe antes de gravar, senão o
    -- mesmo dia entra duas vezes na soma.
    delete from public.ad_campaign_spend s
     where s.campaign_id  = r.campaign_id
       and s.period_start <= r.period_end
       and s.period_end   >= r.period_start;
    get diagnostics v_removidas = row_count;
    v_troca := v_troca + v_removidas;

    insert into public.ad_campaign_spend
      (campaign_id, period_start, period_end, spend, imported_by, source_file)
    values
      (r.campaign_id, r.period_start, r.period_end, r.spend, auth.uid(), nullif(btrim(p_source_file), ''));
    v_linhas := v_linhas + 1;
  end loop;

  -- `total_spend` passa a ser a SOMA do livro, e o carimbo diz que o número veio
  -- de relatório. As duas colunas na mesma update, de propósito: é o que desvia
  -- do gatilho do item 3.
  update public.ad_campaigns c
     set total_spend        = coalesce(s.soma, 0),
         synced_at          = s.ultimo,
         spend_period_start = s.inicio,
         spend_period_end   = s.fim
    from (
      select campaign_id,
             sum(spend)        as soma,
             max(imported_at)  as ultimo,
             min(period_start) as inicio,
             max(period_end)   as fim
        from public.ad_campaign_spend
       group by campaign_id
    ) s
   where s.campaign_id = c.id
     and c.id in (select distinct (x->>'campaign_id')::uuid from jsonb_array_elements(p_rows) as x);
  get diagnostics v_campanhas = row_count;

  return query select v_linhas, v_campanhas, v_troca;
end;
$$;

comment on function public.marketing_import_ad_spend(jsonb, text) is
  'Grava o gasto do relatório da Meta por campanha e período, em uma transação. Reimportar o mesmo arquivo não duplica (chave campanha+período) e um recorte sobreposto substitui o anterior. Escreve total_spend, synced_at e o período coberto em ad_campaigns.';

revoke all on function public.marketing_import_ad_spend(jsonb, text) from public, anon;
grant execute on function public.marketing_import_ad_spend(jsonb, text) to authenticated;
