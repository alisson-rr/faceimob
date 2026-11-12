-- =============================================================================
-- 0333 · Meta: sincronização uma vez por dia às 08:20 e resumo às 08:30
--
-- Pedido de 12/11/2026: "não atualizar de hora em hora e sim uma vez por dia,
-- mesmo que diga que é de hora em hora, se não clico em Atualizar fica
-- totalmente desatualizada" e "mandar um resumo das campanhas (CPL, alertas,
-- saldo) todo dia às 08:30".
--
-- Por que nunca rodou: em produção `faceimob-meta-sync` (e o resumo, o estado
-- da conta e o gestor IA) estão INATIVOS e ainda no horário de setembro
-- ('0 9 * * *'). Foram pausados pela importação (scripts/import, `alter_job
-- active := false`) por outro usuário do banco; o `cron.unschedule` das 0197 e
-- 0300 falhou por dono diferente, caiu no `exception when others` (só aviso) e
-- nada foi reagendado. `meta_sync_runs` só tem execuções 'manual'.
--
-- Agora: jobs NOVOS, com nome próprio, criados pelo usuário da migration (o
-- mesmo dos que rodam). Os antigos são removidos quando der; se não der, ficam
-- como estão: inativos.
--   · faceimob-meta-sync-diaria   08:20 (11:20 UTC) sincronização completa
--   · faceimob-meta-resumo-0830   08:30 (11:30 UTC) resumo, depois dos números
--   · faceimob-meta-anuncios      sai do de hora em hora: 08:25, uma vez
-- O resumo passa a ir só para administrador, no sino/push do CRM, e ganha o mês
-- até ontem (gasto, leads, CPL) e o saldo da conta.
-- =============================================================================

create or replace function public.meta_enfileirar_resumo_diario()
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoje       date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ontem      date := v_hoje - 1;
  v_inicio     timestamptz := v_hoje::timestamp at time zone 'America/Sao_Paulo';
  v_contas     uuid[];
  v_ok_min     timestamptz;
  v_nunca      boolean;
  v_claims     text;
  v_gasto      numeric;
  v_result     int;
  v_qualif     int;
  v_melhor     text;
  v_melhor_cpr numeric;
  v_pior       text;
  v_pior_cpr   numeric;
  v_leads      int;
  v_abertos    int;
  v_titulos    text;
  v_titulo     text;
  v_corpo      text;
  v_n          int;
  v_mes_inicio date := date_trunc('month', v_ontem)::date;
  v_gasto_mes  numeric;
  v_leads_mes  int;
  v_saldo      numeric;
