-- =============================================================================
-- 0336 · Relatório da Meta pelo WhatsApp para sócios e administrador
--
-- Pedido de 14/11/2026: todo dia às 08:30 o modelo oficial "relatrio" (pt_BR,
-- imagem no cabeçalho, botão "Receber relatório") vai para os sócios e o
-- administrador com telefone. Quem clica recebe na hora o relatório de ontem:
-- saldo, ativas e orçamento do dia, gasto, cadastros e conversas com custo,
-- melhores campanhas, as acima do limite de CPL, as que gastam sem resultado e
-- o Gestor IA. Clicar NÃO vira lead: o webhook atende antes da roleta.
--
-- O gestor de IA (0119) estava inativo desde a importação, como a
-- sincronização (0333): ganha um job novo às 08:25, depois da sincronização
-- das 08:20 e antes do envio.
-- =============================================================================

-- Quem recebe: sócio ou administrador ativo, com telefone.
create or replace function public.relatorio_meta_destinatarios()
returns table (profile_id uuid, nome text, telefone text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.full_name, public.normalize_phone(p.phone)
    from public.profiles p
   where p.status = 'active'
     and nullif(public.normalize_phone(p.phone), '') is not null
     and exists (select 1 from public.user_roles r
                  where r.profile_id = p.id and r.role in ('partner', 'admin'))
   order by p.full_name;
$$;
revoke all on function public.relatorio_meta_destinatarios() from public, anon, authenticated;
grant execute on function public.relatorio_meta_destinatarios() to service_role;

-- O telefone é de quem recebe o relatório? (o webhook pergunta antes da roleta)
create or replace function public.relatorio_meta_e_destinatario(p_telefone text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.relatorio_meta_destinatarios() d
     where right(d.telefone, 8) = right(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), 8)
       and length(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g')) >= 8);
$$;
revoke all on function public.relatorio_meta_e_destinatario(text) from public, anon, authenticated;
grant execute on function public.relatorio_meta_e_destinatario(text) to service_role;

-- Registro dos envios do modelo e de quem pediu o relatório.
create table if not exists public.relatorio_meta_envios (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid references public.profiles(id) on delete set null,
  telefone      text not null,
  run_date      date not null default (now() at time zone 'America/Sao_Paulo')::date,
  status        text not null check (status in ('enviado', 'falhou', 'relatorio_enviado', 'relatorio_falhou')),
  erro          text,
  created_at    timestamptz not null default now()
);
comment on table public.relatorio_meta_envios is
  'Relatório da Meta pelo WhatsApp (0336): o modelo das 08:30 (enviado/falhou) e o relatório mandado a quem clicou (relatorio_enviado/relatorio_falhou).';
create index if not exists relatorio_meta_envios_dia_idx on public.relatorio_meta_envios (run_date);
alter table public.relatorio_meta_envios enable row level security;
drop policy if exists relatorio_meta_envios_select on public.relatorio_meta_envios;
create policy relatorio_meta_envios_select on public.relatorio_meta_envios
  for select to authenticated using (public.is_admin());
revoke all on public.relatorio_meta_envios from anon;
grant select on public.relatorio_meta_envios to authenticated;

-- O clique no botão fica no registro do webhook com desfecho próprio.
alter table public.whatsapp_inbound_messages drop constraint if exists whatsapp_inbound_outcome_check;
alter table public.whatsapp_inbound_messages add constraint whatsapp_inbound_outcome_check check (
  outcome in ('sdr_turn', 'remarketing_lead', 'unmatched', 'agent_error', 'human_turn', 'audio_falhou', 'ignorado',
              'descartado_sem_telefone', 'descartado_tipo_desconhecido', 'relatorio')
);

-- O texto do relatório de ontem (dia de São Paulo), no formato combinado.
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
  delete from pg_temp.rel336;
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

-- Disparo das 08:30: chama a edge que manda o modelo a cada destinatário.
create or replace function public.dispatch_relatorio_meta_whatsapp()
returns boolean
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  select secret into v_url from private.integration_credentials
   where provider = 'supabase' and label = 'functions_url' and active;
  select secret into v_key from private.integration_credentials
   where provider = 'supabase' and label = 'service_role_key' and active;
  if v_url is null or v_key is null then
    raise warning 'dispatch_relatorio_meta_whatsapp: cadastre functions_url e service_role_key em Integrações.';
    return false;
  end if;
  perform net.http_post(
    url                  := rtrim(v_url, '/') || '/relatorio-meta-whatsapp',
    headers              := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  return true;
end;
$$;
revoke all on function public.dispatch_relatorio_meta_whatsapp() from public, anon, authenticated;
grant execute on function public.dispatch_relatorio_meta_whatsapp() to service_role;

do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0336] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;
  begin
    perform cron.schedule('faceimob-meta-gestor-0825', '25 11 * * *', $cmd$select public.dispatch_meta_gestor();$cmd$);
    perform cron.schedule('faceimob-relatorio-meta-0830', '30 11 * * *', $cmd$select public.dispatch_relatorio_meta_whatsapp();$cmd$);
  exception when others then
    raise exception '[0336] não consegui agendar o relatório da Meta: %', sqlerrm;
  end;
end
$do$;
