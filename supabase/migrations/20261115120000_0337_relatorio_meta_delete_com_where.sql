-- =============================================================================
-- 0337 · Relatório da Meta: o clique em "Receber relatório" voltava com erro
--
-- 15/11/2026: o modelo das 08:30 saiu, mas o clique registrou
-- relatorio_falhou "DELETE requires a WHERE clause". A edge chama
-- meta_relatorio_whatsapp_texto() pelo PostgREST, onde o pg_safeupdate recusa
-- DELETE sem WHERE — inclusive na tabela temporária. O banco de teste não
-- carrega o safeupdate, por isso a 0336 passou nos asserts.
-- Única mudança em relação à 0336: `delete ... where true`.
-- =============================================================================

create or replace function public.meta_relatorio_whatsapp_texto()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoje      date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ontem     date := v_hoje - 1;
  v_contas    uuid[];
  v_limite    numeric;
  v_claims    text;
  v_saldo     numeric;
  v_ativas    int;
  v_orcamento numeric;
  v_gasto     numeric;
  v_cad       int;
  v_cad_gasto numeric;
  v_conv      int;
  v_conv_gasto numeric;
  v_melhores  text;
  v_acima     text;
  v_n_acima   int;
  v_sem       text;
  v_n_sem     int;
  v_gestor    jsonb;
  v_ia        text;
begin
  select array_agg(a.id), max(a.cpl_limite) into v_contas, v_limite
    from public.meta_ad_accounts a where a.enabled;
  if v_contas is null then
    return 'Nenhuma conta de anúncios ligada ao CRM.';
  end if;
  v_limite := coalesce(v_limite, 20);

  select sum(a.prepay_available) filter (where a.is_prepay) into v_saldo
    from public.meta_ad_accounts a where a.id = any (v_contas);
  select count(*)::int, coalesce(sum(c.daily_budget), 0) into v_ativas, v_orcamento
    from public.ad_campaigns c
   where c.meta_account_id = any (v_contas) and c.status = 'ACTIVE';

  -- `meta_metricas` cobra reports.view_finance ou service_role; o cron não tem JWT.
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  create temporary table if not exists pg_temp.rel336 on commit drop as
    select * from public.meta_metricas(v_ontem, v_ontem) where false;
  delete from pg_temp.rel336 where true;  -- 0337: pg_safeupdate recusa DELETE sem WHERE
  insert into pg_temp.rel336
    select * from public.meta_metricas(v_ontem, v_ontem) m where m.account_id = any (v_contas);

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  select coalesce(sum(spend), 0),
         coalesce(sum(leads_form + lp_leads), 0)::int,
         coalesce(sum(spend) filter (where channel in ('formulario', 'landing_page')), 0),
         coalesce(sum(conversations), 0)::int,
         coalesce(sum(spend) filter (where channel = 'whatsapp'), 0)
    into v_gasto, v_cad, v_cad_gasto, v_conv, v_conv_gasto
    from pg_temp.rel336;

  select string_agg(format('* %s — custo por resultado %s (%s %s)', name, public.meta_brl(custo_por_resultado),
                           resultados, case when channel = 'whatsapp' then 'conversas' else 'leads' end), E'\n')
    into v_melhores
    from (select * from pg_temp.rel336 where resultados > 0 and custo_por_resultado is not null
           order by custo_por_resultado, spend desc limit 5) x;

  select count(*)::int into v_n_acima from pg_temp.rel336 where custo_por_resultado > v_limite;
  select string_agg(format('* %s — %s', name, public.meta_brl(custo_por_resultado)), E'\n') into v_acima
    from (select * from pg_temp.rel336 where custo_por_resultado > v_limite
           order by custo_por_resultado desc limit 5) x;

  select count(*)::int into v_n_sem from pg_temp.rel336 where spend > 0 and coalesce(resultados, 0) = 0;
  select string_agg(format('* %s — %s', name, public.meta_brl(spend)), E'\n') into v_sem
    from (select * from pg_temp.rel336 where spend > 0 and coalesce(resultados, 0) = 0
           order by spend desc limit 5) x;

  -- Gestor IA de hoje (cron das 08:25), se terminou.
  select r.result into v_gestor
    from public.meta_ai_runs r
   where r.kind = 'gestor' and r.status = 'ok' and r.account_id = any (v_contas) and r.run_date = v_hoje
   order by r.finished_at desc nulls last limit 1;
  if v_gestor is not null then
    select concat_ws(E'\n',
      '🧠 Gestor IA:',
      format('*Diagnóstico:* %s', v_gestor ->> 'resumo'),
      (select '*Ajustar verba:*' || E'\n' || string_agg(format('- %s → %s (%s)', a ->> 'campaign_name',
                public.meta_brl((a ->> 'verba_nova')::numeric), a ->> 'motivo'), E'\n')
         from jsonb_array_elements(coalesce(v_gestor -> 'acoes', '[]')) a where a ->> 'acao' = 'verba'),
      (select '*Pausar:*' || E'\n' || string_agg(format('- %s (%s)', a ->> 'campaign_name', a ->> 'motivo'), E'\n')
         from jsonb_array_elements(coalesce(v_gestor -> 'acoes', '[]')) a where a ->> 'acao' = 'pausar'),
      (select '*Ativar:*' || E'\n' || string_agg(format('- %s (%s)', a ->> 'campaign_name', a ->> 'motivo'), E'\n')
         from jsonb_array_elements(coalesce(v_gestor -> 'acoes', '[]')) a where a ->> 'acao' = 'ativar'))
      into v_ia;
  end if;

  return left(concat_ws(E'\n\n',
    format('🏢 Faceimob — Relatório de ontem (%s)', to_char(v_ontem, 'DD/MM')),
    concat_ws(E'\n',
      format('💳 Saldo: %s%s', coalesce(public.meta_brl(v_saldo), 'não informado'),
             case when v_saldo is not null and v_orcamento > 0
                  then format(' (~%sd)', floor(v_saldo / v_orcamento)) else '' end),
      format('📊 Ativas: %s · Orçamento/dia: %s', v_ativas, public.meta_brl(v_orcamento)),
      format('💰 Gasto: %s', public.meta_brl(v_gasto)),
      format('📝 Cadastros: %s — CPL %s', v_cad,
             case when v_cad > 0 then public.meta_brl(v_cad_gasto / v_cad) else '—' end),
      format('💬 Conversas: %s — %s/conversa', v_conv,
             case when v_conv > 0 then public.meta_brl(v_conv_gasto / v_conv) else '—' end)),
    case when v_melhores is not null then '🏆 Melhores resultados:' || E'\n' || v_melhores end,
    case when v_n_acima > 0
         then format('🚨 Custo por resultado acima de %s (%s):', public.meta_brl(v_limite), v_n_acima) || E'\n' || v_acima end,
    case when v_n_sem > 0 then format('🔴 Gastando sem resultado (%s):', v_n_sem) || E'\n' || v_sem end,
    v_ia,
    'Controle Faceimob'), 4000);
end;
$$;
revoke all on function public.meta_relatorio_whatsapp_texto() from public, anon, authenticated;
grant execute on function public.meta_relatorio_whatsapp_texto() to service_role;