begin
  -- Cron chamado duas vezes ao mesmo tempo não manda dois resumos.
  perform pg_advisory_xact_lock(hashtext('meta_enfileirar_resumo_diario'));

  select array_agg(a.id), min(a.last_sync_ok_at), bool_or(a.last_sync_ok_at is null)
    into v_contas, v_ok_min, v_nunca
    from public.meta_ad_accounts a
   where a.enabled;
  if v_contas is null then
    return 0;
  end if;

  -- Mesma razão do claim em meta_avaliar_alertas: o pg_cron não traz JWT.
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select coalesce(sum(m.spend), 0),
         coalesce(sum(m.resultados), 0)::int,
         count(*) filter (where m.spend >= 20 and m.custo_por_resultado is not null)::int
    into v_gasto, v_result, v_qualif
    from public.meta_metricas(v_ontem, v_ontem) m
   where m.account_id = any (v_contas);

  select m.name, m.custo_por_resultado into v_melhor, v_melhor_cpr
    from public.meta_metricas(v_ontem, v_ontem) m
   where m.account_id = any (v_contas) and m.spend >= 20 and m.custo_por_resultado is not null
   order by m.custo_por_resultado, m.spend desc
   limit 1;

  select m.name, m.custo_por_resultado into v_pior, v_pior_cpr
    from public.meta_metricas(v_ontem, v_ontem) m
   where m.account_id = any (v_contas) and m.spend >= 20 and m.custo_por_resultado is not null
   order by m.custo_por_resultado desc, m.spend desc
   limit 1;

  -- 0333: o mês de ontem, do dia 1º até ontem.
  select coalesce(sum(m.spend), 0) into v_gasto_mes
    from public.meta_metricas(v_mes_inicio, v_ontem) m
   where m.account_id = any (v_contas);

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  select count(*)::int into v_leads_mes
    from public.leads l
   where l.created_at >= v_mes_inicio::timestamp at time zone 'America/Sao_Paulo'
     and l.created_at <  v_inicio
     and exists (select 1 from public.ad_campaigns c
                  where c.external_id = l.campaign_id and c.meta_account_id = any (v_contas));

  select sum(a.prepay_available) filter (where a.is_prepay) into v_saldo
    from public.meta_ad_accounts a where a.id = any (v_contas);

  -- Lead do CRM de ontem nas campanhas dessas contas (o mesmo casamento do
  -- painel: leads.campaign_id = ad_campaigns.external_id).
  select count(*)::int into v_leads
    from public.leads l
   where l.created_at >= v_ontem::timestamp at time zone 'America/Sao_Paulo'
     and l.created_at <  v_inicio
     and exists (select 1 from public.ad_campaigns c
                  where c.external_id = l.campaign_id and c.meta_account_id = any (v_contas));

  select count(*)::int into v_abertos
    from public.meta_alerts al
   where al.account_id = any (v_contas) and al.resolved_at is null;

  select string_agg(x.t, '; ') into v_titulos
    from (
      select public.meta_alerta_titulo(al.kind) || coalesce(' (' || c.name || ')', '') as t
        from public.meta_alerts al
        left join public.ad_campaigns c on c.id = al.campaign_id
       where al.account_id = any (v_contas) and al.resolved_at is null
       order by al.opened_at desc
       limit 3
    ) x;

  v_titulo := format('Resumo da Meta de ontem (%s)', to_char(v_ontem, 'DD/MM'));
  v_corpo := concat_ws(E'\n',
    -- Falha aparece como falha, com a data dos números: nunca número velho
    -- apresentado como de ontem.
    nullif(concat_ws(' ',
      case when v_ok_min < v_inicio
           then format('A sincronização de hoje falhou; números até %s.',
                       to_char(v_ok_min at time zone 'America/Sao_Paulo', 'DD/MM')) end,
      case when v_nunca
           then 'Há conta de anúncios que nunca sincronizou com a Meta; ela fica fora destes números.' end), ''),
    format('Gasto: %s.', public.meta_brl(v_gasto)),
    format('Leads no CRM: %s. Resultados segundo a Meta: %s.', v_leads, v_result),
    format('CPL do CRM: %s.',
           case when v_leads > 0 then public.meta_brl(v_gasto / v_leads) else 'sem lead no CRM' end),
    format('No mês até ontem: gasto %s, %s leads no CRM, CPL %s.', public.meta_brl(v_gasto_mes), v_leads_mes,
           case when v_leads_mes > 0 then public.meta_brl(v_gasto_mes / v_leads_mes) else 'sem lead no CRM' end),
    case when v_saldo is not null then format('Saldo da conta de anúncios: %s.', public.meta_brl(v_saldo)) end,
    case when v_melhor is not null
         then format('Melhor custo por resultado (campanhas com gasto a partir de R$ 20): %s, %s.',
                     v_melhor, public.meta_brl(v_melhor_cpr)) end,
    case when v_qualif >= 2
         then format('Pior: %s, %s.', v_pior, public.meta_brl(v_pior_cpr)) end,
    case when v_abertos = 0 then 'Nenhum alerta aberto.'
         else format('Alertas abertos: %s. %s%s', v_abertos, v_titulos, case when v_abertos > 3 then '; …' else '.' end)
    end);
  -- O notify-dispatch manda "título + corpo" e o template corta em 1.024.
  v_corpo := left(v_corpo, 998 - length(v_titulo));

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  -- 0333: só administrador, no sino e no push do CRM (pedido de 12/11/2026).
  select d.profile_id, 'meta_resumo_diario', v_titulo, v_corpo, '/marketing', 'in_app'
    from (
      select ur.profile_id
        from public.user_roles ur
        join public.profiles p on p.id = ur.profile_id and p.status = 'active'
       where ur.role = 'admin'
       group by ur.profile_id
    ) d
   where not exists (
     select 1 from public.notifications n
      where n.profile_id = d.profile_id
        and n.kind = 'meta_resumo_diario'
        and n.created_at >= v_inicio);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.meta_enfileirar_resumo_diario() from public, anon, authenticated;
grant execute on function public.meta_enfileirar_resumo_diario() to service_role;

do $do$
declare
  v_nome text;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0333] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;
  foreach v_nome in array array['faceimob-meta-sync', 'faceimob-meta-resumo-diario',
                                'faceimob-meta-estado-conta', 'faceimob-meta-sync-diaria',
                                'faceimob-meta-resumo-0830'] loop
    begin
      if exists (select 1 from cron.job where jobname = v_nome) then
        perform cron.unschedule(v_nome);
      end if;
    exception when others then
      raise warning '[0333] % não saiu (fica como está): %', v_nome, sqlerrm;
    end;
  end loop;
  begin
    perform cron.schedule('faceimob-meta-sync-diaria', '20 11 * * *', $cmd$select public.dispatch_meta_sync();$cmd$);
    perform cron.schedule('faceimob-meta-resumo-0830', '30 11 * * *', $cmd$select public.meta_enfileirar_resumo_diario();$cmd$);
    perform cron.schedule('faceimob-meta-anuncios', '25 11 * * *', $cmd$select public.dispatch_meta_sync_modo('anuncios');$cmd$);
  exception when others then
    -- Aqui não engole: sem o agendamento o pedido não foi atendido.
    raise exception '[0333] não consegui agendar a sincronização diária da Meta: %', sqlerrm;
  end;
end
$do$;
