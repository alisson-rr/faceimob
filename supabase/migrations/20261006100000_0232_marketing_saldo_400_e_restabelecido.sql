-- =============================================================================
-- 0232 — Marketing: aviso de saldo abaixo de R$ 400 e saldo restabelecido
--
-- Pedido de 06/10/2026: "atualize o marketing de hora em hora e avise o saldo
-- abaixo de 400 reais e informe o saldo restabelecido".
--   * De hora em hora já roda desde a 0197 (faceimob-meta-sync, '0 * * * *'):
--     cada passada lê a conta na Meta e avalia o estado.
--   * O limite do "saldo baixo" era R$ 100 por conta: passa a R$ 400 em todas
--     (e no padrão de conta nova). Continua editável por conta no Marketing.
--   * O aviso agora traz o valor no título: "Saldo abaixo de R$ 400,00 na conta
--     X: R$ 312,40" e, quando volta, "Saldo restabelecido na conta X: R$ 1.500,00".
--     Sino e WhatsApp para administrador, sócio e marketing, como antes.
-- =============================================================================

alter table public.meta_ad_accounts alter column saldo_baixo_limite set default 400;
update public.meta_ad_accounts set saldo_baixo_limite = 400
 where saldo_baixo_limite is distinct from 400;

-- Saldo que sobra para rodar: pré-paga, o saldo; pós-paga com limite de gastos,
-- o que falta do limite; sem nenhum dos dois, nulo (não há saldo a informar).
create or replace function public.meta_saldo_disponivel(
  p_is_prepay        boolean,
  p_prepay_available numeric,
  p_spend_cap        numeric,
  p_amount_spent     numeric)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_is_prepay and p_prepay_available is not null then p_prepay_available
    when p_spend_cap > 0 then greatest(p_spend_cap - coalesce(p_amount_spent, 0), 0)
  end;
$$;
revoke all on function public.meta_saldo_disponivel(boolean, numeric, numeric, numeric) from public, anon;
grant execute on function public.meta_saldo_disponivel(boolean, numeric, numeric, numeric) to authenticated, service_role;

