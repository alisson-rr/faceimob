-- =============================================================================
-- 0034 — O lockout passa a valer também no envio do Diário (achado S05, resto)
--
-- A 0033 pôs lockout em `private.resolve_public_link`: cinco PINs errados e o
-- link fica 15 min fechado, inclusive para o PIN certo. A trava é gravada com um
-- `update` em `public_links` DENTRO do resolvedor — e é aí que estava o buraco.
--
-- PL/pgSQL não tem transação autônoma. Tudo o que a RPC faz vive na transação
-- que o PostgREST abriu para aquele POST; se a função levantar exceção, a
-- transação inteira é descartada — o `update` do contador junto. Dos três
-- chamadores do resolvedor, dois devolvem NULL na recusa (`public_daily_team` e
-- `public_director_checkpoint`) e portanto commitam o contador. O terceiro,
-- `public_daily_submit` (0009:267-269), sinalizava PIN errado com
-- `raise exception … errcode = '42501'`:
--
--   PIN errado → resolve incrementa failed_attempts → submit levanta 42501
--              → PostgREST devolve 403 e faz ROLLBACK → contador volta a zero.
--
-- Efeito prático: `POST /rest/v1/rpc/public_daily_submit` com
-- `{p_slug, p_pin, p_entries: []}` varre os 10^6 PINs sem NUNCA travar, e a
-- resposta é um oráculo perfeito (403 no errado, 200 no certo). O caminho de
-- escrita respeitava uma trava existente, mas era incapaz de disparar uma.
-- Só é explorável por quem conhece o slug — link novo tem 128 bits sorteados,
-- mas os legados têm slug derivado do nome, e renovar o PIN não troca o slug.
--
-- A correção é alinhar o terceiro chamador ao contrato dos outros dois: recusa é
-- NULL, não exceção. Com isso a transação commita e a tentativa fica contada.
--
-- Por que não dá para resolver "no lugar compartilhado" (o resolvedor): não há
-- onde. Um bloco `exception` em PL/pgSQL é um SAVEPOINT — capturar o erro
-- desfaria o incremento do mesmo jeito, porque o incremento aconteceu depois do
-- savepoint. Sem transação autônoma (dblink/pg_background não estão neste
-- projeto), a única garantia é que NENHUM chamador do resolvedor levante exceção
-- na recusa. O que fecha isso de verdade a longo prazo é o teste:
-- `supabase/tests/11_public_link_hardening.sql` bloco 6b percorre as TRÊS RPCs
-- anônimas com PIN errado e cobra que nenhuma levante e que todas contem.
--
-- ATENÇÃO — esta migration é metade de uma correção. A outra metade é
-- `src/pages/DailyReport.tsx`, que passa a tratar `data === null` como falha.
-- Aplicar só o banco é PIOR que não aplicar nada: a tela mostraria
-- "Checkpoint concluído! +XP" para um envio recusado que não gravou linha
-- nenhuma. As duas metades vão no mesmo commit.
--
-- O que NÃO muda: assinatura `(text, text, jsonb) returns jsonb`, o grant para
-- `anon`, e o corpo do lançamento (upsert do relatório e das linhas). A
-- superfície anônima continua sendo exatamente três RPCs — `tests/06` é o
-- tripwire disso.
-- =============================================================================

create or replace function public.public_daily_submit(
  p_slug    text,
  p_pin     text,
  p_entries jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_link      public.public_links;
  v_report_id uuid;
  v_entry     jsonb;
  v_count     int := 0;
begin
  v_link := private.resolve_public_link(p_slug, p_pin);

  -- Recusa é NULL, nunca exceção. Era `raise … 42501` aqui, e o rollback que
  -- ele provocava apagava a tentativa errada que o resolvedor tinha acabado de
  -- contar — o lockout nunca disparava por este caminho.
  --
  -- NULL cobre os cinco casos de recusa sem distinguir nenhum (slug inexistente,
  -- link inativo, expirado, PIN errado, travado), pela mesma razão da 0033:
  -- dizer ao atacante que ele acertou o slug e errou o PIN é entregar metade do
  -- segredo. O `kind` errado entra no mesmo balde — slug de diretoria mandado
  -- para a RPC de equipe não confirma que o slug existe.
  if v_link.id is null or v_link.kind <> 'daily_team' then
    return null;
  end if;

  insert into public.daily_reports (team_id, report_date, submitted_at)
  values (v_link.team_id, current_date, now())
  on conflict (team_id, report_date) do update set submitted_at = now()
  returning id into v_report_id;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    -- Só aceita corretor que realmente pertence à equipe deste link.
    if not exists (
      select 1 from public.team_members tm
      where tm.team_id = v_link.team_id
        and tm.profile_id = (v_entry ->> 'profile_id')::uuid
        and tm.left_at is null
    ) then
      continue;
    end if;

    insert into public.daily_entries (
      report_id, profile_id, leads, calls, doc_collections,
      visits_scheduled, visits_done, analyses_sent, analyses_approved, sales
    )
    values (
      v_report_id,
      (v_entry ->> 'profile_id')::uuid,
      coalesce((v_entry ->> 'leads')::int, 0),
      coalesce((v_entry ->> 'calls')::int, 0),
      coalesce((v_entry ->> 'doc_collections')::int, 0),
      coalesce((v_entry ->> 'visits_scheduled')::int, 0),
      coalesce((v_entry ->> 'visits_done')::int, 0),
      coalesce((v_entry ->> 'analyses_sent')::int, 0),
      coalesce((v_entry ->> 'analyses_approved')::int, 0),
      coalesce((v_entry ->> 'sales')::int, 0)
    )
    on conflict (report_id, profile_id) do update set
      leads             = excluded.leads,
      calls             = excluded.calls,
      doc_collections   = excluded.doc_collections,
      visits_scheduled  = excluded.visits_scheduled,
      visits_done       = excluded.visits_done,
      analyses_sent     = excluded.analyses_sent,
      analyses_approved = excluded.analyses_approved,
      sales             = excluded.sales;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('report_id', v_report_id, 'saved', v_count);
end;
$$;

comment on function public.public_daily_submit(text, text, jsonb) is
  'Lançamento do Diário pelo link público. Recusa devolve NULL (nunca exceção): exceção faria rollback do contador do lockout gravado por resolve_public_link.';

-- `create or replace` preserva o ACL, mas o grant vai explícito: é ele que
-- `tests/06_anon_surface.sql` cobra, e a 0019 deixou `alter default privileges`
-- revogando EXECUTE de `anon` em função nova de `public`.
grant execute on function public.public_daily_submit(text, text, jsonb) to anon, authenticated;