-- Corpo da 0117; só o título do aviso de estado muda.
create or replace function public.meta_avaliar_alertas(p_account_id uuid, p_so_estado boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_conta       public.meta_ad_accounts;
  v_nome        text;
  v_run_status  text;
  v_run_erro    text;
  v_run_quando  timestamptz;
  v_estado      text;
  v_problema    text[] := array['sem_saldo', 'saldo_baixo', 'bloqueada'];
  v_tz          text;
  v_hoje        date;
  v_dias        int;
  v_claims      text;
  v_disparados  jsonb;
  v_novos       jsonb;
  v_msg         text;
  v_n_novos     int := 0;
  v_n_resolv    int := 0;
  v_n           int;
begin
  -- A trava da linha põe em fila a sincronização e o "salvar limites" da mesma
  -- conta: sem ela, as duas veriam a mesma transição e avisariam duas vezes.
  select * into v_conta from public.meta_ad_accounts where id = p_account_id for update;
  if not found then
    raise exception 'Conta de anúncios não encontrada.' using errcode = '22023';
  end if;
  v_nome := coalesce(v_conta.name, v_conta.act_id);

  select r.status, r.error, coalesce(r.finished_at, r.started_at)
    into v_run_status, v_run_erro, v_run_quando
    from public.meta_sync_runs r
   where r.account_id = p_account_id and r.status <> 'rodando'
   order by r.started_at desc
   limit 1;

  -- 3a. Estado da conta. No modo só-estado quem chama acabou de ler a conta na
  --     Meta; no modo completo, só se a última sincronização não falhou.
  v_estado := v_conta.balance_state;
  if p_so_estado or v_run_status is distinct from 'falhou' then
    v_estado := public.meta_classifica_conta(
      v_conta.account_status, v_conta.disable_reason, v_conta.is_prepay, v_conta.prepay_available,
      v_conta.spend_cap, v_conta.amount_spent, v_conta.saldo_baixo_limite);

    if v_estado is distinct from v_conta.balance_state then
      update public.meta_ad_accounts
         set balance_state = v_estado, balance_state_changed_at = clock_timestamp()
       where id = p_account_id;

      if v_estado = any (v_problema) or (v_estado = 'rodando' and v_conta.balance_state = any (v_problema)) then
        perform public.meta_notificar(
          'meta_conta_estado',
          -- 0232: o valor vai no título — "abaixo de R$ 400" e "restabelecido".
          case v_estado
            when 'sem_saldo'   then format('Conta de anúncios sem saldo: %s', v_nome)
            when 'saldo_baixo' then format('Saldo abaixo de %s na conta %s%s', public.meta_brl(v_conta.saldo_baixo_limite), v_nome,
                                           case when public.meta_saldo_disponivel(v_conta.is_prepay, v_conta.prepay_available, v_conta.spend_cap, v_conta.amount_spent) is not null then ': ' || public.meta_brl(public.meta_saldo_disponivel(v_conta.is_prepay, v_conta.prepay_available, v_conta.spend_cap, v_conta.amount_spent)) else '' end)
            when 'bloqueada'   then format('Conta de anúncios bloqueada: %s', v_nome)
            else case when v_conta.balance_state in ('sem_saldo', 'saldo_baixo')
                      then format('Saldo restabelecido na conta %s%s', v_nome,
                                  case when public.meta_saldo_disponivel(v_conta.is_prepay, v_conta.prepay_available, v_conta.spend_cap, v_conta.amount_spent) is not null then ': ' || public.meta_brl(public.meta_saldo_disponivel(v_conta.is_prepay, v_conta.prepay_available, v_conta.spend_cap, v_conta.amount_spent)) else '' end)
                      else format('A conta de anúncios %s voltou a rodar', v_nome) end
          end,
          -- Fatos, não a regra de novo: o que a Meta disse e quando.
          concat_ws(' ',
            case v_estado
              when 'sem_saldo'   then 'Os anúncios pararam por falta de saldo ou de pagamento.'
              when 'saldo_baixo' then 'Os anúncios ainda rodam, mas o saldo ou o limite de gastos está no fim, ou a Meta deu prazo de tolerância para o pagamento.'
              when 'bloqueada'   then 'A Meta desativou ou bloqueou a conta: os anúncios só voltam depois de resolver no Gerenciador de Anúncios.'
              else 'Os anúncios voltaram a ser veiculados.'
            end,
            format('Status na Meta: %s.', case v_conta.account_status
              when 1 then 'ativa' when 2 then 'desativada' when 3 then 'pagamento pendente'
              when 7 then 'em revisão pela Meta' when 8 then 'acerto pendente'
              when 9 then 'em período de tolerância' when 100 then 'encerrando' when 101 then 'encerrada'
              else 'código ' || v_conta.account_status end),
            case when coalesce(v_conta.disable_reason, 0) <> 0
                 then format('Motivo de bloqueio informado pela Meta: código %s.', v_conta.disable_reason) end,
            case when v_conta.spend_cap > 0
                 then format('Limite de gastos: %s usados de %s.',
                             public.meta_brl(v_conta.amount_spent), public.meta_brl(v_conta.spend_cap)) end,
            case when v_conta.is_prepay and v_conta.prepay_available is not null
                 then format('Saldo pré-pago: %s.', public.meta_brl(v_conta.prepay_available)) end,
            format('Verificado em %s.',
                   to_char(coalesce(v_conta.account_checked_at, clock_timestamp()) at time zone 'America/Sao_Paulo',
                           'DD/MM "às" HH24:MI'))));
      end if;
    end if;
  end if;

  if p_so_estado then
    return jsonb_build_object(
      'estado_conta', v_estado,
      'abertos', (select count(*) from public.meta_alerts where account_id = p_account_id and resolved_at is null),
      'novos', 0,
      'resolvidos', 0);
  end if;

  -- 3b. Sincronização que falhou: abre UM alerta, e nada mais se mexe.
  if v_run_status = 'falhou' then
    insert into public.meta_alerts (account_id, kind, dedupe_key, mensagem, notified_at)
    values (
      p_account_id, 'sync_falhou', 'sync_falhou:' || p_account_id,
      format('%s na conta %s em %s: %s. %s',
             public.meta_alerta_titulo('sync_falhou'), v_nome,
             to_char(v_run_quando at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'),
             coalesce(nullif(btrim(v_run_erro), ''), 'sem motivo informado'),
             case when v_conta.last_sync_ok_at is null
                  then 'A conta ainda não teve sincronização boa: não há números da Meta dela.'
                  else format('Os números mostrados continuam os da última sincronização boa, em %s.',
                              to_char(v_conta.last_sync_ok_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'))
             end),
      clock_timestamp())
    on conflict (dedupe_key) where resolved_at is null do nothing
    returning mensagem into v_msg;

    -- Segunda falha seguida: o alerta já está aberto e ninguém é avisado de novo.
    if v_msg is not null then
      v_n_novos := 1;
      perform public.meta_notificar('meta_sync_falhou',
        format('%s: %s', public.meta_alerta_titulo('sync_falhou'), v_nome), v_msg);
    end if;

    return jsonb_build_object(
      'estado_conta', v_estado,
      'abertos', (select count(*) from public.meta_alerts where account_id = p_account_id and resolved_at is null),
      'novos', v_n_novos,
      'resolvidos', 0);
  end if;

  update public.meta_alerts
     set resolved_at = clock_timestamp()
   where account_id = p_account_id and kind = 'sync_falhou' and resolved_at is null;
  get diagnostics v_n_resolv = row_count;

  -- 3c. O que dispara agora. "Hoje" no fuso da conta, o mesmo dos insights.
  v_tz := coalesce(nullif(v_conta.timezone_name, ''), 'America/Sao_Paulo');
  begin
    v_hoje := (now() at time zone v_tz)::date;
  exception when invalid_parameter_value then
    v_tz   := 'America/Sao_Paulo';
    v_hoje := (now() at time zone v_tz)::date;
  end;
  v_dias := coalesce(v_conta.gasto_sem_lead_dias, 3);

  -- meta_metricas confere reports.view_finance ou service_role pelo JWT, e o
  -- pg_cron e o "salvar limites" não trazem o JWT da service role. Esta função
  -- só é executável pela service role (e pelos definers desta migration): o
  -- claim vale só para a leitura abaixo e volta ao que era.
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
    into v_disparados
    from (
      -- Custo por resultado no canal da campanha, 7 dias, só com resultado.
      select 'cpl_alto'::text                  as kind,
             m.campaign_id                     as campaign_id,
             'cpl_alto:' || m.campaign_id      as dedupe_key,
             m.custo_por_resultado             as valor,
             v_conta.cpl_limite                as limite,
             format('%s: %s em %s nos últimos 7 dias, com %s resultado(s); o limite é %s. O CPL do CRM é outro número.',
                    public.meta_alerta_titulo('cpl_alto'), public.meta_brl(m.custo_por_resultado), m.name,
                    m.resultados, public.meta_brl(v_conta.cpl_limite)) as mensagem
        from public.meta_metricas(v_hoje - 6, v_hoje) m
       where m.account_id = p_account_id
         and v_conta.cpl_limite > 0
         and m.resultados > 0
         and m.custo_por_resultado > v_conta.cpl_limite

      union all

      -- Gasto sem lead: NEM a Meta (formulário, conversa ou pixel) NEM o CRM
      -- viram lead. Uma fonte só dá alarme falso: WhatsApp não gera lead no CRM
      -- e LP sem pixel não gera resultado na Meta.
      select 'gasto_sem_lead',
             m.campaign_id,
             'gasto_sem_lead:' || m.campaign_id,
             m.spend,
             v_conta.gasto_sem_lead_limite,
             format('%s: %s em %s nos últimos %s dias, sem lead no CRM e sem resultado na Meta; o limite é %s.',
                    public.meta_alerta_titulo('gasto_sem_lead'), public.meta_brl(m.spend), m.name, v_dias,
                    public.meta_brl(v_conta.gasto_sem_lead_limite))
        from public.meta_metricas(v_hoje - (v_dias - 1), v_hoje) m
       where m.account_id = p_account_id
         and v_conta.gasto_sem_lead_limite > 0
         and m.spend >= v_conta.gasto_sem_lead_limite
         and m.leads_form + m.conversations + m.lp_leads = 0
         and not exists (
           select 1 from public.leads l
            where l.campaign_id = m.external_id
              and l.created_at >= (v_hoje - (v_dias - 1))::timestamp at time zone v_tz)

      union all

      -- Verba do mês: aviso no percentual e de novo em 100%. Com o mês sincronizado
      -- só em parte, o texto diz desde quando e não chama a soma de total do mês.
      select k.kind,
             null::uuid,
             k.kind || ':' || p_account_id,
             g.gasto,
             v_conta.verba_mensal,
             format('%s na conta %s: %s, %s%% da verba de %s.',
                    public.meta_alerta_titulo(k.kind), v_nome,
                    case when g.desde > date_trunc('month', v_hoje)::date
                         then format('dados desde %s (o mês não está todo sincronizado); só desde então já são %s gastos segundo a Meta',
                                     to_char(g.desde, 'DD/MM'), public.meta_brl(g.gasto))
                         else format('%s gastos no mês segundo a Meta', public.meta_brl(g.gasto))
                    end,
                    floor(g.gasto * 100 / v_conta.verba_mensal)::int,
                    public.meta_brl(v_conta.verba_mensal))
        from (
          select sum(m.spend) as gasto, min(m.cobertura_desde) as desde
            from public.meta_metricas(date_trunc('month', v_hoje)::date, v_hoje) m
           where m.account_id = p_account_id
        ) g
        cross join lateral (values
          ('verba_mes_aviso',    v_conta.verba_mensal * coalesce(v_conta.verba_aviso_pct, 85) / 100.0),
          ('verba_mes_esgotada', v_conta.verba_mensal)) as k(kind, gatilho)
       where v_conta.verba_mensal > 0
         and g.gasto >= k.gatilho
    ) f;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  -- 3d. Abre o que disparou e não estava aberto (o índice único é o dedupe).
  with novos as (
    insert into public.meta_alerts (account_id, campaign_id, kind, dedupe_key, valor, limite, mensagem, notified_at)
    select p_account_id, f.campaign_id, f.kind, f.dedupe_key, f.valor, f.limite, f.mensagem, clock_timestamp()
      from jsonb_to_recordset(v_disparados)
        as f(kind text, campaign_id uuid, dedupe_key text, valor numeric, limite numeric, mensagem text)
    on conflict (dedupe_key) where resolved_at is null do nothing
    returning kind, mensagem
  )
  select count(*)::int, jsonb_agg(jsonb_build_object('kind', kind, 'mensagem', mensagem))
    into v_n_novos, v_novos
    from novos;

  -- O que continua aberto mostra o número de hoje, sem avisar de novo.
  update public.meta_alerts al
     set valor = f.valor, limite = f.limite, mensagem = f.mensagem
    from jsonb_to_recordset(v_disparados) as f(dedupe_key text, valor numeric, limite numeric, mensagem text)
   where al.dedupe_key = f.dedupe_key
     and al.resolved_at is null
     and (al.valor, al.limite, al.mensagem) is distinct from (f.valor, f.limite, f.mensagem);

  -- Fecha o que parou de disparar.
  update public.meta_alerts al
     set resolved_at = clock_timestamp()
   where al.account_id = p_account_id
     and al.resolved_at is null
     and al.kind in ('cpl_alto', 'gasto_sem_lead', 'verba_mes_aviso', 'verba_mes_esgotada')
     and not exists (select 1 from jsonb_to_recordset(v_disparados) as f(dedupe_key text)
                      where f.dedupe_key = al.dedupe_key);
  get diagnostics v_n = row_count;
  v_n_resolv := v_n_resolv + v_n;

  -- Um aviso por pessoa com tudo o que abriu agora, não um por alerta.
  if v_n_novos > 0 then
    perform public.meta_notificar(
      'meta_alerta',
      case when v_n_novos = 1
           then format('%s: %s', public.meta_alerta_titulo(v_novos #>> '{0,kind}'), v_nome)
           else format('%s alertas novos da Meta na conta %s', v_n_novos, v_nome)
      end,
      (select string_agg(x->>'mensagem', E'\n') from jsonb_array_elements(v_novos) as x));
  end if;

  return jsonb_build_object(
    'estado_conta', v_estado,
    'abertos', (select count(*) from public.meta_alerts where account_id = p_account_id and resolved_at is null),
    'novos', v_n_novos,
    'resolvidos', v_n_resolv);
end;
$$;
